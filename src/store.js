const fs = require('fs');
const path = require('path');

let file = null;
let state = { memos: [], fonts: [], hidden: false, toggleVisible: true };
let timer = null;

function load(f) {
  file = f;
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch { /* first run */ }
}

function flush() {
  clearTimeout(timer);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
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
