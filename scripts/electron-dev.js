import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Cross-platform replacement for the POSIX `LEYLINE_DEV_SERVER_URL=... electron .`
// script form, which cmd.exe/PowerShell cannot parse. Sets the dev-server URL
// (unless the caller already set it) and launches the local Electron binary.
const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

process.env.LEYLINE_DEV_SERVER_URL ||= 'http://localhost:5173'

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: false,
})

child.on('error', (error) => {
  console.error(`Failed to launch Electron: ${error.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
