import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { isPwdCommand } from '../utils/pwdSync'
import PromptDialog from './PromptDialog'

const HISTORY_KEY = 'easyshell.cmdHistory'
const SNIPPETS_KEY = 'easyshell.snippets'
const MAX_HISTORY = 200
const MAX_SNIPPETS = 80

interface Snippet {
  id: string
  name: string
  command: string
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const list = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveHistory(list: string[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-MAX_HISTORY)))
}

function loadSnippets(): Snippet[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SNIPPETS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((x) => x && typeof x.command === 'string')
      .map((x) => ({
        id: String(x.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
        name: String(x.name || x.command).slice(0, 40),
        command: String(x.command),
      }))
  } catch {
    return []
  }
}

function saveSnippets(list: Snippet[]) {
  localStorage.setItem(SNIPPETS_KEY, JSON.stringify(list.slice(0, MAX_SNIPPETS)))
}

interface Props {
  activeSessionId: string | null
  readySessionIds: string[]
  disabled?: boolean
  onPwdCommand?: (sessionIds: string[]) => void
}

export default function CommandBar({
  activeSessionId,
  readySessionIds,
  disabled,
  onPwdCommand,
}: Props) {
  const [cmd, setCmd] = useState('')
  const [sendMode, setSendMode] = useState<'current' | 'all'>('current')
  const [history, setHistory] = useState<string[]>(() => loadHistory())
  const [showPicker, setShowPicker] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [starOpen, setStarOpen] = useState(false)
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets())
  const [pickerIndex, setPickerIndex] = useState(0)
  const histIndex = useRef(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = cmd.trim().toLowerCase()
    const list = [...history].reverse()
    if (!q) return list
    return list.filter((item) => item.toLowerCase().includes(q))
  }, [cmd, history])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setShowPicker(false)
        setShowSnippets(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pushHistory(text: string) {
    setHistory((prev) => {
      const next = prev[prev.length - 1] === text ? prev : [...prev, text]
      const clipped = next.slice(-MAX_HISTORY)
      saveHistory(clipped)
      return clipped
    })
  }

  function sendTo(targets: string[], text: string) {
    const payload = text ? `${text}\r` : '\r'
    for (const id of targets) {
      window.easyshell.writeSession(id, payload)
    }
  }

  function targetsOf(mode: 'current' | 'all' = sendMode) {
    return mode === 'all' ? readySessionIds : activeSessionId ? [activeSessionId] : []
  }

  function sendText(text: string, mode: 'current' | 'all' = sendMode) {
    const targets = targetsOf(mode)
    if (!targets.length) return false
    if (isPwdCommand(text)) onPwdCommand?.(targets)
    sendTo(targets, text)
    if (text) pushHistory(text)
    histIndex.current = -1
    setShowPicker(false)
    return true
  }

  function doSend(mode: 'current' | 'all' = sendMode) {
    const text = cmd.trimEnd()
    if (!sendText(text, mode)) return
    if (text) setCmd('')
    setShowSnippets(false)
  }

  function addSnippet(name: string) {
    const command = cmd.trim()
    if (!command) return
    const next: Snippet = {
      id: `s-${Date.now().toString(16)}`,
      name: name.trim() || command.slice(0, 40),
      command,
    }
    setSnippets((prev) => {
      const list = [next, ...prev.filter((s) => s.command !== command)].slice(0, MAX_SNIPPETS)
      saveSnippets(list)
      return list
    })
    setStarOpen(false)
    setShowSnippets(true)
  }

  function removeSnippet(id: string) {
    setSnippets((prev) => {
      const list = prev.filter((s) => s.id !== id)
      saveSnippets(list)
      return list
    })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    doSend(sendMode)
  }

  function applyHistoryNav(direction: 'up' | 'down') {
    if (!history.length) return
    if (direction === 'up') {
      const next =
        histIndex.current < 0 ? history.length - 1 : Math.max(0, histIndex.current - 1)
      histIndex.current = next
      setCmd(history[next] || '')
      return
    }
    if (histIndex.current < 0) return
    const next = histIndex.current + 1
    if (next >= history.length) {
      histIndex.current = -1
      setCmd('')
    } else {
      histIndex.current = next
      setCmd(history[next] || '')
    }
  }

  return (
    <div className="cmd-bar-wrap" ref={wrapRef}>
      {showSnippets ? (
        <div className="cmd-snippet-popup">
          {snippets.length === 0 ? (
            <div className="cmd-snippet-empty">还没有快捷命令。输入命令后点「收藏」即可。</div>
          ) : (
            snippets.map((item) => (
              <div key={item.id} className="cmd-snippet-row">
                <button
                  type="button"
                  className="cmd-snippet-main"
                  title={item.command}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setCmd(item.command)
                    setShowSnippets(false)
                    histIndex.current = -1
                    inputRef.current?.focus()
                  }}
                >
                  <strong>{item.name}</strong>
                  <span>{item.command}</span>
                </button>
                <button
                  type="button"
                  className="cmd-snippet-send"
                  disabled={disabled || !readySessionIds.length}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    sendText(item.command)
                    setShowSnippets(false)
                  }}
                >
                  发送
                </button>
                <button
                  type="button"
                  className="cmd-snippet-del"
                  title="删除"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    removeSnippet(item.id)
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
          <div className="cmd-snippet-foot">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!cmd.trim()}
              onClick={() => setStarOpen(true)}
            >
              收藏当前命令
            </button>
          </div>
        </div>
      ) : null}

      {showPicker && filtered.length > 0 ? (
        <div className="cmd-history-popup">
          {filtered.slice(0, 40).map((item, idx) => (
            <button
              key={`${item}-${idx}`}
              type="button"
              className={`cmd-history-item ${idx === pickerIndex ? 'active' : ''}`}
              onMouseEnter={() => setPickerIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault()
                setCmd(item)
                setShowPicker(false)
                histIndex.current = -1
                inputRef.current?.focus()
              }}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}

      <form className="cmd-bar" onSubmit={submit}>
        <label>命令输入</label>
        <select
          className="cmd-mode"
          value={sendMode}
          onChange={(e) => setSendMode(e.target.value as 'current' | 'all')}
          title="发送目标"
          disabled={disabled}
        >
          <option value="current">当前终端</option>
          <option value="all">全部终端 ({readySessionIds.length})</option>
        </select>
        <input
          ref={inputRef}
          value={cmd}
          disabled={disabled || !readySessionIds.length}
          placeholder={
            sendMode === 'all'
              ? `回车发送到全部终端（${readySessionIds.length}）`
              : '回车发送到当前终端；Tab 选历史；↑↓ 翻历史'
          }
          onChange={(e) => {
            setCmd(e.target.value)
            histIndex.current = -1
            if (showPicker) setPickerIndex(0)
          }}
          onKeyDown={(e) => {
            if (showPicker && filtered.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setPickerIndex((i) => Math.min(filtered.length - 1, i + 1))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setPickerIndex((i) => Math.max(0, i - 1))
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                const picked = filtered[pickerIndex]
                if (picked) {
                  setCmd(picked)
                  setShowPicker(false)
                  histIndex.current = -1
                }
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setShowPicker(false)
                return
              }
            }

            if (e.key === 'Tab') {
              e.preventDefault()
              if (!history.length) return
              setShowPicker(true)
              setPickerIndex(0)
              return
            }

            if (e.key === 'ArrowUp' && !showPicker) {
              e.preventDefault()
              applyHistoryNav('up')
              return
            }
            if (e.key === 'ArrowDown' && !showPicker) {
              e.preventDefault()
              applyHistoryNav('down')
            }
          }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled}
          title="快捷命令"
          onClick={() => {
            setShowPicker(false)
            setShowSnippets((v) => !v)
          }}
        >
          快捷
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={disabled || !readySessionIds.length}
          onClick={() => doSend(sendMode)}
          title={
            sendMode === 'all'
              ? `发送到全部终端（${readySessionIds.length}）`
              : '发送到当前终端'
          }
        >
          发送
        </button>
      </form>

      {starOpen ? (
        <PromptDialog
          title="收藏快捷命令"
          label="名称"
          defaultValue={cmd.trim().slice(0, 40)}
          placeholder="例如：看磁盘"
          confirmText="收藏"
          onConfirm={addSnippet}
          onClose={() => setStarOpen(false)}
        />
      ) : null}
    </div>
  )
}
