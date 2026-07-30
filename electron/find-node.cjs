const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function listNvmNodes() {
  const base = path.join(os.homedir(), '.nvm', 'versions', 'node')
  try {
    return fs
      .readdirSync(base)
      .map((v) => path.join(base, v, 'bin', 'node'))
      .filter(isExecutable)
      .sort()
      .reverse()
  } catch {
    return []
  }
}

function whichFromLoginShell() {
  try {
    const out = execFileSync('/bin/zsh', ['-lc', 'command -v node'], {
      encoding: 'utf8',
      timeout: 3000,
      env: process.env,
    })
    const p = String(out || '').trim().split('\n')[0]
    return p && isExecutable(p) ? p : null
  } catch {
    try {
      const out = execFileSync('/bin/bash', ['-lc', 'command -v node'], {
        encoding: 'utf8',
        timeout: 3000,
        env: process.env,
      })
      const p = String(out || '').trim().split('\n')[0]
      return p && isExecutable(p) ? p : null
    } catch {
      return null
    }
  }
}

/**
 * 解析可用于跑 RDP worker 的系统 Node（OpenSSL，非 Electron BoringSSL）。
 * GUI 启动时 PATH 往往不含 nvm/homebrew，需主动探测。
 */
function findSystemNode() {
  const candidates = [
    process.env.EASYSHELL_NODE,
    process.env.NODE_BINARY,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    ...listNvmNodes(),
  ].filter(Boolean)

  for (const c of candidates) {
    if (isExecutable(c)) return c
  }

  const fromShell = whichFromLoginShell()
  if (fromShell) return fromShell

  return null
}

function needsExternalNode() {
  return Boolean(process.versions.electron) && !process.env.EASYSHELL_RDP_WORKER
}

module.exports = { findSystemNode, needsExternalNode, isExecutable }
