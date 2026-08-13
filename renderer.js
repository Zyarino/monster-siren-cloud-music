const $ = (sel) => document.querySelector(sel);
const content = $('#content');
const audio = $('#audio');

const state = {
  albums: [],
  songs: [],
  mode: 'albums',
  album: null,
  query: '',
  downloads: new Map(),
  paused: false,
  lastBatch: null,
};

const playback = {
  playing: false,
  shuffle: false,
  repeat: 'off',
  volume: parseFloat(localStorage.getItem('ms_vol')) || 0.8,
};
let playlist = [];
let playlistIndex = -1;
let errCount = 0;
let artBase = '';

const lyricsState = { cid: null, lines: [], open: false, current: -1 };

const nav = [];
let navIndex = -1;
let library = loadLib();

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function coverUrl(url) {
  if (!url) return '';
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop());
    return `ms-cover://cover/${encodeURIComponent(base)}?u=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

function setCover(img, url) {
  if (url) {
    img.src = coverUrl(url);
    img.classList.remove('empty');
  } else {
    img.removeAttribute('src');
    img.classList.add('empty');
  }
}

function artistsOf(artists) {
  return (Array.isArray(artists) ? artists : []).join(', ') || '塞壬唱片-MSR';
}

function findAlbum(cid) {
  return state.albums.find((a) => a.cid === String(cid)) || null;
}

function fmtBytes(b) {
  if (!b) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function parseLrc(text) {
  const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const entries = [];
  for (const raw of String(text || '').split('\n')) {
    const times = [];
    let m;
    const r = new RegExp(re.source, 'g');
    while ((m = r.exec(raw)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = parseInt(m[3] || '0', 10);
      const div = m[3] && m[3].length === 2 ? 100 : m[3] && m[3].length === 3 ? 1000 : 100;
      times.push(min * 60 + sec + frac / div);
    }
    if (times.length) {
      const text = raw.replace(re, '').trim();
      times.forEach((t) => entries.push({ t, text }));
    }
  }
  entries.sort((a, b) => a.t - b.t);
  return entries;
}

function ic(name) {
  const map = {
    dl: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4.5-4.5M12 15 7.5 10.5"/><path d="M4 19.5h16"/></svg>',
    pause: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>',
    play: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  };
  return map[name] || '';
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function showPlaceholder(text) {
  content.innerHTML = `<div class="placeholder"><span class="spin"></span><br><br>${esc(text)}</div>`;
}

/* ---------------- library ---------------- */

function loadLib() {
  try { return JSON.parse(localStorage.getItem('ms_lib')) || []; } catch { return []; }
}
function saveLib() { localStorage.setItem('ms_lib', JSON.stringify(library)); }

function addToLibrary(album) {
  if (!album || !album.cid) return;
  if (!library.find((a) => a.cid === album.cid)) {
    library.unshift({ cid: album.cid, name: album.name, coverUrl: album.coverUrl });
    library = library.slice(0, 40);
    saveLib();
    renderLib();
  }
}

function renderLib() {
  const el = $('#lib-list');
  if (!library.length) {
    el.innerHTML = '<div class="lib-empty">Albums you download appear here.</div>';
    return;
  }
  el.innerHTML = library
    .map(
      (a) => `
    <button class="lib-item" data-cid="${esc(a.cid)}">
      <img src="${esc(coverUrl(a.coverUrl))}" alt="" />
      <span class="lib-name">${esc(a.name)}</span>
    </button>`
    )
    .join('');
  el.querySelectorAll('.lib-item').forEach((b) => b.addEventListener('click', () => openAlbum(b.dataset.cid)));
}

/* ---------------- navigation ---------------- */

function setActiveNav(mode) {
  $('#nav-home').classList.toggle('active', mode !== 'search');
  $('#nav-search').classList.toggle('active', mode === 'search');
}

function pushView(v) {
  nav.splice(navIndex + 1);
  nav.push(v);
  navIndex++;
  syncNav();
}
function replaceView(v) {
  nav[navIndex] = v;
}
function syncNav() {
  $('#back-btn').disabled = navIndex <= 0;
  $('#fwd-btn').disabled = navIndex >= nav.length - 1;
}
function goBack() {
  if (navIndex > 0) { navIndex--; renderFromNav(nav[navIndex]); }
  syncNav();
}
function goForward() {
  if (navIndex < nav.length - 1) { navIndex++; renderFromNav(nav[navIndex]); }
  syncNav();
}

function renderFromNav(v) {
  state.query = v.query || '';
  $('#search').value = state.query;
  $('#search-clear').hidden = !state.query;
  if (v.mode === 'album' && v.album) {
    state.mode = 'album';
    state.album = v.album;
    renderAlbumDetail(v.album);
  } else if (v.mode === 'search') {
    renderSearchFromAll();
  } else {
    renderAlbums();
  }
}

/* ---------------- init & load ---------------- */

async function init() {
  const dir = await window.ms.getDir();
  artBase = await window.ms.getArtBase();
  $('#dir-btn').textContent = dir;
  $('#top-dir-label').textContent = dir;
  renderLib();
  bindHeader();
  bindPlayer();
  bindDownloads();
  bindAudio();
  setupMediaSession();
  setVolume(playback.volume);
  loadAlbums();
}

async function loadAlbums() {
  showPlaceholder('Loading albums from Monster Siren…');
  try {
    const [albums, songs] = await Promise.all([window.ms.getAlbums(), window.ms.getSongs()]);
    state.albums = albums || [];
    state.songs = songs || [];
    renderAlbums();
  } catch (e) {
    content.innerHTML = `<div class="placeholder">Failed to load: ${esc(e.message)}<br><br><button class="dl-all-btn" onclick="location.reload()">Retry</button></div>`;
  }
}

/* ---------------- views ---------------- */

function renderAlbums() {
  state.mode = 'albums';
  state.album = null;
  setActiveNav('albums');
  if (state.query) { renderSearchFromAll(); return; }
  renderAlbumGrid(state.albums);
}

function albumCardHtml(a) {
  return `
    <div class="album-card" data-cid="${esc(a.cid)}">
      <div class="album-cover-wrap">
        <img class="album-cover" src="${esc(coverUrl(a.coverUrl))}" loading="lazy" alt="" />
        <button class="play-btn" data-cid="${esc(a.cid)}" title="Play album">${ic('play')}</button>
        <button class="dl-btn" data-cid="${esc(a.cid)}" title="Download album">${ic('dl')}</button>
      </div>
      <div class="album-name" title="${esc(a.name)}">${esc(a.name)}</div>
      <div class="album-artists">${esc(artistsOf(a.artistes))}</div>
    </div>`;
}

function renderAlbumGrid(albums) {
  if (!albums.length) {
    content.innerHTML = '<div class="placeholder">No albums found.</div>';
    return;
  }
  const cards = albums.map(albumCardHtml).join('');

  content.innerHTML = `
    <div class="home-title">Welcome Back, Doctor</div>
    <p class="home-sub">${albums.length} albums from Monster Siren Records</p>
    <div class="section-label">Albums</div>
    <div class="grid">${cards}</div>`;

  bindAlbumCards();
}

function bindAlbumCards() {
  content.querySelectorAll('.album-card').forEach((card) => {
    const cid = card.dataset.cid;
    card.addEventListener('click', () => openAlbum(cid));
  });
  content.querySelectorAll('.album-card .play-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const album = state.albums.find((a) => a.cid === btn.dataset.cid);
      if (album) playFromAlbum(album);
    });
  });
  content.querySelectorAll('.album-card .dl-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const album = state.albums.find((a) => a.cid === btn.dataset.cid);
      if (album) downloadAlbum(album);
    });
  });
}

async function openAlbum(cid, fromHistory = false) {
  if (!fromHistory) showPlaceholder('Loading album…');
  try {
    const album = await window.ms.getAlbum(cid);
    state.album = album;
    state.mode = 'album';
    renderAlbumDetail(album);
    if (!fromHistory) pushView({ mode: 'album', cid, album });
  } catch (e) {
    toast(`Failed to load album: ${e.message}`, 'error');
    if (nav[navIndex] && nav[navIndex].mode === 'album') goBack();
    else renderAlbums();
  }
}

function renderAlbumDetail(album) {
  state.mode = 'album';
  setActiveNav('albums');
  const songs = album.songs || [];
  const trackRows = songs.length
    ? songs
        .map(
          (s, i) => `
        <div class="track-row playable" data-cid="${esc(s.cid)}">
          <span class="track-index"><span class="idx">${i + 1}</span><span class="play-hint">${ic('play')}</span></span>
          <div class="track-main">
            <div class="track-name">${esc(s.name)}</div>
            <div class="track-artists">${esc(artistsOf(s.artistes))}</div>
          </div>
          <button class="track-dl" data-cid="${esc(s.cid)}" data-name="${esc(s.name)}" title="Download">${ic('dl')}</button>
        </div>`
        )
        .join('')
    : '<div class="track-empty">No songs in this album.</div>';

  content.innerHTML = `
    <div class="album-page">
      <div class="album-header">
        <img class="album-big-cover" src="${esc(coverUrl(album.coverUrl))}" alt="" />
        <div class="album-head-text">
          <div class="album-tag">Album</div>
          <h1 class="album-title">${esc(album.name)}</h1>
          ${album.intro ? `<p class="album-intro">${esc(album.intro)}</p>` : ''}
          <p class="album-meta">${esc(artistsOf(album.artistes || album.artists))} · <b>${songs.length}</b> songs</p>
          <div class="album-actions">
            <button class="header-play" id="header-play" ${songs.length ? '' : 'disabled'} title="Play album">${ic('play')}</button>
            <button class="dl-all-btn" ${songs.length ? '' : 'disabled'}>${ic('dl')} Download all</button>
          </div>
        </div>
      </div>
      <div class="track-section">
        <div class="track-list">${trackRows}</div>
      </div>
    </div>`;

  content.querySelectorAll('.track-row').forEach((row, i) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.track-dl')) return;
      playFromAlbum(album, i);
    });
  });
  content.querySelectorAll('.track-dl').forEach((btn) => {
    btn.addEventListener('click', () => downloadSingle(btn.dataset.cid, btn.dataset.name, album));
  });
  content.querySelector('#header-play').addEventListener('click', () => playFromAlbum(album));
  content.querySelector('.dl-all-btn').addEventListener('click', () => downloadAlbum(album));
  highlightPlaying();
}

function renderSearchFromAll() {
  state.mode = 'search';
  setActiveNav('search');
  const query = state.query.toLowerCase();

  const albums = state.albums.filter(
    (a) => a.name.toLowerCase().includes(query) || artistsOf(a.artistes).toLowerCase().includes(query)
  );
  const songs = state.songs.filter(
    (s) => s.name.toLowerCase().includes(query) || artistsOf(s.artists).toLowerCase().includes(query)
  );

  let html = `<div class="search-title">${esc(state.query ? `Results for “${state.query}”` : 'Search')}</div>
    <div class="home-sub">${albums.length + songs.length} matches</div>`;

  if (albums.length) {
    html += `<div class="section-label small">Albums</div><div class="grid">${albums.map(albumCardHtml).join('')}</div>`;
  }

  if (songs.length) {
    html += `<div class="section-label small">Songs</div><div class="song-list">${songs
      .map((s) => {
        const album = findAlbum(s.albumCid);
        const cover = album ? coverUrl(album.coverUrl) : '';
        return `
        <div class="track-row playable" data-cid="${esc(s.cid)}">
          <span class="track-index"><span class="idx">♪</span><span class="play-hint">${ic('play')}</span></span>
          <img class="track-cover" src="${esc(cover)}" alt="" />
          <div class="track-main">
            <div class="track-name">${esc(s.name)}</div>
            <div class="track-artists">${esc(album ? album.name + ' · ' : '')}${esc(artistsOf(s.artists))}</div>
          </div>
          <button class="track-dl" data-cid="${esc(s.cid)}" data-name="${esc(s.name)}" data-album-cid="${esc(s.albumCid || '')}" title="Download">${ic('dl')}</button>
        </div>`;
      })
      .join('')}</div>`;
  }

  if (!albums.length && !songs.length) {
    html = `<div class="search-title">${esc(`No results for “${state.query}”`)}</div>
      <div class="home-sub">Try a different album, song or artist name.</div>`;
  }

  content.innerHTML = html;

  bindAlbumCards();
  content.querySelectorAll('.track-row').forEach((row, i) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.track-dl')) return;
      playSearchTrack(songs[i], findAlbum(songs[i].albumCid));
    });
  });
  content.querySelectorAll('.track-dl').forEach((btn) => {
    btn.addEventListener('click', () => {
      const album = btn.dataset.albumCid ? findAlbum(btn.dataset.albumCid) : null;
      downloadSingle(btn.dataset.cid, btn.dataset.name, album);
    });
  });
  highlightPlaying();
}

/* ---------------- playback ---------------- */

function playFromAlbum(album, index = 0) {
  const alb = { cid: album.cid, name: album.name, coverUrl: album.coverUrl, artistes: album.artistes || album.artists };
  playlist = (album.songs || []).map((s) => ({ cid: s.cid, name: s.name, album: alb }));
  playTrackAt(index, true);
}

function playSearchTrack(song, album) {
  const alb = album
    ? { cid: album.cid, name: album.name, coverUrl: album.coverUrl, artistes: album.artistes || album.artists }
    : null;
  playlist = [{ cid: song.cid, name: song.name, album: alb }];
  playTrackAt(0, true);
}

async function playTrackAt(index, autoplay = true) {
  if (index < 0 || index >= playlist.length) return;
  playlistIndex = index;
  const t = playlist[index];
  try {
    let src = null;
    if (t.album && t.album.name) {
      const local = await window.ms.localSong({ albumName: t.album.name, songName: t.name });
      if (local) src = local;
    }
    if (!src) src = `ms-audio://song/${t.cid}`;
    if (audio.src !== src) audio.src = src;
    if (autoplay) await audio.play();
  } catch (e) {
    toast(`Playback error: ${e.message}`, 'error');
  }
  loadLyrics(t.cid);
  updateMediaSession();
  highlightPlaying();
  renderPlayer();
}

