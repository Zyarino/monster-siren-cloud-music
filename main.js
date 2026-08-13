const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { pathToFileURL } = require('url');

const API_BASE = 'https://monster-siren.hypergryph.com/api';
const SITE_ORIGIN = 'https://monster-siren.hypergryph.com/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let mainWindow = null;
let downloadDir = '';
let queue = [];
let activeTask = null;
let pausedKeys = new Set();
const activeStreams = new Map();
const lastProgressSend = new Map();
const songCache = new Map();

protocol.registerSchemesAsPrivileged([
  { scheme: 'ms-cover', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'ms-audio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function httpGet(url, onResponse) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': UA, Referer: SITE_ORIGIN } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(httpGet(new URL(res.headers.location, url).toString(), onResponse));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve({ res, req });
    });
    req.on('error', reject);
  });
}

function fetchJson(url) {
  return httpGet(url, null).then(({ res }) => {
    return new Promise((resolve, reject) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 0) resolve(json.data);
          else reject(new Error(json.msg || 'API error'));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
  });
}

function sanitize(name) {
  return String(name || 'unknown')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[.\s]+$/g, '')
    .trim();
}

async function getSong(cid) {
  if (!songCache.has(cid)) {
    songCache.set(cid, fetchJson(`${API_BASE}/song/${cid}`));
    songCache.get(cid).catch(() => songCache.delete(cid));
  }
  return songCache.get(cid);
}

function fetchText(url) {
  return httpGet(url, null).then(({ res }) => {
    return new Promise((resolve, reject) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
  });
}

const lyricCache = new Map();
function getLyrics(cid) {
  if (lyricCache.has(cid)) return lyricCache.get(cid);
  const p = (async () => {
    const song = await getSong(cid);
    if (!song || !song.lyricUrl) return '';
    return fetchText(song.lyricUrl);
  })().catch(() => '');
  lyricCache.set(cid, p);
  return p;
}

function coverPath(url) {
  const parsed = new URL(url);
  const base = path.basename(parsed.pathname);
  return `ms-cover://cover/${encodeURIComponent(base)}?u=${encodeURIComponent(url)}`;
}

function defaultDownloadDir() {
  return path.join(app.getPath('music'), 'MonsterSiren');
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

function nextKey() {
  return `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function downloadStream(key, songCid, url, filePath) {
  return new Promise((resolve, reject) => {
    let req = null;
    const ws = fs.createWriteStream(filePath);
    const handle = { key, songCid, url, filePath };

    ws.on('error', (e) => {
      if (req) req.destroy();
      reject(e);
    });

    httpGet(url, null)
      .then(({ res, req: r }) => {
        req = r;
        const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          const now = Date.now();
          const last = lastProgressSend.get(key) || 0;
          if (now - last >= 150 || received >= total) {
            lastProgressSend.set(key, now);
            send('download-progress', { key, songCid, received, total });
          }
        });
        res.on('error', (e) => {
          activeStreams.delete(songCid);
          ws.destroy();
          reject(e);
        });
        req.on('error', (e) => {
          activeStreams.delete(songCid);
          ws.destroy();
          reject(e);
        });
        res.pipe(ws);
        ws.on('finish', () => {
          activeStreams.delete(songCid);
          lastProgressSend.delete(key);
          ws.close();
          resolve();
        });
        ws.on('error', (e) => {
          activeStreams.delete(songCid);
          reject(e);
        });
      })
      .catch((e) => {
        activeStreams.delete(songCid);
        reject(e);
      });

    activeStreams.set(songCid, { req: () => req, handle, ws });
  });
}

async function runTask(task) {
  try {
    const song = await fetchJson(`${API_BASE}/song/${task.songCid}`);
    if (!song || !song.sourceUrl) throw new Error('No audio source found');

    const songName = sanitize(song.name || task.name);
    const dir = task.subdir ? path.join(downloadDir, task.subdir) : downloadDir;
    await ensureDir(dir);

    const ext = path.extname(new URL(song.sourceUrl).pathname) || '.wav';
    const filePath = path.join(dir, `${songName}${ext}`);

    if (fs.existsSync(filePath)) {
      send('download-item-done', { key: task.key, songCid: task.songCid, name: song.name, success: true, skipped: true, filePath });
      return;
    }

    send('download-item-start', { key: task.key, songCid: task.songCid, name: song.name });
    await downloadStream(task.key, task.songCid, song.sourceUrl, filePath);
    send('download-item-done', { key: task.key, songCid: task.songCid, name: song.name, success: true, filePath });
  } catch (e) {
    send('download-item-done', {
      key: task.key,
      songCid: task.songCid,
      name: task.name,
      success: false,
      error: String(e.message || e),
    });
  }
}

function pump() {
  if (activeTask || queue.length === 0) return;
  if (pausedKeys.size > 0) return;
  activeTask = queue.shift();
  runTask(activeTask).finally(() => {
    activeTask = null;
    send('download-queue-progress', { remaining: queue.length });
    pump();
  });
}

function enqueue(items, subdir) {
  const key = nextKey();
  const tasks = items.map((it) => ({ key, songCid: it.cid, name: it.name, subdir }));
  queue.push(...tasks);
  send('download-queue-progress', { remaining: queue.length });
  pump();
  return { key, total: tasks.length };
}

function cancelKey(key) {
  queue = queue.filter((t) => t.key !== key);
  if (activeTask && activeTask.key === key) {
    const h = activeStreams.get(activeTask.songCid);
    if (h) {
      try { h.req() && h.req().destroy(); } catch (_) {}
      try { h.ws.destroy(); } catch (_) {}
    }
    activeStreams.delete(activeTask.songCid);
  }
  send('download-queue-progress', { remaining: queue.length });
}

function pauseAll() {
  pausedKeys.clear();
  queue.forEach((t) => pausedKeys.add(t.key));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => (mainWindow = null));
}

ipcMain.handle('get-albums', () => fetchJson(`${API_BASE}/albums`));
ipcMain.handle('get-songs', () => fetchJson(`${API_BASE}/songs`).then((d) => (d && d.list) || []));
ipcMain.handle('get-album', (_e, cid) => fetchJson(`${API_BASE}/album/${cid}/detail`));
ipcMain.handle('get-song', (_e, cid) => getSong(cid));

ipcMain.handle('local-song', (_e, { albumName, songName }) => {
  try {
    const dir = path.join(downloadDir, sanitize(albumName));
    const base = sanitize(songName);
    for (const ext of ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac']) {
      const p = path.join(dir, `${base}${ext}`);
      if (fs.existsSync(p)) return pathToFileURL(p).href;
    }
  } catch (_) {}
  return null;
});

let artBase = '';
function startArtServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/cover') { res.writeHead(404); res.end(); return; }
    const target = u.searchParams.get('u');
    if (!target) { res.writeHead(400); res.end(); return; }
    const mod = target.startsWith('https:') ? https : http;
    mod
      .get(target, { headers: { 'User-Agent': UA, Referer: SITE_ORIGIN } }, (r) => {
        if (r.statusCode !== 200) {
          r.resume();
          res.writeHead(r.statusCode || 502);
          res.end();
          return;
        }
        res.writeHead(200, {
          'content-type': r.headers['content-type'] || 'image/jpeg',
          'cache-control': 'public, max-age=86400',
        });
        r.pipe(res);
      })
      .on('error', () => { res.writeHead(502); res.end(); });
  });
  server.listen(0, '127.0.0.1', () => {
    artBase = `http://127.0.0.1:${server.address().port}`;
  });
}

