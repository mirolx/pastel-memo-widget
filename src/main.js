const {
  app, BrowserWindow, ipcMain, screen, dialog, Tray, Menu,
  nativeImage, globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const store = require('./store');

const PAD = 6;            // transparent padding around the card (for the shadow)
const DEFAULT_W = 300;
const DEFAULT_H = 320;

const memoWindows = new Map(); // id -> BrowserWindow
let toggleWin = null;
let tray = null;

if (!app.requestSingleInstanceLock()) app.quit();

// ---------- helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function fontsForRenderer() {
  return store.get().fonts
    .filter((f) => fs.existsSync(f.file))
    .map((f) => ({ family: f.family, url: pathToFileURL(f.file).href }));
}

function broadcast(channel, payload) {
  for (const w of memoWindows.values()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function inside(r, area) {
  return r.x >= area.x && r.y >= area.y && r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height;
}

/** Find a free slot glued to `src` (right → below → left → above), else cascade. */
function findDockedSlot(src, excludeId) {
  const area = screen.getDisplayMatching(src).workArea;
  const others = [...memoWindows.entries()]
    .filter(([id, w]) => id !== excludeId && !w.isDestroyed())
    .map(([, w]) => w.getBounds());
  const { width, height } = src;
  const free = (r) => inside(r, area) && !others.some((o) => rectsOverlap(r, o));

  // Walk outward along each direction so a row of memos keeps growing.
  for (let step = 1; step <= 8; step++) {
    const cands = [
      { x: src.x + width * step, y: src.y },
      { x: src.x, y: src.y + height * step },
      { x: src.x - width * step, y: src.y },
      { x: src.x, y: src.y - height * step },
    ];
    for (const c of cands) {
      const r = { x: c.x, y: c.y, width, height };
      if (free(r)) return r;
    }
  }
  return { x: src.x + 30, y: src.y + 30, width, height };
}

// ---------- memo windows ----------
function createMemoWindow(memo) {
  const win = new BrowserWindow({
    x: memo.x, y: memo.y, width: memo.width, height: memo.height,
    minWidth: 180, minHeight: 140,
    frame: false,
    transparent: true,
    resizable: false,          // custom resize grip (native resize is flaky on transparent windows)
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: !!memo.pinned,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      backgroundThrottling: false,   // keep the fold animation on time while the window is hidden
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'memo.html'), { query: { id: memo.id } });
  win.once('ready-to-show', () => { if (!store.get().hidden) win.showInactive(); });

  const saveBounds = () => {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    store.updateMemo(memo.id, { x: b.x, y: b.y, width: b.width, height: b.height });
  };
  win.on('moved', saveBounds);
  win.on('closed', () => memoWindows.delete(memo.id));
  memoWindows.set(memo.id, win);
  return win;
}

function newMemo(fromId) {
  const memos = store.get().memos;
  const src = memos.find((m) => m.id === fromId) || memos[memos.length - 1];
  let bounds;
  if (src) {
    const w = memoWindows.get(src.id);
    const sb = w && !w.isDestroyed() ? w.getBounds() : src;
    bounds = findDockedSlot({ x: sb.x, y: sb.y, width: sb.width, height: sb.height });
  } else {
    const area = screen.getPrimaryDisplay().workArea;
    bounds = {
      x: area.x + area.width - DEFAULT_W - 120,
      y: area.y + 60,
      width: DEFAULT_W, height: DEFAULT_H,
    };
  }
  const memo = {
    id: uid(),
    ...bounds,
    text: '',
    color: src ? nextColor(src.color) : COLORS[0],
    opacity: src ? src.opacity : 0.92,
    font: src ? src.font : 'default',
    fontSize: src ? src.fontSize : 15,
    pinned: false,
  };
  store.addMemo(memo);
  if (store.get().hidden) setHidden(false);
  const win = createMemoWindow(memo);
  win.once('ready-to-show', () => { win.show(); win.focus(); });
}

const COLORS = ['rosewood', 'sage', 'cream', 'sky', 'lavender', 'lemon', 'rose', 'mocha'];
function nextColor(c) { return COLORS[(COLORS.indexOf(c) + 1) % COLORS.length]; }

// ---------- global show / hide ----------
// Motion timing (ms). Reveal: nearest → farthest from the toggle button. Hide: reverse.
const REVEAL = { dur: 280, stagger: 32 };
const CONCEAL = { dur: 160, stagger: 22 };
let hideTimer = null;

/** Memo windows sorted by distance from the toggle button, with the button position in each window's own coords. */
function wavePlan() {
  const tb = toggleWin && !toggleWin.isDestroyed() ? toggleWin.getBounds() : null;
  const area = screen.getPrimaryDisplay().workArea;
  const cx = tb ? tb.x + tb.width / 2 : area.x + area.width - 37;
  const cy = tb ? tb.y + tb.height / 2 : area.y + 37;
  return [...memoWindows.values()]
    .filter((w) => !w.isDestroyed())
    .map((w) => {
      const b = w.getBounds();
      const dist = Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy);
      return { w, dist, ox: cx - b.x, oy: cy - b.y };
    })
    .sort((a, b) => a.dist - b.dist);
}

function setHidden(hidden) {
  store.set({ hidden });
  clearTimeout(hideTimer);
  const plan = wavePlan();

  if (hidden) {
    const n = plan.length;
    plan.forEach(({ w, ox, oy }, i) => {
      w.webContents.send('motion', { type: 'conceal', delay: (n - 1 - i) * CONCEAL.stagger, dur: CONCEAL.dur, ox, oy });
    });
    // hide the windows once the last card has folded away
    hideTimer = setTimeout(() => {
      for (const { w } of plan) if (!w.isDestroyed()) w.hide();
    }, Math.max(0, n - 1) * CONCEAL.stagger + CONCEAL.dur + 40);
  } else {
    plan.forEach(({ w, ox, oy }, i) => {
      w.webContents.send('motion', { type: 'reveal', delay: i * REVEAL.stagger, dur: REVEAL.dur, ox, oy });
      if (!w.isVisible()) w.showInactive();
    });
  }
  if (toggleWin && !toggleWin.isDestroyed()) toggleWin.webContents.send('hidden-changed', hidden);
  refreshTrayMenu();
}
const toggleAll = () => setHidden(!store.get().hidden);

function createToggleWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const size = 46;
  toggleWin = new BrowserWindow({
    x: area.x + area.width - size - 14, y: area.y + 14,
    width: size, height: size,
    frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false,
    hasShadow: false, backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  toggleWin.setAlwaysOnTop(true, 'screen-saver');
  toggleWin.loadFile(path.join(__dirname, 'renderer', 'toggle.html'));
}

// ---------- tray ----------
function makeTrayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  if (!img.isEmpty()) return img.resize({ width: 16, height: 16, quality: 'best' });
  // fallback: 16x16 pastel rounded square drawn into a BGRA buffer
  const s = 16, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = (y * s + x) * 4;
    const corner = (x < 2 || x > 13) && (y < 2 || y > 13);
    const line = (y === 6 || y === 9 || y === 12) && x > 3 && x < 12;
    if (corner) continue;
    const [r, g, b] = y < 4 ? [255, 170, 160] : line ? [200, 140, 130] : [255, 214, 196];
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

function refreshTrayMenu() {
  if (!tray) return;
  const hidden = store.get().hidden;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '새 메모', click: () => newMemo() },
    { label: hidden ? '메모 보이기' : '메모 숨기기', click: toggleAll },
    { type: 'separator' },
    {
      label: '토글 버튼 표시', type: 'checkbox', checked: !!(toggleWin && toggleWin.isVisible()),
      click: (i) => { i.checked ? toggleWin.showInactive() : toggleWin.hide(); store.set({ toggleVisible: i.checked }); },
    },
    {
      label: 'Windows 시작 시 실행', type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }),
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('파스텔 메모 (Ctrl+Alt+M: 숨기기/보이기)');
  tray.on('click', toggleAll);
  refreshTrayMenu();
}

