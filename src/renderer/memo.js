const api = window.memoApi;
const id = new URLSearchParams(location.search).get('id');
const $ = (s) => document.getElementById(s);

// Base colors; header, gradient, text and accent shades are derived from each base.
const BASE_COLORS = {
  rosewood: { name: '로즈우드', base: '#D4A5A5' },
  sage:     { name: '세이지',   base: '#A0B498' },
  cream:    { name: '크림',     base: '#F8F4E9' },
  sky:      { name: '스카이',   base: '#B0C8E0' },
  lavender: { name: '라벤더',   base: '#B8ACCC' },
  lemon:    { name: '레몬',     base: '#F8E880' },
  rose:     { name: '로즈',     base: '#D4856A' },
  mocha:    { name: '모카',     base: '#B8A898' },
};
const LEGACY = { peach: 'rosewood', mint: 'sage' };   // colors from the previous palette

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const shade = (h, t) => rgb2hex(hex2rgb(h).map((v) => v * (1 - t)));            // toward black
const tint = (h, t) => rgb2hex(hex2rgb(h).map((v) => v + (255 - v) * t));      // toward white

const PALETTE = Object.fromEntries(Object.entries(BASE_COLORS).map(([k, { name, base }]) => [k, {
  name,
  bg: tint(base, 0.12),
  bg2: base,
  head: shade(base, 0.08),
  ink: shade(base, 0.72),
  accent: shade(base, 0.28),
  swatch: base,
}]));

const BUILTIN_FONTS = [
  { value: 'default', label: '기본 (맑은 고딕)', css: "'Malgun Gothic', 'Segoe UI', sans-serif" },
  { value: 'segoe', label: 'Segoe UI', css: "'Segoe UI', 'Malgun Gothic', sans-serif" },
  { value: 'batang', label: '바탕', css: "'Batang', serif" },
  { value: 'gulim', label: '굴림', css: "'Gulim', sans-serif" },
  { value: 'mono', label: 'Consolas (고정폭)', css: "'Consolas', 'D2Coding', monospace" },
];

let memo = null;
let customFonts = [];      // [{family, url}]
let fontsReady = false;    // true once the registered font list has arrived from main
const loadedFonts = new Set();

// ---------- apply ----------
function applyColor() {
  if (!PALETTE[memo.color]) {
    memo.color = LEGACY[memo.color] || 'rosewood';
    api.update(id, { color: memo.color });
  }
  const p = PALETTE[memo.color];
  const r = document.documentElement.style;
  r.setProperty('--bg', p.bg);
  r.setProperty('--bg2', p.bg2);
  r.setProperty('--head', p.head);
  r.setProperty('--ink', p.ink);
  r.setProperty('--accent', p.accent);
  document.querySelectorAll('.sw').forEach((s) => s.classList.toggle('sel', s.dataset.c === memo.color));
}

function applyOpacity() {
  document.documentElement.style.setProperty('--alpha', memo.opacity);
  const pct = Math.round(memo.opacity * 100);
  $('opRange').value = pct;
  $('opVal').textContent = pct + '%';
}

function fontCss(value) {
  const b = BUILTIN_FONTS.find((f) => f.value === value);
  if (b) return b.css;
  return `'${value}', 'Malgun Gothic', sans-serif`;
}

function applyFont() {
  document.documentElement.style.setProperty('--font', fontCss(memo.font));
  document.documentElement.style.setProperty('--size', memo.fontSize + 'px');
  $('sizeRange').value = memo.fontSize;
  $('sizeVal').textContent = memo.fontSize + 'px';
  $('fontSel').value = memo.font;
}

async function loadCustomFonts(list) {
  customFonts = list;
  fontsReady = true;
  await Promise.all(list.map(async (f) => {
    if (loadedFonts.has(f.url)) return;
    try {
      const face = new FontFace(f.family, `url("${f.url}")`);
      await face.load();
      document.fonts.add(face);
      loadedFonts.add(f.url);
    } catch (e) { console.warn('font load failed', f, e); }
  }));
  renderFontOptions();
}

