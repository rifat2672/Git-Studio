// Desktop window for Git Studio. Starts the backend and shows the app from it.
// From source: run "npm run build" in the root folder first.
// Installer: run "npm run dist" in this folder (see prepare-backend.js).
const { app, BrowserWindow, shell, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')

const FIRST_PORT = Number(process.env.PORT || 4317)
const PORTS_TO_TRY = 20
const serverFile = app.isPackaged
  ? path.join(process.resourcesPath, 'app-server', 'backend', 'dist', 'server.js')
  : path.join(__dirname, '..', 'backend', 'dist', 'server.js')
let backend = null

/** 'ours' = Git Studio with its UI, 'free' = nothing there, 'busy' = some other server. */
function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (d) => { body += d })
      res.on('end', () => resolve(res.statusCode === 200 && body.includes('<title>Git Studio</title>') ? 'ours' : 'busy'))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', (e) => resolve(e.code === 'ECONNREFUSED' ? 'free' : 'busy'))
  })
}

/** Returns the port to show, starting the backend if needed, or null if it could not start. */
async function ensureBackend() {
  if (!fs.existsSync(serverFile)) {
    dialog.showErrorBox('Git Studio', 'The app is not built yet.\n\nIn the git-studio folder run:\n  npm install\n  npm run build')
    return null
  }

  let port = null
  for (let p = FIRST_PORT; p < FIRST_PORT + PORTS_TO_TRY && port === null; p++) {
    const state = await probe(p)
    if (state === 'ours') return p // already running (e.g. npm start in a terminal)
    if (state === 'free') port = p
  }
  if (port === null) {
    dialog.showErrorBox('Git Studio', `No free port between ${FIRST_PORT} and ${FIRST_PORT + PORTS_TO_TRY - 1}.`)
    return null
  }

  const logDir = app.getPath('userData')
  fs.mkdirSync(logDir, { recursive: true })
  const logFile = path.join(logDir, 'backend.log')
  const log = fs.openSync(logFile, 'w')
  // Electron's own runtime acts as Node here, so the user does not need Node installed.
  backend = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: String(port), ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', log, log],
    windowsHide: true
  })
  backend.on('error', (e) => dialog.showErrorBox('Git Studio', `Could not start the backend: ${e.message}`))
  for (let i = 0; i < 60; i++) {
    if (await probe(port) === 'ours') return port
    await new Promise((r) => setTimeout(r, 250))
  }
  dialog.showErrorBox('Git Studio', `The backend did not start. Details are in:\n${logFile}`)
  return null
}

app.whenReady().then(async () => {
  const port = await ensureBackend()
  if (port === null) {
    if (backend) backend.kill()
    return app.quit()
  }
  const appUrl = `http://localhost:${port}`
  const win = new BrowserWindow({ width: 1440, height: 920, backgroundColor: '#0F1115', title: 'Git Studio', autoHideMenuBar: true })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(appUrl)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.loadURL(appUrl)
})

app.on('window-all-closed', () => {
  if (backend) backend.kill()
  app.quit()
})
