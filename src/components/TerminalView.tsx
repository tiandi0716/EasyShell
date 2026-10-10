import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon, type ISearchOptions } from 'xterm-addon-search'
import { feedTerminalLine, isPwdCommand } from '../utils/pwdSync'
import { silenceOscColorQueries } from '../utils/silenceOscColorQueries'
import { readTerminalPrefs } from '../utils/terminalPrefs'
import { isMac } from '../utils/platform'
import 'xterm/css/xterm.css'

const SEARCH_DECORATIONS: ISearchOptions['decorations'] = {
  matchBackground: '#2b4a63',
  matchBorder: '#4f86b3',
  matchOverviewRuler: '#61afef',
  activeMatchBackground: '#8a6a12',
  activeMatchBorder: '#f0d08a',
  activeMatchColorOverviewRuler: '#f0d08a',
}

/** mac 用 Cmd+F；其它平台 Ctrl+F 是 shell 的光标右移，改用 Ctrl+Shift+F */
function isFindShortcut(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 'f' || e.altKey) return false
  return isMac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey
}

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
  const searchRef = useRef<SearchAddon | null>(null)
  /** seq 每次 +1 让已打开的搜索框重新聚焦 */
  const [search, setSearch] = useState<{ seq: number } | null>(null)
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
    let oscSilenceDispose: { dispose: () => void } | undefined
    let resizeObserver: ResizeObserver | undefined
    let removeMouseListeners: (() => void) | undefined

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
        // mac 默认右键选词，会和「右键粘贴 / 选中即复制」打架
        rightClickSelectsWord: false,
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
      const searchAddon = new SearchAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon())
      term.loadAddon(searchAddon)
      term.open(host)
      // 拦截 OSC 颜色查询，避免应答经 SSH 延迟泄漏进 shell 输入
      oscSilenceDispose = silenceOscColorQueries(term)
      fit.fit()
      if (active) term.focus()

      termRef.current = term
      fitRef.current = fit
      searchRef.current = searchAddon

      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && isFindShortcut(e)) {
          e.preventDefault()
          setSearch((s) => ({ seq: (s?.seq ?? 0) + 1 }))
          return false
        }
        return true
      })

      // 只在鼠标松开时复制：搜索定位也会改选区，不能把它当成用户选中
      const onMouseUp = () => {
        window.setTimeout(() => {
          if (disposed || !readTerminalPrefs().copyOnSelect || !term.hasSelection()) return
          void window.easyshell.writeClipboard(term.getSelection())
        }, 0)
      }
      const onMouseDown = (e: MouseEvent) => {
        // 拖选可能在终端外松开，所以挂到 document 上
        if (e.button === 0) document.addEventListener('mouseup', onMouseUp, { once: true })
      }
      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault()
        const prefs = readTerminalPrefs()
        // vim/htop 等开了鼠标模式时，右键交给远端程序
        if (!prefs.rightClickPaste || term.modes.mouseTrackingMode !== 'none') return
        if (term.hasSelection() && !prefs.copyOnSelect) {
          void window.easyshell.writeClipboard(term.getSelection())
          term.clearSelection()
          return
        }
        term.focus()
        void window.easyshell.readClipboard().then((text) => {
          if (text && !disposed) term.paste(text)
        })
      }
      host.addEventListener('mousedown', onMouseDown)
      host.addEventListener('contextmenu', onContextMenu)
      removeMouseListeners = () => {
        host.removeEventListener('mousedown', onMouseDown)
        host.removeEventListener('contextmenu', onContextMenu)
        document.removeEventListener('mouseup', onMouseUp)
      }

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
      oscSilenceDispose?.dispose()
      resizeObserver?.disconnect()
      removeMouseListeners?.()
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
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

  function closeSearch() {
    searchRef.current?.clearDecorations()
    termRef.current?.clearSelection()
    setSearch(null)
    termRef.current?.focus()
  }

  return (
    <>
      <div className="terminal-host" ref={hostRef} />
      {search && searchRef.current ? (
        <TerminalSearchBar addon={searchRef.current} focusSeq={search.seq} onClose={closeSearch} />
      ) : null}
    </>
  )
}

function TerminalSearchBar({
  addon,
  focusSeq,
  onClose,
}: {
  addon: SearchAddon
  focusSeq: number
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<{ index: number; count: number } | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSeq])

  useEffect(() => {
    const sub = addon.onDidChangeResults(({ resultIndex, resultCount }) =>
      setResults({ index: resultIndex, count: resultCount }),
    )
    return () => sub.dispose()
  }, [addon])

  function find(text: string, backwards: boolean, opts: { incremental?: boolean; caseSensitive?: boolean } = {}) {
    if (!text) {
      addon.clearDecorations()
      setResults(null)
      return
    }
    const options: ISearchOptions = {
      caseSensitive: opts.caseSensitive ?? caseSensitive,
      incremental: opts.incremental,
      decorations: SEARCH_DECORATIONS,
    }
    if (backwards) addon.findPrevious(text, options)
    else addon.findNext(text, options)
  }

  function toggleCase() {
    const next = !caseSensitive
    setCaseSensitive(next)
    // 插件按关键词缓存高亮，只改大小写选项时要先清掉才会重算
    addon.clearDecorations()
    find(query, false, { caseSensitive: next })
    inputRef.current?.focus()
  }

  const summary = !query || !results
    ? ''
    : results.count === 0
      ? '无结果'
      : results.index >= 0
        ? `${results.index + 1}/${results.count}`
        : `${results.count}+`

  return (
    <div className="term-search">
      <input
        ref={inputRef}
        value={query}
        placeholder="搜索终端输出"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          find(e.target.value, false, { incremental: true })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            find(query, e.shiftKey)
          }
        }}
      />
      <span className={`term-search-count${results?.count === 0 && query ? ' empty' : ''}`}>{summary}</span>
      <button
        type="button"
        className={`term-search-btn${caseSensitive ? ' on' : ''}`}
        title="区分大小写"
        onClick={toggleCase}
      >
        Aa
      </button>
      <button type="button" className="term-search-btn" title="上一个 (Shift+Enter)" onClick={() => find(query, true)}>
        ↑
      </button>
      <button type="button" className="term-search-btn" title="下一个 (Enter)" onClick={() => find(query, false)}>
        ↓
      </button>
      <button type="button" className="term-search-btn" title="关闭 (Esc)" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
