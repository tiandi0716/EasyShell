/// <reference types="vite/client" />

export interface ConnectionConfig {
  id?: string
  /** ssh = Linux/SSH；rdp = Windows 远程桌面 */
  connType?: 'ssh' | 'rdp'
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  password?: string
  /** 本地私钥库中的 id（优先于路径） */
  privateKeyId?: string
  /** 兼容旧版：直接填本地文件路径 */
  privateKeyPath?: string
  passphrase?: string
  remark?: string
  folder?: string
  source?: string
  sourceId?: string
}

export interface PrivateKeyInfo {
  id: string
  name: string
  keyType: string
  bits: number
  createdAt?: number
}

export interface ImportResult {
  dir: string
  files: number
  imported: number
  updated: number
  failed: number
  total: number
  errors: string[]
}

export interface FileItem {
  name: string
  isDir: boolean
  size: number
  mtime: number
  mode?: number
  permissions?: string
  type?: string
  owner?: string
  group?: string
}

export interface MonitorProcess {
  pid: string
  cpu: number
  mem: number
  rss: number
  command: string
}

export interface MonitorDisk {
  filesystem: string
  size: number
  used: number
  avail: number
  usePct: string
  mount: string
}

export interface MonitorData {
  uptimeText: string
  load: number[]
  cpuPercent: number
  memTotal: number
  memUsed: number
  swapTotal: number
  swapUsed: number
  processes: MonitorProcess[]
  disks: MonitorDisk[]
  rxRate: number
  txRate: number
  netHistory: Array<{ t: number; rxRate: number; txRate: number }>
}

/** RDP 会话侧监控（无 SSH/WMI，与 Linux 监控字段不同） */
export interface RdpMonitorData {
  kind: 'rdp'
  host: string
  port: number
  username: string
  screen: { width: number; height: number }
  connectedMs: number
  frameCount: number
  tileCount: number
  bytesIn: number
  fps: number
  lastFrameAt: number | null
  status: 'connecting' | 'connected' | 'closed'
}

