# Monster Siren Cloud Music

A desktop app (Electron) to browse, **download**, and **play** Arknights music from
[Monster Siren Records](https://monster-siren.hypergryph.com) — Hypergryph's official music label.

![GUI](https://img.shields.io/badge/GUI-Electron-blue?logo=electron) ![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows)


## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- npm

## Getting started

```bash
npm install
npm start
```
## How it works

The app uses Monster Siren's public API:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/albums` | List all albums |
| `GET /api/album/{cid}/detail` | Album detail + songs |
| `GET /api/songs` | Full song list |
| `GET /api/song/{cid}` | Song detail (audio `sourceUrl`, `lyricUrl`) |

## License

MIT