function togglePlay() {
  if (playlistIndex < 0 || !playlist.length) {
    if (state.lastBatch && state.lastBatch.album) playFromAlbum(state.lastBatch.album);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function nextTrack() {
  if (!playlist.length) return;
  if (playback.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  let idx;
  if (playback.shuffle && playlist.length > 1) {
    idx = (playlistIndex + 1 + Math.floor(Math.random() * (playlist.length - 1))) % playlist.length;
  } else {
    idx = playlistIndex + 1;
    if (idx >= playlist.length) {
      if (playback.repeat === 'all') idx = 0;
      else { stopPlayback(); return; }
    }
  }
  playTrackAt(idx, true);
}

function prevTrack() {
  if (!playlist.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let idx = playlistIndex - 1;
  if (idx < 0) idx = playlist.length - 1;
  playTrackAt(idx, true);
}

function stopPlayback() {
  audio.pause();
  audio.removeAttribute('src');
  playback.playing = false;
  errCount = 0;
  updatePlayPauseBtn();
  renderPlayer();
  highlightPlaying();
  updateMediaSession();
}

function highlightPlaying() {
  content.querySelectorAll('.track-row.playing').forEach((r) => r.classList.remove('playing'));
  if (playlistIndex < 0 || !playlist[playlistIndex]) return;
  const row = content.querySelector(`.track-row[data-cid="${playlist[playlistIndex].cid}"]`);
  if (row) row.classList.add('playing');
}

function updatePlayPauseBtn() {
  const btn = $('#play-pause-btn');
  btn.innerHTML = playback.playing ? ic('pause') : ic('play');
  btn.title = playback.playing ? 'Pause' : 'Play';
}

function setVolume(v) {
  playback.volume = v;
  audio.volume = v;
  localStorage.setItem('ms_vol', String(v));
  $('#vol-slider').value = Math.round(v * 100);
  $('#vol-btn').classList.toggle('muted', v === 0);
}

function bindAudio() {
  audio.addEventListener('timeupdate', () => {
    if (playlistIndex >= 0) {
      renderPlayer();
      updateLyrics();
      updateSessionPosition();
    }
  });
  audio.addEventListener('loadedmetadata', () => { renderPlayer(); updateMediaSession(); });
  audio.addEventListener('play', () => {
    playback.playing = true;
    errCount = 0;
    updatePlayPauseBtn();
    renderPlayer();
    updateMediaSession();
  });
  audio.addEventListener('pause', () => {
    playback.playing = false;
    updatePlayPauseBtn();
    renderPlayer();
    updateMediaSession();
  });
  audio.addEventListener('ended', () => nextTrack());
  audio.addEventListener('error', () => {
    errCount++;
    if (playlist.length && playlistIndex >= 0 && errCount >= Math.max(3, playlist.length)) {
      toast('Playback stopped: multiple tracks failed', 'error');
      stopPlayback();
      return;
    }
    if (playlist.length && playlistIndex >= 0) toast(`Could not play “${playlist[playlistIndex].name}”`, 'error');
    nextTrack();
  });
}

/* ---------------- lyrics ---------------- */

function loadLyrics(cid) {
  window.ms.getLyrics(cid).then((text) => {
    if (playlistIndex < 0 || playlist[playlistIndex].cid !== cid) return;
    lyricsState.cid = cid;
    lyricsState.lines = parseLrc(text);
    lyricsState.current = -1;
    if (lyricsState.open) renderLyrics();
  });
}

function renderLyrics() {
  const cont = $('#lyrics');
  const t = playlist[playlistIndex];
  if (t) {
    $('#lyr-name').textContent = t.name;
    $('#lyr-sub').textContent = t.album ? `${artistsOf(t.album.artistes)} · ${t.album.name}` : '';
    if (t.album && t.album.coverUrl) setCover($('#lyr-cover'), t.album.coverUrl);
    else setCover($('#lyr-cover'), '');
  }
  if (!lyricsState.lines.length) {
    cont.innerHTML = '<div class="lyr-empty">No lyrics available for this track.</div>';
    return;
  }
  cont.innerHTML = lyricsState.lines
    .map((l, i) => `<div class="lyr-line${i === lyricsState.current ? ' active' : ''}">${esc(l.text || '♪')}</div>`)
    .join('');
  if (lyricsState.current >= 0) {
    const els = cont.querySelectorAll('.lyr-line');
    if (els[lyricsState.current]) els[lyricsState.current].scrollIntoView({ block: 'center' });
  }
}

function updateLyrics() {
  if (!lyricsState.open || !lyricsState.lines.length) return;
  if (playlistIndex < 0 || lyricsState.cid !== playlist[playlistIndex].cid) return;
  const t = audio.currentTime;
  let idx = -1;
  for (let i = 0; i < lyricsState.lines.length; i++) {
    if (lyricsState.lines[i].t <= t) idx = i;
    else break;
  }
  if (idx === lyricsState.current) return;
  lyricsState.current = idx;
  const els = document.querySelectorAll('#lyrics .lyr-line');
  els.forEach((el, i) => el.classList.toggle('active', i === idx));
  if (idx >= 0 && els[idx]) els[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function toggleLyrics() {
  lyricsState.open = !lyricsState.open;
  $('#lyrics-panel').classList.toggle('hidden', !lyricsState.open);
  $('#lyrics-btn').classList.toggle('active', lyricsState.open);
  if (lyricsState.open) renderLyrics();
}

/* ---------------- SMTC (Windows media controls) ---------------- */

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler('play', () => audio.play().catch(() => {}));
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
    navigator.mediaSession.setActionHandler('seekto', (d) => {
      if (d && d.seekTime != null && isFinite(d.seekTime)) audio.currentTime = d.seekTime;
    });
  } catch (_) {}
}

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = playlist[playlistIndex];
  if (!t) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    return;
  }
  const artwork = [];
  if (artBase && t.album && t.album.coverUrl) {
    artwork.push({ src: `${artBase}/cover?u=${encodeURIComponent(t.album.coverUrl)}`, sizes: '512x512' });
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.name,
    artist: t.album ? artistsOf(t.album.artistes) : '',
    album: t.album ? t.album.name : '',
    artwork,
  });
  navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  updateSessionPosition();
}

function updateSessionPosition() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  const d = audio.duration;
  if (isFinite(d) && d > 0) {
    try {
      navigator.mediaSession.setPositionState({ duration: d, playbackRate: 1, position: audio.currentTime });
    } catch (_) {}
  }
}

