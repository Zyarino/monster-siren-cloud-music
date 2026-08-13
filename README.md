# Monster Siren Cloud Music

A desktop app (Electron) to browse, **download**, and **play** Arknights music from
[Monster Siren Records](https://monster-siren.hypergryph.com) — Hypergryph's official music label.

![GUI](https://img.shields.io/badge/GUI-Electron-blue?logo=electron) ![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows)

## Features

- **Browse albums** — official album covers and track lists from Monster Siren's API
- **Search** — filter albums, songs, and artists instantly
- **Download songs / albums** — saves original `.wav` files locally with album-folder structure, skips already-downloaded tracks, cancellable queue with progress bars
- **Spotify-like player** — play/pause, next/prev, seek, shuffle & repeat, volume, queue
- **Synced lyrics** — fetches the official LRC lyrics and highlights the current line
- **System Media Controls (SMTC)** — control playback from your keyboard media keys and the Windows media overlay (with cover art)
- **Your Music library** — quick access to albums you've downloaded
- **Portable build** — package the app into a standalone `.exe` with `npm run dist`

Songs that are already downloaded are played from disk; otherwise they stream from Monster Siren's CDN.

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- npm

## Getting started

```bash
npm install
npm start
```

> **Note:** If the Electron binary download is slow/fails in your region, set a mirror first:
> `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`

## Build a standalone Windows launcher

```bash
npm run dist
```

This creates a portable build at `dist\MonsterSirenCloudMusic\` — double-click
`MonsterSirenCloudMusic.exe` to run. No extra dependencies are needed at runtime.

## How it works

The app uses Monster Siren's public API:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/albums` | List all albums |
| `GET /api/album/{cid}/detail` | Album detail + songs |
| `GET /api/songs` | Full song list |
| `GET /api/song/{cid}` | Song detail (audio `sourceUrl`, `lyricUrl`) |

Downloads stream the audio directly to disk. Playback streams through a local proxy
(`ms-audio://`) so the CDN's required headers and HTTP range requests (seeking) are handled.

## Project structure

```
main.js         Electron main process: window, IPC, download queue, streaming/cover proxies, SMTC artwork server
preload.js      Safe contextBridge API for the renderer
index.html      UI markup (sidebar, player bar, lyrics panel, download queue)
styles.css      Spotify-like dark theme
renderer.js     Renderer logic: views, search, downloads, player, lyrics, Media Session
build.ps1       Builds the portable .exe
msr.svg         App logo
```

## License

MIT
