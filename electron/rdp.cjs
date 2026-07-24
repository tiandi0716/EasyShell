const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { shell } = require('electron')

function sanitizeRdpValue(value) {
  return String(value || '')
    .replace(/[\r\n]/g, '')
    .trim()
}

function buildRdpFileContent(config) {
  const host = sanitizeRdpValue(config.host)
  const port = Number(config.port) || 3389
  const username = sanitizeRdpValue(config.username || 'Administrator')
  const address = port === 3389 ? host : `${host}:${port}`
  const lines = [
    'screen mode id:i:2',
    'use multimon:i:0',
    'desktopwidth:i:1920',
    'desktopheight:i:1080',
    'session bpp:i:32',
    'compression:i:1',
    'keyboardhook:i:2',
    'audiocapturemode:i:0',
    'videoplaybackmode:i:1',
    'connection type:i:7',
    'networkautodetect:i:1',
    'bandwidthautodetect:i:1',
    'displayconnectionbar:i:1',
    'enableworkspacereconnect:i:0',
    'disable wallpaper:i:0',
    'allow font smoothing:i:1',
    'allow desktop composition:i:1',
    'disable full window drag:i:0',
    'disable menu anims:i:0',
    'disable themes:i:0',
    'disable cursor setting:i:0',
    'bitmapcachepersistenable:i:1',
    `full address:s:${address}`,
    `username:s:${username}`,
    'prompt for credentials:i:1',
    'authentication level:i:2',
    'negotiate security layer:i:1',
    'remoteapplicationmode:i:0',
    'alternate shell:s:',
    'shell working directory:s:',
    'gatewayhostname:s:',
    'gatewayusagemethod:i:4',
    'gatewaycredentialssource:i:4',
    'gatewayprofileusagemethod:i:0',
    'promptcredentialonce:i:0',
    'gatewaybrokeringtype:i:0',
    'use redirection server name:i:0',
    'rdgiskdcproxy:i:0',
    'kdcproxyname:s:',
  ]
  return `${lines.join('\r\n')}\r\n`
}

function writeTempRdpFile(config) {
  const safeName = sanitizeRdpValue(config.name || config.host || 'easyshell')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 40)
  const filePath = path.join(os.tmpdir(), `easyshell-${safeName}-${Date.now()}.rdp`)
  fs.writeFileSync(filePath, buildRdpFileContent(config), 'utf8')
  return filePath
}

function run(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.unref()
    resolve()
  })
}

async function openWithMicrosoftRemoteDesktop(filePath) {
  const appPath = '/Applications/Microsoft Remote Desktop.app'
  if (fs.existsSync(appPath)) {
    await run('open', ['-a', 'Microsoft Remote Desktop', filePath])
    return 'Microsoft Remote Desktop'
  }
  // 系统默认关联打开 .rdp
  await run('open', [filePath])
  return '系统默认应用'
}

async function openRdpConnection(config) {
  const host = sanitizeRdpValue(config.host)
  if (!host) throw new Error('主机地址不能为空')
  const port = Number(config.port) || 3389
  const filePath = writeTempRdpFile(config)

  if (process.platform === 'darwin') {
    const app = await openWithMicrosoftRemoteDesktop(filePath)
    return {
      path: filePath,
      app,
      host,
      port,
      hint:
        app === 'Microsoft Remote Desktop'
          ? '已用 Microsoft Remote Desktop 打开。若提示输入密码，请粘贴已保存的密码。'
          : '已打开 .rdp 文件。建议安装微软「Microsoft Remote Desktop」。',
    }
  }

  if (process.platform === 'win32') {
    const target = port === 3389 ? host : `${host}:${port}`
    await new Promise((resolve, reject) => {
      execFile('mstsc.exe', [filePath], { windowsHide: true }, (err) => {
        if (err) {
          execFile('mstsc.exe', [`/v:${target}`], { windowsHide: true }, (err2) => {
            if (err2) reject(err2)
            else resolve()
          })
          return
        }
        resolve()
      })
    })
    return {
      path: filePath,
      app: 'mstsc',
      host,
      port,
      hint: '已调用 Windows 远程桌面（mstsc）。',
    }
  }

  // Linux：尽量用 xfreerdp / remmina
  const username = sanitizeRdpValue(config.username || 'Administrator')
  try {
    await run('xfreerdp', [`/v:${host}:${port}`, `/u:${username}`, '/cert:ignore'])
    return {
      path: filePath,
      app: 'xfreerdp',
      host,
      port,
      hint: '已调用 xfreerdp。',
    }
  } catch {
    await shell.openPath(filePath)
    return {
      path: filePath,
      app: 'default',
      host,
      port,
      hint: '已打开 .rdp 文件，请用系统远程桌面客户端连接。',
    }
  }
}

module.exports = {
  openRdpConnection,
  buildRdpFileContent,
}
