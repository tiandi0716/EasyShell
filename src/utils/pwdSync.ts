/** 去掉终端 ANSI / OSC 控制序列，便于解析 pwd 输出 */
export function stripAnsi(input: string): string {
  return input
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[PX^_].*?\u001b\\/g, '')
    .replace(/\u001b./g, '')
}

export function isPwdCommand(cmd: string): boolean {
  return /^\s*pwd(?:\s+-\w+)*\s*$/.test(cmd)
}

/** 从 pwd 命令后的输出缓冲中提取绝对路径 */
export function extractPwdPath(buffer: string): string | null {
  const text = stripAnsi(buffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (isPwdCommand(line)) continue
    // 只要一行干净的绝对路径
    if (!line.startsWith('/')) continue
    if (/\s/.test(line)) continue
    if (/[$#%>]$/.test(line)) continue
    if (/[\x00-\x1f]/.test(line)) continue
    const normalized = line.replace(/\/+$/, '') || '/'
    return normalized
  }
  return null
}

/** 跟踪用户在终端里输入的当前行，检测是否提交了 pwd */
export function feedTerminalLine(line: string, data: string): { line: string; submitted: string | null } {
  let next = line
  let submitted: string | null = null
  let i = 0

  while (i < data.length) {
    const ch = data[i]

    if (ch === '\u001b') {
      i += 1
      if (data[i] === '[') {
        i += 1
        while (i < data.length && /[0-9;?]/.test(data[i])) i += 1
        if (i < data.length) i += 1
      } else if (i < data.length) {
        i += 1
      }
      continue
    }

    if (ch === '\r' || ch === '\n') {
      submitted = next
      next = ''
      i += 1
      continue
    }

    if (ch === '\u007f' || ch === '\b') {
      next = next.slice(0, -1)
      i += 1
      continue
    }

    if (ch === '\u0015' || ch === '\u0003' || ch === '\u0004') {
      next = ''
      i += 1
      continue
    }

    if (ch >= ' ') {
      next += ch
    }
    i += 1
  }

  return { line: next, submitted }
}