// ---------- IPC ----------
ipcMain.handle('memo:get', (_e, id) => ({
  memo: store.get().memos.find((m) => m.id === id),
  hidden: store.get().hidden,
  fonts: fontsForRenderer(),
}));
ipcMain.on('memo:update', (_e, id, patch) => store.updateMemo(id, patch));
ipcMain.on('memo:new', (_e, fromId) => newMemo(fromId));
ipcMain.on('memo:delete', (_e, id) => {
  store.removeMemo(id);
  const w = memoWindows.get(id);
  if (w && !w.isDestroyed()) w.close();
});
ipcMain.on('memo:pin', (e, id, pinned) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  w.setAlwaysOnTop(pinned);
  store.updateMemo(id, { pinned });
});
ipcMain.on('memo:resize', (e, id, width, height) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const b = w.getBounds();
  const nb = { x: b.x, y: b.y, width: Math.max(180, Math.round(width)), height: Math.max(140, Math.round(height)) };
  w.setBounds(nb);
  store.updateMemo(id, { width: nb.width, height: nb.height });
});
// Font, font size and opacity are shared by every memo.
const SHARED_KEYS = ['font', 'fontSize', 'opacity'];
ipcMain.on('memo:style', (e, patch) => {
  const shared = Object.fromEntries(Object.entries(patch).filter(([k]) => SHARED_KEYS.includes(k)));
  for (const m of store.get().memos) store.updateMemo(m.id, shared);
  for (const w of memoWindows.values()) {
    if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('style-sync', shared);
  }
});