/* ---------------- downloads ---------------- */

function downloadAlbum(album) {
  const items = (album.songs || []).map((s) => ({ cid: s.cid, name: s.name }));
  if (!items.length) { toast('This album has no songs.', 'error'); return; }
  startDownload(items, album.name, album);
}

function downloadSingle(cid, name, album) {
  startDownload([{ cid, name }], album ? album.name : 'Singles', album);
}

async function startDownload(items, label, album) {
  try {
    const { key, total } = await window.ms.download({ items, subdir: label });
    const map = new Map(items.map((it) => [it.cid, { name: it.name, percent: 0, state: 'waiting', bytes: 0 }]));
    state.downloads.set(key, { key, label, album, total, done: 0, failed: 0, active: true, map, firstError: '' });
    showDlPanel();
    renderDlList();
    if (items.length === 1) toast(`Downloading “${items[0].name}”`);
  } catch (e) {
    toast(`Failed to start download: ${e.message}`, 'error');
  }
}

function showDlPanel() { $('#dl-panel').classList.remove('hidden'); }
function hideDlPanel() { $('#dl-panel').classList.add('hidden'); }

function cancelBatch(key) {
  window.ms.cancelDownload(key);
  state.downloads.delete(key);
  renderDlList();
  toast('Download cancelled');
}

