import type { ConnectionConfig } from '../vite-env'

function shellQuote(value: string) {
  return /^[\w@%+=:,./~-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

function authLine(conn: ConnectionConfig): string {
  if (conn.password) return `密码：${conn.password}`
  if (conn.authType === 'key') return '认证：私钥'
  return '密码：（未保存）'
}

/** 可直接粘贴给同事的主机信息 */
export function buildConnectInfo(conn: ConnectionConfig): string {
  const isRdp = (conn.connType || 'ssh') === 'rdp'
  const port = Number(conn.port) || (isRdp ? 3389 : 22)
  return [
    `IP: ${conn.host}`,
    `${isRdp ? 'RDP端口' : 'SSH端口'}: ${port}`,
    `用户名：${conn.username || ''}`,
    authLine(conn),
  ].join('\n')
}

/** 可直接粘到本机终端的连接命令；RDP 返回 host[:port] */
export function buildConnectCommand(conn: ConnectionConfig): string {
  if ((conn.connType || 'ssh') === 'rdp') {
    const port = Number(conn.port) || 3389
    return port === 3389 ? conn.host : `${conn.host}:${port}`
  }
  const args = ['ssh']
  // 私钥库里的 key 不在磁盘上，只有旧版「文件路径」方式能带 -i
  if (conn.authType === 'key' && conn.privateKeyPath && !conn.privateKeyId) {
    args.push('-i', shellQuote(conn.privateKeyPath))
  }
  const port = Number(conn.port) || 22
  if (port !== 22) args.push('-p', String(port))
  args.push(shellQuote(`${conn.username}@${conn.host}`))
  return args.join(' ')
}
