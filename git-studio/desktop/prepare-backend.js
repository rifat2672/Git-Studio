// Collects what the installer ships next to the Electron app, in desktop/stage:
//   stage/backend   compiled server + production node_modules
//   stage/frontend  built UI (the server finds it at ../../frontend/dist)
// It is kept outside the asar archive because node-pty is a native module.
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const stage = path.join(__dirname, 'stage')

for (const dist of ['backend/dist/server.js', 'frontend/dist/index.html']) {
  if (!fs.existsSync(path.join(root, dist))) throw new Error(`Missing ${dist}. Run "npm run build" in the root folder first.`)
}

fs.rmSync(stage, { recursive: true, force: true })
fs.cpSync(path.join(root, 'backend/dist'), path.join(stage, 'backend/dist'), { recursive: true })
fs.cpSync(path.join(root, 'frontend/dist'), path.join(stage, 'frontend/dist'), { recursive: true })

const { name, version, dependencies } = JSON.parse(fs.readFileSync(path.join(root, 'backend/package.json'), 'utf8'))
fs.writeFileSync(path.join(stage, 'backend/package.json'), JSON.stringify({ name, version, private: true, dependencies }, null, 2))

execSync('npm install --omit=dev --no-package-lock --no-audit --no-fund', { cwd: path.join(stage, 'backend'), stdio: 'inherit' })
console.log(`Staged backend and frontend in ${stage}`)