function updateQueueBadge() {
  const total = state.downloads.size;
  const badge = $('#queue-count');
  badge.hidden = !total;
  badge.textContent = total;
}

function renderDlList() {
  const listEl = $('#dl-list');
  if (!state.downloads.size) {
    listEl.innerHTML = '<div class="dl-empty">Nothing downloading.</div>';
  } else {
    listEl.innerHTML = [...state.downloads.values()].map(dlItemHtml).join('');
    listEl.querySelectorAll('.dl-cancel').forEach((b) => b.addEventListener('click', () => cancelBatch(b.dataset.key)));
  }
  updateQueueBadge();
  renderPlayer();
}

function dlItemHtml(d) {
  const activeItem = [...d.map.values()].find((it) => it.state === 'downloading');
  let overall = 0;
  d.map.forEach((it) => {
    overall += it.state === 'done' || it.state === 'skipped' || it.state === 'failed' ? 100 : it.percent;
  });
  const pct = d.total ? Math.round(overall / d.total) : 0;
  const finished = d.done + d.failed >= d.total;

  let status;
  if (finished) status = d.failed ? `${d.done}/${d.total} · ${d.failed} failed` : 'Complete';
  else if (activeItem) status = `${activeItem.percent}% · ${d.done + d.failed + 1}/${d.total}`;
  else status = `${d.done}/${d.total}`;

  const sub = activeItem
    ? `<span>${esc(activeItem.name)}</span><span>${esc(fmtBytes(activeItem.bytes))}</span>`
    : finished && d.failed
      ? `<span class="err">${esc(d.firstError || 'Some tracks failed')}</span>`
      : `<span>${d.done}/${d.total} tracks saved</span>`;

  return `
  <div class="dl-item ${finished && d.failed ? 'failed' : ''}" data-key="${d.key}">
    <div class="dl-item-title">
      <span class="dl-item-label" title="${esc(d.label)}">${esc(d.label)}</span>
      <span class="dl-item-status">${esc(status)}</span>
    </div>
    <div class="dl-item-sub">${sub}</div>
    <div class="dl-bar"><div style="width:${pct}%"></div></div>
    <div class="dl-item-foot"><button class="text-btn dl-cancel" data-key="${d.key}">Cancel</button></div>
  </div>`;
}

