const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoApi', {
  get: (id) => ipcRenderer.invoke('memo:get', id),
  update: (id, patch) => ipcRenderer.send('memo:update', id, patch),
  newMemo: (fromId) => ipcRenderer.send('memo:new', fromId),
  remove: (id) => ipcRenderer.send('memo:delete', id),
  pin: (id, pinned) => ipcRenderer.send('memo:pin', id, pinned),
  resize: (id, w, h) => ipcRenderer.send('memo:resize', id, w, h),
  syncStyle: (patch) => ipcRenderer.send('memo:style', patch),
  onMotion: (cb) => ipcRenderer.on('motion', (_e, m) => cb(m)),
  onStyleSync: (cb) => ipcRenderer.on('style-sync', (_e, p) => cb(p)),
  registerFont: () => ipcRenderer.invoke('font:register'),
  removeFont: (family) => ipcRenderer.send('font:remove', family),
  onFontsChanged: (cb) => ipcRenderer.on('fonts-changed', (_e, f) => cb(f)),

  toggleClick: () => ipcRenderer.send('toggle:click'),
  toggleNew: () => ipcRenderer.send('toggle:new'),
  toggleState: () => ipcRenderer.invoke('toggle:state'),
  onHiddenChanged: (cb) => ipcRenderer.on('hidden-changed', (_e, h) => cb(h)),
});
