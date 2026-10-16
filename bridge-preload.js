// Preload for the hidden eldorado.gg bridge window. Lets injected page code
// (TalkJS chat listener) push events back to the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zotacBridge', {
  emit: (type, payload) => ipcRenderer.send('bridge:event', { type, payload })
});