function renderPlayer() {
  const cover = $('#np-cover');
  const name = $('#np-name');
  const sub = $('#np-sub');
  const fill = $('#np-fill');
  const cur = $('#np-cur');
  const dur = $('#np-dur');

  if (playlist.length && playlistIndex >= 0) {
    const t = playlist[playlistIndex];
    setCover(cover, t.album && t.album.coverUrl ? t.album.coverUrl : '');
    name.textContent = t.name;
    sub.textContent = t.album ? `${artistsOf(t.album.artistes)} · ${t.album.name}` : '塞壬唱片-MSR';
    const d = audio.duration;
    if (isFinite(d) && d > 0) {
      const pct = Math.min(100, (audio.currentTime / d) * 100);
      fill.style.width = `${pct}%`;
      cur.textContent = fmtTime(audio.currentTime);
      dur.textContent = fmtTime(d);
    } else {
      fill.style.width = '0%';
      cur.textContent = '0:00';
      dur.textContent = '0:00';
    }
    return;
  }

  const batch = [...state.downloads.values()].find((d) => d.active && d.done + d.failed < d.total) || state.lastBatch;
  if (batch) {
    setCover(cover, batch.album && batch.album.coverUrl ? batch.album.coverUrl : '');
    name.textContent = batch.label;
    const activeItem = [...batch.map.values()].find((it) => it.state === 'downloading');
    sub.textContent = activeItem ? `Downloading · ${activeItem.name}` : `${batch.done}/${batch.total} saved`;
    let overall = 0;
    batch.map.forEach((it) => {
      overall += it.state === 'done' || it.state === 'skipped' || it.state === 'failed' ? 100 : it.percent;
    });
    const pct = batch.total ? Math.round(overall / batch.total) : 0;
    fill.style.width = `${pct}%`;
    cur.textContent = pct ? `${pct}%` : '';
    dur.textContent = '';
    state.lastBatch = batch;
  } else {
    setCover(cover, '');
    name.textContent = 'Not playing';
    sub.textContent = 'Ready';
    fill.style.width = '0%';
    cur.textContent = '0:00';
    dur.textContent = '0:00';
  }
}