ipcMain.handle('get-lyrics', (_e, cid) => getLyrics(cid));
ipcMain.handle('get-art-base', () => artBase);

ipcMain.handle('get-dir', () => downloadDir || defaultDownloadDir());
ipcMain.handle('select-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose download folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: downloadDir || defaultDownloadDir(),
  });
  if (!res.canceled && res.filePaths.length) downloadDir = res.filePaths[0];
  return downloadDir;
});
ipcMain.handle('open-dir', async () => {
  await ensureDir(downloadDir || defaultDownloadDir());
  shell.openPath(downloadDir || defaultDownloadDir());
});

ipcMain.handle('download', (_e, payload) => {
  const subdir = payload.subdir ? sanitize(payload.subdir) : null;
  return enqueue(payload.items, subdir);
});
ipcMain.handle('cancel-download', (_e, key) => cancelKey(key));
ipcMain.handle('pause-all', () => pauseAll());
ipcMain.handle('resume-all', () => {
  pausedKeys.clear();
  pump();
  return queue.length;
});

app.whenReady().then(() => {
  protocol.handle('ms-cover', (request) => {
    const u = new URL(request.url).searchParams.get('u');
    if (!u) return new Response('', { status: 400 });
    return net.fetch(u, {
      headers: {
        'User-Agent': UA,
        Referer: SITE_ORIGIN,
        Accept: 'image/*',
      },
    });
  });

  protocol.handle('ms-audio', async (request) => {
    const url = new URL(request.url);
    const cid = url.pathname.split('/').pop();
    if (!cid) return new Response('', { status: 400 });
    try {
      const song = await getSong(cid);
      if (!song || !song.sourceUrl) return new Response('No audio source', { status: 404 });
      const headers = { 'User-Agent': UA, Referer: SITE_ORIGIN, Accept: '*/*' };
      const range = request.headers.get('range');
      if (range) headers.Range = range;
      const upstream = await net.fetch(song.sourceUrl, { headers });
      const hdrs = {};
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
        const v = upstream.headers.get(k);
        if (v) hdrs[k] = v;
      }
      return new Response(upstream.body, { status: upstream.status, headers: hdrs });
    } catch (e) {
      return new Response(String(e && e.message ? e.message : e), { status: 500 });
    }
  });

  downloadDir = defaultDownloadDir();
  startArtServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
