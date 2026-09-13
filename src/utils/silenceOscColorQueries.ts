import type { Terminal, IDisposable } from 'xterm'

/**
 * 静默 OSC 4/10/11/12 的「颜色查询」（Pt 含 `?`），不向 PTY 回写应答。
 *
 * xterm.js 会按规范应答 ESC]11;rgb:...ST，经 Electron IPC + SSH 往往晚于远端工具
 * 的短超时；工具已恢复 ECHO 后，应答会当作键盘输入泄漏到 bash/zsh 提示符，表现为
 * `11;rgb:0b0b/1010/1616` 一类乱码。FinalShell 等客户端若不答或答得更快则不易复现。
 *
 * 颜色「设置」仍交给内置 handler（本 handler 对非查询返回 false）。
 */
export function silenceOscColorQueries(term: Terminal): IDisposable {
  const isQuery = (data: string) => data.split(';').includes('?')

  const disposables = [4, 10, 11, 12].map((ident) =>
    term.parser.registerOscHandler(ident, (data) => {
      if (isQuery(data)) return true
      return false
    }),
  )

  return {
    dispose: () => {
      for (const d of disposables) d.dispose()
    },
  }
}
