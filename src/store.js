const fs = require('fs');
const path = require('path');

let file = null;
let state = { memos: [], fonts: [], hidden: false, toggleVisible: true, autoStart: true };
let timer = null;

const bakOf = (f) => f.replace(/\.json$/, '.bak.json');

function readJson(f) {
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!data || !Array.isArray(data.memos)) throw new Error('invalid memo file');
  return data;
}

/**
 * Load saved memos. Every good load is copied to memos.bak.json; if the main file is
 * ever unreadable (e.g. power cut mid-write), restore from that backup instead of
 * starting empty and overwriting the user's notes.
 */
function load(f) {
  file = f;
  if (!fs.existsSync(file)) {
    if (!fs.existsSync(bakOf(file))) return;          // first run
  }
  try {
    state = { ...state, ...readJson(file) };
    fs.copyFileSync(file, bakOf(file));
  } catch (err) {
    if (fs.existsSync(file)) {
      try { fs.renameSync(file, file.replace(/\.json$/, `.corrupt-${Date.now()}.json`)); } catch { /* keep going */ }
    }
    try {
      state = { ...state, ...readJson(bakOf(file)) };
      flush();                                          // write the restored copy back as the main file
    } catch { /* no usable backup: start fresh */ }
  }
}

function flush() {
  clearTimeout(timer);
  timer = null;
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);   // atomic replace: a crash never leaves a half-written memos.json
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

module.exports = {
  load,
  flush,
  get: () => state,
  set(patch) { state = { ...state, ...patch }; save(); },
  addMemo(m) { state.memos.push(m); save(); },
  updateMemo(id, patch) {
    const m = state.memos.find((x) => x.id === id);
    if (m) { Object.assign(m, patch); save(); }
  },
  removeMemo(id) { state.memos = state.memos.filter((x) => x.id !== id); save(); },
};
