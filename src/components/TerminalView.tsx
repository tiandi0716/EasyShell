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

    const host = hostRef.current
    let disposed = false
    let disposeData: (() => void) | undefined
    let onDataDispose: { dispose: () => void } | undefined
    let resizeObserver: ResizeObserver | undefined

    const fontFamily = 'Menlo, Monaco, "IBM Plex Mono", Consolas, "Courier New", monospace'
    const fontSize = 13

    async function boot() {
      // 等等宽字体就绪再测字宽，避免选区比字形宽一截
      try {
        if (document.fonts?.load) {
          await Promise.all([
            document.fonts.load(`${fontSize}px Menlo`),
            document.fonts.load(`${fontSize}px "IBM Plex Mono"`),
          ])
          await document.fonts.ready
        }
      } catch {
        // ignore
      }
      if (disposed || !hostRef.current) return

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        cursorWidth: 1.5,
        fontFamily,
        fontSize,
        // 1.0：单元格贴齐字形，选区不再「虚高」
        lineHeight: 1,
        letterSpacing: 0,
        theme: {
          background: '#0b1016',
          foreground: '#e7eef7',
          cursor: '#7cffb2',
          selectionBackground: 'rgba(61, 206, 160, 0.35)',
          selectionInactiveBackground: 'rgba(61, 206, 160, 0.22)',
          black: '#0b1016',
          red: '#f07178',
          green: '#3dcea0',
          yellow: '#e6c07b',
          blue: '#61afef',
          magenta: '#c678dd',
          cyan: '#56d9b0',
          white: '#e7eef7',
          brightBlack: '#5c6b7a',
          brightRed: '#ff9a9a',
          brightGreen: '#7cffb2',
          brightYellow: '#f0d08a',
          brightBlue: '#89b4fa',
          brightMagenta: '#d5a6e6',
          brightCyan: '#8ae0c4',
          brightWhite: '#ffffff',
        },
        allowProposedApi: true,
      })

      const fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon())
      term.open(host)
      fit.fit()
      if (active) term.focus()

      termRef.current = term
      fitRef.current = fit

      function pushResize(cols: number, rows: number) {
        if (cols < 2 || rows < 2) return
        window.easyshell.resizeSession(sessionId, cols, rows)
        for (const id of syncIdsRef.current) {
          if (id !== sessionId) window.easyshell.resizeSession(id, cols, rows)
        }
      }

      // 按 offset 去重，避免「缓冲回放 + 实时推送」重复写入
      let nextOffset = 0

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

      disposeData = window.easyshell.onSessionData(({ sessionId: id, data, offset }) => {
        if (id === sessionId) applyOutput(data, offset)
      })

      void window.easyshell.getSessionOutput(sessionId).then((buf) => {
        if (disposed || !buf?.data) return
        applyOutput(buf.data, buf.base ?? 0)
      })

      onDataDispose = term.onData((data) => {
        window.easyshell.writeSession(sessionId, data)
        const { line, submitted } = feedTerminalLine(lineBufRef.current, data)
        lineBufRef.current = line
        if (submitted !== null && isPwdCommand(submitted)) {
          onPwdRef.current?.(sessionId)
        }
      })

      resizeObserver = new ResizeObserver(() => {
        const el = hostRef.current
        if (!el || el.clientWidth < 20 || el.clientHeight < 20) return
        fit.fit()
        pushResize(term.cols, term.rows)
      })
      resizeObserver.observe(host)
      pushResize(term.cols, term.rows)
    }

    void boot()

    return () => {
      disposed = true
      disposeData?.()
      onDataDispose?.dispose()
      resizeObserver?.disconnect()
      termRef.current?.dispose()
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
