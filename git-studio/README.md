# Git Studio

Ek jaygay onek git project manage korar app. Button chaplei git er kaj hoy, terminal e dekhay ki command cholche, ar kono problem hole Claude ba Codex ke diye fix korano jay.

## Folder structure

```
git-studio/
├─ backend/      Node.js REST API + WebSocket (Express). Git, GitHub, terminal, AI.
│  ├─ src/server.ts   all API routes
│  ├─ src/git.ts      every git command (runGit logs each one to the Activity tab)
│  ├─ src/github.ts   GitHub API (create repo, create release)
│  ├─ src/pty.ts      real terminals (Claude / Codex / Shell tabs)
│  ├─ src/ai.ts       "claude -p" helpers (commit message, release notes)
│  ├─ src/store.ts    projects + settings in ~/.git-studio/config.json
│  └─ test/smoke.ts   20 end-to-end checks against a temp repo
├─ frontend/     React + Vite UI. Talks only to the backend API.
│  └─ src/components/  ChangesView, HistoryView, VersionsView, MergeView, TerminalPanel, Sidebar, Dialogs
└─ desktop/      Optional Electron window that starts the backend and opens the UI
```

## Ja lagbe

- **Node.js 20+** and **Git** (on your PATH)
- For the AI tabs: **Claude Code** (`claude`) and/or **Codex CLI** (`codex`), installed and logged in
- For GitHub upload/releases: a **GitHub personal access token** (Settings → Developer settings → Personal access tokens; classic token with `repo` scope)

## Chalano

```bash
cd git-studio
npm install          # installs backend + frontend
```

**Development** (code change korle auto reload hoy):

```bash
npm run dev          # backend on :4317, frontend on :5173
```
Then open **http://localhost:5173**.

**Normal use** (build kore ek port e chalano):

```bash
npm run build
npm start            # open http://localhost:4317
```

**Desktop window** (alada app window e):

```bash
npm run build
cd desktop
npm install
npm start
```

**Test:** `npm test` (creates a temp repo and checks commit, branches, merge conflict, history, versions, restore, zip, security, terminal).

## Prothombar

1. Bam pashe niche **Connect GitHub** e click kore token din.
2. **+ Add folder** diye project jog korun, othoba **Clone from URL** ba **Import another repo** use korun.
3. Project jodi GitHub e na thake, upore **Upload to GitHub** chaplei repo baniye push hoye jabe.

## Features

| Tab | Ki kora jay |
|---|---|
| Changes | File stage/unstage, diff, discard, commit, AI commit message, commit & push, branch switch/new/delete, stash |
| History | Branch-colored commit graph, filter by branch/author/text. Commit e click korle: kon branch e banano, ekhon kon branch e ache, kon version e ache, ar kon file bodleche. Button: View diff, New branch from here, Copy to current branch (cherry-pick), Undo (revert), Mark as version, Explain with Claude |
| Versions | Version save (git tag + GitHub Release), auto version number (fix / feature / big change), AI release notes, What changed, Download .zip, Start work from here (new branch), Restore files (as a new commit, history stays) |
| Merge | Merge a branch. Conflict hole: current/incoming pasha-pashi, Keep current / incoming / both, hand edit, Fix all with Claude/Codex, Abort, Complete |
| Terminal | Activity (every git command + output; failed command e Fix with Claude/Codex), Claude, Codex, Shell tabs |

## API (backend)

Base URL `http://127.0.0.1:4317/api`. Success: `{ "data": ... }`. Error: `{ "error": "message" }` with status 400/404.
`:id` is a project id from `GET /projects`.

| Method | Path | Body / query |
|---|---|---|
| GET | `/health`, `/logs`, `/settings` | |
| PUT | `/settings` | `{ token?, clearToken?, pullMode? }` |
| GET | `/fs/dirs` | `?path=` |
| GET / POST | `/projects` | POST `{ path }` |
| DELETE | `/projects/:id` | |
| POST | `/projects/clone` | `{ url, parentDir, folder }` |
| POST | `/projects/import` | `{ url, parentDir, folder, private }` |
| GET | `/projects/:id/status` | |
| POST | `/projects/:id/init`, `/publish`, `/remotes`, `/open-folder` | publish `{ name, private, description }`, remotes `{ name, url }` |
| POST | `/projects/:id/stage`, `/unstage` | `{ files: [] }` |
| POST | `/projects/:id/discard` | `{ file, untracked }` |
| GET | `/projects/:id/diff` | `?file=` |
| POST | `/projects/:id/commit` | `{ message }` |
| POST | `/projects/:id/push`, `/pull`, `/fetch` | |
| GET / POST | `/projects/:id/branches` | POST `{ name, base }` |
| POST | `/projects/:id/branches/switch` | `{ name, stash }` |
| POST | `/projects/:id/branches/delete` | `{ name, force, remote }` |
| POST | `/projects/:id/merge` | `{ source }` → `{ conflicts }` |
| POST | `/projects/:id/merge/abort`, `/merge/complete` | |
| GET | `/projects/:id/conflicts` | |
| POST | `/projects/:id/conflicts/resolve` | `{ file, side: ours\|theirs\|both\|content, content? }` |
| GET / POST | `/projects/:id/stash`, POST `/stash/pop` | |
| GET | `/projects/:id/log` | `?branch=&limit=` |
| GET | `/projects/:id/commits/:hash`, `/commits/:hash/diff` | |
| POST | `/projects/:id/commits/:hash/cherry-pick`, `/revert` | revert `{ isMerge }` |
| GET / POST | `/projects/:id/versions` | POST `{ name, title, notes, target, push, release }` |
| GET | `/projects/:id/versions/latest`, `/versions/:name/changes?from=`, `/versions/:name/zip` | |
| POST | `/projects/:id/versions/:name/push`, `/start` `{ branch }`, `/restore` | |
| POST | `/projects/:id/ai/commit-message`, `/ai/release-notes` `{ since }` | |

WebSocket `ws://127.0.0.1:4317/ws`:
- server → client: `{type:'log', entry}`, `{type:'pty:data', key, data}`, `{type:'pty:exit', key}`
- client → server: `{type:'pty:start', key, kind:'claude'|'codex'|'shell', projectId, cols, rows}`, `pty:write {key,data}`, `pty:resize {key,cols,rows}`, `pty:kill {key}`

## Nirapotta (security)

- Backend shudhu `127.0.0.1` e shone, tai onno computer theke access kora jay na.
- Onno kono website theke ashle request bondho kora hoy. Eta Host ar Origin check diye hoy, karon ei API apnar computer e command chalate pare.
- GitHub token ta `~/.git-studio/config.json` e thake, sudhu apnar user porte pare (permission 600). Activity tab e token kokhono dekhano hoy na.
- Force push ba `reset --hard` er moto bipodjonok command app nije theke chalay na. Restore ar Undo shob shomoy notun commit banay, history thake.

## Kichu kotha

- Kono folder e prothombar Claude chalale Claude Code jiggesh korte pare "Do you trust this folder?". Claude tab e giye ekbar Yes din.
- "Made on branch" ta git nije save kore na. App eta `git name-rev` diye ber kore. Branch delete hoye gele "unknown" dekhabe.
- Restore files korar age uncommitted change commit ba stash korte hoy. `.env*` file gulo hat dey na.
