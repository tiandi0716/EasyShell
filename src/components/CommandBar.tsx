import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { isPwdCommand } from '../utils/pwdSync'

const HISTORY_KEY = 'easyshell.cmdHistory'
const MAX_HISTORY = 200

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
      if (!wrapRef.current?.contains(e.target as Node)) setShowPicker(false)
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

  function doSend(mode: 'current' | 'all' = sendMode) {
    const text = cmd.trimEnd()
    const targets =
      mode === 'all'
        ? readySessionIds
        : activeSessionId
          ? [activeSessionId]
          : []
    if (!targets.length) return
    if (isPwdCommand(text)) onPwdCommand?.(targets)
    sendTo(targets, text)
    if (text) {
      pushHistory(text)
      setCmd('')
    }
    histIndex.current = -1
    setShowPicker(false)
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
    </div>
  )
}