export interface EasyShellApi {
  listConnections: () => Promise<ConnectionConfig[]>
  saveConnection: (conn: ConnectionConfig) => Promise<ConnectionConfig>
  deleteConnection: (id: string) => Promise<boolean>
  duplicateConnection: (id: string) => Promise<ConnectionConfig>
  renameConnection: (id: string, name: string) => Promise<ConnectionConfig>
  moveConnection: (id: string, folder: string) => Promise<ConnectionConfig>
  listFolders: () => Promise<string[]>
  createFolder: (name: string) => Promise<string>
  renameFolder: (oldName: string, newName: string) => Promise<string[]>
  deleteFolder: (
    name: string,
    mode?: 'move' | 'delete',
    moveTo?: string,
  ) => Promise<{
    folders: string[]
    connections: ConnectionConfig[]
    removedConnections?: number
  }>
  writeClipboard: (text: string) => Promise<boolean>
  importFinalShell: (dir?: string | null) => Promise<ImportResult>
  pickImportDir: () => Promise<string | null>
  exportBackup: (options?: { folders?: string[] }) => Promise<{
    path: string
    filePath?: string
    connections: number
    folders: number
    keys?: number
  } | null>
  importBackup: () => Promise<{
    path: string
    filePath?: string
    imported: number
    updated: number
    total: number
    folders: number
    failed?: number
    errors?: string[]
    keysImported?: number
    keysUpdated?: number
  } | null>
  convertFinalShell: () => Promise<{
    sourceDir: string
    destDir: string
    filePath: string
    path: string
    files: number
    converted: number
    total?: number
    imported?: number
    folderCount?: number
    failed?: number
    errors?: string[]
  } | null>
  getSettings: () => Promise<{
    useSystemProxy: boolean
    detectedProxy: string | null
  }>
  setSettings: (partial: { useSystemProxy?: boolean }) => Promise<{
    useSystemProxy: boolean
  }>
  openRdpExternal: (config: ConnectionConfig) => Promise<{
    path: string
    app: string
    host: string
    port: number
    hint: string
  }>
  openRdpSession: (payload: {
    sessionId?: string
    config: ConnectionConfig & { width?: number; height?: number }
  }) => Promise<{ sessionId: string; screen: { width: number; height: number } }>
  closeRdpSession: (sessionId: string) => Promise<boolean>
  getRdpMonitor: (sessionId: string) => Promise<RdpMonitorData>
  rdpPointer: (
    sessionId: string,
    x: number,
    y: number,
    button: number,
    isPressed: boolean,
  ) => void
  rdpWheel: (
    sessionId: string,
    x: number,
    y: number,
    step: number,
    isNegative: boolean,
    isHorizontal: boolean,
  ) => void
  rdpKey: (
    sessionId: string,
    scancode: number,
    isPressed: boolean,
    extended?: boolean,
  ) => void
  onRdpBitmaps: (
    cb: (payload: {
      sessionId: string
      tiles: Array<{
        destLeft: number
        destTop: number
        destRight: number
        destBottom: number
        width: number
        height: number
        bitsPerPixel?: number
        data: ArrayBuffer | Uint8Array | number[]
      }>
    }) => void,
  ) => () => void
  onRdpBitmap: (
    cb: (payload: {
      sessionId: string
      destLeft: number
      destTop: number
      destRight: number
      destBottom: number
      width: number
      height: number
      bitsPerPixel: number
      isCompress?: boolean
      data: ArrayBuffer | Uint8Array | number[]
    }) => void,
  ) => () => void
  onRdpReady: (
    cb: (payload: {
      sessionId: string
      screen?: { width: number; height: number }
    }) => void,
  ) => () => void
  onRdpClose: (cb: (payload: { sessionId: string }) => void) => () => void
  onRdpError: (
    cb: (payload: { sessionId: string; message: string }) => void,
  ) => () => void
  listKeys: () => Promise<PrivateKeyInfo[]>
  importKey: () => Promise<PrivateKeyInfo | null>
  renameKey: (id: string, name: string) => Promise<PrivateKeyInfo>
  deleteKey: (id: string) => Promise<boolean>
  getKeyInfo: (id: string) => Promise<PrivateKeyInfo | null>
  openSession: (payload: {
    sessionId?: string
    config: ConnectionConfig & { cols?: number; rows?: number }
  }) => Promise<{ sessionId: string }>
  closeSession: (sessionId: string) => Promise<boolean>
  listOpenSessions: () => Promise<
    Array<{
      sessionId: string
      title: string
      connectionId?: string
      host: string
      username: string
      status: 'ready'
    }>
  >
  getSessionOutput: (
    sessionId: string,
  ) => Promise<{ data: string; length: number; base?: number }>
  writeSession: (sessionId: string, data: string) => void
  resizeSession: (sessionId: string, cols: number, rows: number) => void
  getMonitor: (sessionId: string) => Promise<MonitorData>
  getHome: (sessionId: string) => Promise<string>
  listDir: (sessionId: string, remotePath: string) => Promise<FileItem[]>
  download: (sessionId: string, remotePath: string) => Promise<string | null>
  downloadToDir: (
    sessionId: string,
    items: Array<{ remotePath: string; isDir: boolean }>,
    localDir?: string | null,
  ) => Promise<{ dir: string; files: string[] } | null>
  upload: (sessionId: string, remotePath: string) => Promise<string[]>
  uploadPaths: (
    sessionId: string,
    remotePath: string,
    localPaths: string[],
  ) => Promise<string[]>
  remove: (sessionId: string, remotePath: string, isDir: boolean) => Promise<boolean>
  removeRecursive: (sessionId: string, remotePath: string) => Promise<boolean>
  mkdir: (sessionId: string, remotePath: string) => Promise<boolean>
  rename: (sessionId: string, fromPath: string, toPath: string) => Promise<boolean>
  pickDirectory: (title?: string) => Promise<string | null>
  prepareDrag: (
    sessionId: string,
    remotePath: string,
    isDir: boolean,
    fileName: string,
    meta?: { mtime?: number; size?: number },
  ) => Promise<string>
  startDrag: (filePath: string) => boolean
  getPathForFile: (file: File) => string
  onSessionData: (
    cb: (payload: { sessionId: string; data: string; offset?: number }) => void,
  ) => () => void
  onSessionClose: (cb: (payload: { sessionId: string }) => void) => () => void
  onSessionError: (
    cb: (payload: { sessionId: string; message: string }) => void,
  ) => () => void
}

declare global {
  interface Window {
    easyshell: EasyShellApi
  }
}

export {}
