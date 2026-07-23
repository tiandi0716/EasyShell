import { FormEvent, useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  onConfirm: (value: string) => void
  onClose: () => void
}

export default function PromptDialog({
  title,
  label,
  defaultValue = '',
  placeholder,
  confirmText = '确定',
  onConfirm,
  onClose,
}: Props) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValue(defaultValue)
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [defaultValue])

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = value.trim()
    if (!v) return
    onConfirm(v)
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <form className="modal modal-sm" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        <div className="form-grid">
          <div className="field">
            {label ? <label>{label}</label> : null}
            <input
              ref={inputRef}
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  )
}
