const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zotac', {
  call: async (ch, ...args) => {
    const r = await ipcRenderer.invoke(ch, ...args);
    if (!r.ok) { const e = new Error(r.error); e.status = r.status; e.data = r.data; throw e; }
    return r.value;
  },
  on: (ch, fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
  // main -> renderer requests (image rendering)
  onCall: handlers => ipcRenderer.on('rcall', async (_e, { id, name, payload }) => {
    try { const value = await handlers[name](payload); ipcRenderer.send('rcall:result', { id, ok: true, value }); }
    catch (err) { ipcRenderer.send('rcall:result', { id, ok: false, error: String(err && err.message || err) }); }
  })
});