let dlRenderPending = false;
function scheduleDlRender() {
  if (dlRenderPending) return;
  dlRenderPending = true;
  requestAnimationFrame(() => { dlRenderPending = false; renderDlList(); });
}

/* ---------------- event bindings ---------------- */

function bindHeader() {
  $('#back-btn').addEventListener('click', goBack);
  $('#fwd-btn').addEventListener('click', goForward);

  $('#nav-home').addEventListener('click', () => {
    $('#search').value = '';
    state.query = '';
    $('#search-clear').hidden = true;
    pushView({ mode: 'albums' });
    renderAlbums();
  });

  $('#nav-search').addEventListener('click', () => {
    $('#search').focus();
    if (state.mode !== 'search') {
      pushView({ mode: 'search', query: state.query });
      renderSearchFromAll();
    }
  });

  $('#lib-refresh').addEventListener('click', loadAlbums);

  $('#dir-btn').addEventListener('click', async () => {
    const dir = await window.ms.selectDir();
    if (dir) { $('#dir-btn').textContent = dir; $('#top-dir-label').textContent = dir; }
  });
  $('#top-open-dir-btn').addEventListener('click', () => window.ms.openDir());
  $('#open-dir-btn').addEventListener('click', () => window.ms.openDir());

  $('#search-clear').addEventListener('click', () => {
    $('#search').value = '';
    state.query = '';
    $('#search-clear').hidden = true;
    restorePrevView();
  });

  $('#search').addEventListener('input', () => {
    state.query = $('#search').value.trim();
    $('#search-clear').hidden = !state.query;
    if (!state.query) {
      restorePrevView();
      return;
    }
    if (nav[navIndex] && nav[navIndex].mode === 'search') {
      replaceView({ mode: 'search', query: state.query });
    } else {
      pushView({ mode: 'search', query: state.query });
    }
    renderSearchFromAll();
  });
}

