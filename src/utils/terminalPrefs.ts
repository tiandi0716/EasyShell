const KEY = 'easyshell.terminalPrefs'

export interface TerminalPrefs {
  /** 选中文字即复制到剪贴板 */
  copyOnSelect: boolean
  /** 右键粘贴（无选中自动复制时，有选区则右键复制） */
  rightClickPaste: boolean
  /** 网络断开后自动重连（主动 exit 不重连） */
  autoReconnect: boolean
}

export const TERMINAL_PREFS_DEFAULT: TerminalPrefs = {
  copyOnSelect: true,
  rightClickPaste: true,
  autoReconnect: true,
}

/** 每次事件触发时现读，设置改完无需重开标签 */
export function readTerminalPrefs(): TerminalPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { ...TERMINAL_PREFS_DEFAULT, ...(raw && typeof raw === 'object' ? raw : {}) }
  } catch {
    return { ...TERMINAL_PREFS_DEFAULT }
  }
}

export function writeTerminalPrefs(prefs: TerminalPrefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs))
}
