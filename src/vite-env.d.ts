/// <reference types="vite/client" />

export interface ConnectionConfig {
  id?: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  password?: string
  privateKeyPath?: string
  passphrase?: string
  remark?: string
  folder?: string
  source?: string
  sourceId?: string
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
  exportBackup: () => Promise<{
    path: string
    filePath?: string
    connections: number
    folders: number
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
  onSessionData: (cb: (payload: { sessionId: string; data: string }) => void) => () => void
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