ipcMain.handle('font:register', async (e) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(parent, {
    title: '폰트 파일 선택',
    filters: [{ name: '폰트', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (res.canceled) return null;
  const dir = path.join(app.getPath('userData'), 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  const fonts = [...store.get().fonts];
  let last = null;
  for (const src of res.filePaths) {
    const family = path.basename(src, path.extname(src));
    const dest = path.join(dir, path.basename(src));
    fs.copyFileSync(src, dest);
    const idx = fonts.findIndex((f) => f.family === family);
    if (idx >= 0) fonts[idx] = { family, file: dest }; else fonts.push({ family, file: dest });
    last = family;
  }
  store.set({ fonts });
  broadcast('fonts-changed', fontsForRenderer());
  return last;
});
ipcMain.on('font:remove', (_e, family) => {
  const f = store.get().fonts.find((x) => x.family === family);
  store.set({ fonts: store.get().fonts.filter((x) => x.family !== family) });
  if (f) try { fs.unlinkSync(f.file); } catch { /* in use or missing */ }
  broadcast('fonts-changed', fontsForRenderer());
});

ipcMain.on('toggle:click', toggleAll);
ipcMain.on('toggle:new', () => newMemo());
ipcMain.handle('toggle:state', () => store.get().hidden);

// ---------- lifecycle ----------
app.on('second-instance', () => setHidden(false));

app.whenReady().then(() => {
  app.setAppUserModelId('pastel.memo.widget');
  store.load(path.join(app.getPath('userData'), 'memos.json'));

  createToggleWindow();
  if (store.get().toggleVisible === false) toggleWin.hide();
  createTray();

  const memos = store.get().memos;
  if (memos.length > 1) {   // older saves may have per-memo styles: unify to the first memo
    const { font, fontSize, opacity } = memos[0];
    memos.forEach((m) => store.updateMemo(m.id, { font, fontSize, opacity }));
  }
  if (memos.length === 0) newMemo();
  else memos.forEach(createMemoWindow);

  globalShortcut.register('Control+Alt+M', toggleAll);
  globalShortcut.register('Control+Alt+N', () => newMemo());
});

app.on('window-all-closed', (e) => e.preventDefault()); // live in the tray
app.on('will-quit', () => { globalShortcut.unregisterAll(); store.flush(); });
