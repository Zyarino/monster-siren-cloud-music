const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ms', {
  getAlbums: () => ipcRenderer.invoke('get-albums'),
  getSongs: () => ipcRenderer.invoke('get-songs'),
  getAlbum: (cid) => ipcRenderer.invoke('get-album', cid),
  getSong: (cid) => ipcRenderer.invoke('get-song', cid),
  getLyrics: (cid) => ipcRenderer.invoke('get-lyrics', cid),
  getArtBase: () => ipcRenderer.invoke('get-art-base'),
  localSong: (payload) => ipcRenderer.invoke('local-song', payload),
  getDir: () => ipcRenderer.invoke('get-dir'),
  selectDir: () => ipcRenderer.invoke('select-dir'),
  openDir: () => ipcRenderer.invoke('open-dir'),
  download: (payload) => ipcRenderer.invoke('download', payload),
  cancelDownload: (key) => ipcRenderer.invoke('cancel-download', key),
  pauseAll: () => ipcRenderer.invoke('pause-all'),
  resumeAll: () => ipcRenderer.invoke('resume-all'),

  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, p) => cb(p)),
  onDownloadItemStart: (cb) => ipcRenderer.on('download-item-start', (_e, p) => cb(p)),
  onDownloadItemDone: (cb) => ipcRenderer.on('download-item-done', (_e, p) => cb(p)),
  onDownloadQueueProgress: (cb) => ipcRenderer.on('download-queue-progress', (_e, p) => cb(p)),
});