function renderFontOptions() {
  const sel = $('fontSel');
  sel.innerHTML = '';
  const g1 = document.createElement('optgroup'); g1.label = '기본 폰트';
  BUILTIN_FONTS.forEach((f) => g1.append(new Option(f.label, f.value)));
  sel.append(g1);
  if (customFonts.length) {
    const g2 = document.createElement('optgroup'); g2.label = '등록한 폰트';
    customFonts.forEach((f) => {
      const o = new Option(f.family, f.family);
      o.style.fontFamily = `'${f.family}'`;
      g2.append(o);
    });
    sel.append(g2);
  }
  const known = [...sel.options].some((o) => o.value === memo.font);
  if (!known && fontsReady) {
    // the selected custom font was really removed → fall back for everyone
    memo.font = 'default';
    api.syncStyle({ font: memo.font });
  } else if (!known) {
    // registered fonts not loaded yet: keep the saved choice, just show it
    sel.append(new Option(memo.font, memo.font));
  }
  sel.value = memo.font;
  applyFont();

  const list = $('fontList');
  list.innerHTML = '';
  customFonts.forEach((f) => {
    const item = document.createElement('div');
    item.className = 'fontitem';
    const name = document.createElement('span');
    name.textContent = f.family;
    name.style.fontFamily = `'${f.family}'`;
    const del = document.createElement('button');
    del.textContent = '삭제';
    del.onclick = () => api.removeFont(f.family);
    item.append(name, del);
    list.append(item);
  });
}

// ---------- popovers ----------
const pops = { btnColor: 'popColor', btnOpacity: 'popOpacity', btnFont: 'popFont' };
function closePops() {
  Object.entries(pops).forEach(([b, p]) => { $(p).classList.remove('show'); $(b).classList.remove('active'); });
  $('confirm').classList.remove('show');
  $('card').classList.remove('popopen');
}
Object.entries(pops).forEach(([btn, pop]) => {
  $(btn).addEventListener('click', (e) => {
    e.stopPropagation();
    const open = $(pop).classList.contains('show');
    closePops();
    if (!open) { $(pop).classList.add('show'); $(btn).classList.add('active'); $('card').classList.add('popopen'); }
  });
});
document.querySelectorAll('.pop, .confirm').forEach((p) => p.addEventListener('click', (e) => e.stopPropagation()));
document.addEventListener('click', closePops);
window.addEventListener('blur', closePops);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePops();
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); api.newMemo(id); }
});

// ---------- controls ----------
$('btnNew').onclick = (e) => { e.stopPropagation(); api.newMemo(id); };

$('btnPin').onclick = (e) => {
  e.stopPropagation();
  memo.pinned = !memo.pinned;
  $('btnPin').classList.toggle('on', memo.pinned);
  api.pin(id, memo.pinned);
};

$('btnDelete').onclick = (e) => {
  e.stopPropagation();
  if (!memo.text.trim()) return api.remove(id);
  closePops();
  $('confirm').classList.add('show');
  $('card').classList.add('popopen');
};
$('cNo').onclick = closePops;
$('cYes').onclick = () => api.remove(id);

Object.entries(PALETTE).forEach(([key, p]) => {
  const s = document.createElement('div');
  s.className = 'sw';
  s.dataset.c = key;
  s.title = p.name;
  s.style.background = p.swatch;
  s.onclick = () => { memo.color = key; applyColor(); api.update(id, { color: key }); };
  $('swatches').append(s);
});

$('opRange').addEventListener('input', (e) => {
  memo.opacity = e.target.value / 100;
  applyOpacity();
  api.syncStyle({ opacity: memo.opacity });
});

