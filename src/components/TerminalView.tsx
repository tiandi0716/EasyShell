import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { feedTerminalLine, isPwdCommand } from '../utils/pwdSync'
import 'xterm/css/xterm.css'

interface Props {
  sessionId: string
  active: boolean
  /** 同步列宽到其它会话，保证广播 ls 等命令排版一致 */
  syncSessionIds?: string[]
  onPwdCommand?: (sessionId: string) => void
}

export default function TerminalView({
  sessionId,
  active,
  syncSessionIds = [],
  onPwdCommand,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const lineBufRef = useRef('')
  const onPwdRef = useRef(onPwdCommand)
  onPwdRef.current = onPwdCommand
  const syncIdsRef = useRef(syncSessionIds)
  syncIdsRef.current = syncSessionIds

  useEffect(() => {
    if (!hostRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 1.5,
      fontFamily: '"IBM Plex Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      theme: {
        background: '#002b36',
        foreground: '#f3f7fb',
        cursor: '#3ddc84',
        selectionBackground: 'rgba(38, 139, 210, 0.35)',
        black: '#002b36',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
        blue: '#268bd2',
        magenta: '#d33682',
        cyan: '#2aa198',
        white: '#eee8d5',
        brightBlack: '#657b83',
        brightRed: '#cb4b16',
        brightGreen: '#586e75',
        brightYellow: '#657b83',
        brightBlue: '#839496',
        brightMagenta: '#6c71c4',
        brightCyan: '#93a1a1',
        brightWhite: '#fdf6e3',
      },
      allowProposedApi: true,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)
    fit.fit()
    if (active) term.focus()

    termRef.current = term
    fitRef.current = fit

    function pushResize(cols: number, rows: number) {
      if (cols < 2 || rows < 2) return
      window.easyshell.resizeSession(sessionId, cols, rows)
      // 把当前可视终端尺寸同步到其它会话，避免广播命令时排版不一致
      for (const id of syncIdsRef.current) {
        if (id !== sessionId) window.easyshell.resizeSession(id, cols, rows)
      }
    }

    // 按 offset 去重，避免「缓冲回放 + 实时推送」重复写入
    let nextOffset = 0
    let disposed = false

    function applyOutput(data: string, offset?: number) {
      if (!data) return
      if (typeof offset === 'number') {
        const end = offset + data.length
        if (end <= nextOffset) return
        const chunk = offset < nextOffset ? data.slice(nextOffset - offset) : data
        if (chunk) term.write(chunk)
        nextOffset = end
        return
      }
      term.write(data)
    }

    const disposeData = window.easyshell.onSessionData(({ sessionId: id, data, offset }) => {
      if (id === sessionId) applyOutput(data, offset)
    })

    void window.easyshell.getSessionOutput(sessionId).then((buf) => {
      if (disposed || !buf?.data) return
      applyOutput(buf.data, buf.base ?? 0)
    })

    const onData = term.onData((data) => {
      window.easyshell.writeSession(sessionId, data)
      const { line, submitted } = feedTerminalLine(lineBufRef.current, data)
      lineBufRef.current = line
      if (submitted !== null && isPwdCommand(submitted)) {
        onPwdRef.current?.(sessionId)
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      const el = hostRef.current
      if (!el || el.clientWidth < 20 || el.clientHeight < 20) return
      fit.fit()
      pushResize(term.cols, term.rows)
    })
    resizeObserver.observe(hostRef.current)
    pushResize(term.cols, term.rows)

    return () => {
      disposed = true
      disposeData()
      onData.dispose()
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (!active) return
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    requestAnimationFrame(() => {
      const el = hostRef.current
      if (!el || el.clientWidth < 20 || el.clientHeight < 20) return
      fit.fit()
      const { cols, rows } = term
      if (cols >= 2 && rows >= 2) {
        window.easyshell.resizeSession(sessionId, cols, rows)
        for (const id of syncIdsRef.current) {
          if (id !== sessionId) window.easyshell.resizeSession(id, cols, rows)
        }
      }
      term.focus()
    })
  }, [active, sessionId])

  return <div className="terminal-host" ref={hostRef} />
}
