import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  value: string
  options: string[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

export default function ScrollSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const maxHeight = 220
    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow
    const height = Math.min(maxHeight, Math.max(120, openUp ? spaceAbove : spaceBelow))
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      zIndex: 200,
      maxHeight: height,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onReposition = () => setOpen(false)
    window.addEventListener('mousedown', onPointer, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('mousedown', onPointer, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    const active = listRef.current.querySelector<HTMLElement>('[data-active="1"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [open, value])

  const label = value || placeholder

  return (
    <div className={`scroll-select ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="scroll-select-trigger"
        disabled={disabled || !options.length}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={value ? '' : 'scroll-select-placeholder'}>{label}</span>
        <span className="scroll-select-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open
        ? createPortal(
            <ul
              className="scroll-select-menu"
              role="listbox"
              ref={listRef}
              style={menuStyle}
            >
              {options.map((opt) => {
                const active = opt === value
                return (
                  <li
                    key={opt}
                    role="option"
                    aria-selected={active}
                    data-active={active ? '1' : '0'}
                  >
                    <button
                      type="button"
                      className={`scroll-select-option ${active ? 'active' : ''}`}
                      onClick={() => {
                        onChange(opt)
                        setOpen(false)
                      }}
                    >
                      {active ? (
                        <span className="scroll-select-check">✓</span>
                      ) : (
                        <span className="scroll-select-check" />
                      )}
                      <span>{opt}</span>
                    </button>
                  </li>
                )
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  )
}