$('fontSel').addEventListener('change', (e) => {
  memo.font = e.target.value;
  applyFont();
  api.syncStyle({ font: memo.font });
});
$('sizeRange').addEventListener('input', (e) => {
  memo.fontSize = +e.target.value;
  applyFont();
  api.syncStyle({ fontSize: memo.fontSize });
});
$('btnRegister').onclick = async () => {
  const family = await api.registerFont();   // fonts-changed event reloads the list
  if (family) {
    await new Promise((r) => setTimeout(r, 150));
    memo.font = family;
    applyFont();
    api.syncStyle({ font: family });
  }
};

api.onFontsChanged((list) => loadCustomFonts(list));
api.onStyleSync((p) => {
  Object.assign(memo, p);
  if ('opacity' in p) applyOpacity();
  if ('font' in p || 'fontSize' in p) applyFont();
});

// text autosave: send every change right away; the main process batches the disk write
$('text').addEventListener('input', (e) => {
  memo.text = e.target.value;
  api.update(id, { text: memo.text });
});
window.addEventListener('beforeunload', () => api.update(id, { text: memo.text }));

// ---------- custom resize grip ----------
$('grip').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  const sx = e.screenX, sy = e.screenY;
  const sw = window.outerWidth, sh = window.outerHeight;
  let raf = 0;
  const move = (ev) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => api.resize(id, sw + ev.screenX - sx, sh + ev.screenY - sy));
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
});

// ---------- reveal / fold motion ----------
// The card unfolds out of the corner that faces the toggle button, and folds back into it.
const card = $('card');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let motionAnim = null;

function foldedFrame(ox, oy) {
  const pad = 6; // body padding
  const w = card.offsetWidth, h = card.offsetHeight;
  const lx = ox - pad, ly = oy - pad;                       // button position in card coords
  const dx = lx - w / 2, dy = ly - h / 2;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  card.style.transformOrigin =
    `${Math.min(w, Math.max(0, lx))}px ${Math.min(h, Math.max(0, ly))}px`;
  return {
    opacity: 0,
    // subtle: a short drift toward the button and a slight shrink, no rotation
    transform: `translate(${(ux * 10).toFixed(1)}px, ${(uy * 10).toFixed(1)}px) scale(0.94)`,
  };
}

function playMotion({ type, delay, dur, ox, oy }) {
  const folded = foldedFrame(ox, oy);
  const open = { opacity: 1, transform: 'none' };
  // start from wherever the card is right now, so a quick re-toggle reverses smoothly
  const cs = getComputedStyle(card);
  const from = { opacity: cs.opacity, transform: cs.transform === 'none' ? 'none' : cs.transform };
  const wasFolded = card.classList.contains('folded');
  if (motionAnim) motionAnim.cancel();
  card.classList.remove('folded');

  const reveal = type === 'reveal';
  const fast = reduceMotion.matches;
  const keyframes = reveal
    ? [wasFolded ? folded : from, open]
    : [wasFolded ? folded : from, folded];
  // fill both: hold the start frame during the stagger delay
  motionAnim = card.animate(keyframes, {
    duration: fast ? 1 : dur,
    delay: fast ? 0 : delay,
    easing: reveal ? 'cubic-bezier(0.23, 1, 0.32, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
    fill: 'both',
  });
  motionAnim.onfinish = () => {
    if (!reveal) card.classList.add('folded');   // stays invisible while the window is hidden
    motionAnim.cancel();
    motionAnim = null;
    if (reveal) card.style.transformOrigin = '';
  };
  if (!reveal) closePops();
}
api.onMotion(playMotion);

// ---------- init ----------
(async () => {
  const res = await api.get(id);
  memo = res.memo;
  if (res.hidden) card.classList.add('folded');
  $('text').value = memo.text || '';
  $('btnPin').classList.toggle('on', !!memo.pinned);
  applyColor();
  applyOpacity();
  renderFontOptions();
  await loadCustomFonts(res.fonts);
  if (!memo.text) $('text').focus();
})();