function restorePrevView() {
  if (nav[navIndex] && nav[navIndex].mode === 'search') goBack();
  else renderAlbums();
}

function bindPlayer() {
  $('#play-pause-btn').addEventListener('click', togglePlay);
  $('#next-btn').addEventListener('click', nextTrack);
  $('#prev-btn').addEventListener('click', prevTrack);

  $('#shuffle-btn').addEventListener('click', () => {
    playback.shuffle = !playback.shuffle;
    $('#shuffle-btn').classList.toggle('active', playback.shuffle);
  });

  $('#repeat-btn').addEventListener('click', () => {
    const order = ['off', 'all', 'one'];
    playback.repeat = order[(order.indexOf(playback.repeat) + 1) % 3];
    const btn = $('#repeat-btn');
    btn.classList.toggle('active', playback.repeat !== 'off');
    btn.classList.toggle('one', playback.repeat === 'one');
    btn.title = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[playback.repeat];
  });

  $('#vol-btn').addEventListener('click', () => {
    setVolume(playback.volume > 0 ? 0 : (parseFloat(localStorage.getItem('ms_vol')) || 0.8));
  });
  $('#vol-slider').addEventListener('input', (e) => setVolume(Number(e.target.value) / 100));

  $('#np-bar').addEventListener('mousedown', (e) => {
    if (playlistIndex < 0 || !isFinite(audio.duration) || audio.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    renderPlayer();
  });

  $('#queue-btn').addEventListener('click', () => {
    const panel = $('#dl-panel');
    if (panel.classList.contains('hidden')) showDlPanel();
    else hideDlPanel();
  });

  $('#lyrics-btn').addEventListener('click', toggleLyrics);
  $('#lyr-close').addEventListener('click', toggleLyrics);

  $('#dl-close-btn').addEventListener('click', hideDlPanel);

  $('#pause-queue-btn').addEventListener('click', async () => {
    const btn = $('#pause-queue-btn');
    if (state.paused) {
      await window.ms.resumeAll();
      state.paused = false;
      btn.textContent = 'Pause';
      btn.title = 'Pause download queue';
    } else {
      await window.ms.pauseAll();
      state.paused = true;
      btn.textContent = 'Resume';
      btn.title = 'Resume download queue';
    }
  });

  $('#clear-btn').addEventListener('click', () => {
    let cleared = false;
    [...state.downloads.entries()].forEach(([key, d]) => {
      if (d.done + d.failed >= d.total) { state.downloads.delete(key); cleared = true; }
    });
    if (cleared) { renderDlList(); toast('Finished downloads cleared'); }
  });
}

function bindDownloads() {
  window.ms.onDownloadProgress(({ key, songCid, received, total }) => {
    const d = state.downloads.get(key);
    if (!d) return;
    const it = d.map.get(songCid);
    if (!it) return;
    it.state = 'downloading';
    it.bytes = received;
    it.percent = total ? Math.round((received / total) * 100) : 0;
    scheduleDlRender();
  });

  window.ms.onDownloadItemStart(({ key, songCid, name }) => {
    const d = state.downloads.get(key);
    if (!d) return;
    const it = d.map.get(songCid);
    if (it) { it.state = 'downloading'; it.name = name; }
    renderDlList();
  });

  window.ms.onDownloadItemDone(({ key, songCid, success, skipped, name, error }) => {
    const d = state.downloads.get(key);
    if (!d) return;
    const it = d.map.get(songCid);
    if (it) {
      it.state = success ? (skipped ? 'skipped' : 'done') : 'failed';
      it.percent = 100;
      if (!success) { d.firstError = error || 'Download failed'; }
    }
    if (success) d.done++;
    else d.failed++;
    renderDlList();

    if (d.done + d.failed >= d.total) {
      if (d.done && d.album) addToLibrary(d.album);
      if (d.failed && d.done) toast(`${d.failed} of ${d.total} track(s) failed: ${d.firstError}`, 'error');
      else if (d.failed && !d.done) toast(`Download failed: ${d.firstError}`, 'error');
      else toast(`Finished “${d.label}”`, 'ok');
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
