# EasyShell 接口文档

本文说明渲染进程通过 `window.easyshell` 调用主进程能力的约定。  
EasyShell **没有**对外 HTTP/REST 服务，所有接口均为 **Electron IPC**（进程内本地调用）。

类型定义源文件：`src/vite-env.d.ts`  
桥接实现：`electron/preload.cjs` → `electron/main.cjs`

---

## 1. 调用方式

```ts
// 渲染进程（React）
const list = await window.easyshell.listConnections()
```

| 项目 | 说明 |
|------|------|
| 全局对象 | `window.easyshell` |
| 安全模型 | `contextIsolation: true`，`nodeIntegration: false` |
| 返回值 | 多为 `Promise`；终端写入类为同步 `send` |
| 失败 | Promise reject，`Error.message` 为可读中文/英文信息 |

---

## 2. 数据模型

### 2.1 ConnectionConfig（连接配置）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 否 | 保存后由主进程生成 UUID |
| `connType` | `'ssh' \| 'rdp'` | 否 | 默认 `ssh`；`rdp` 为 Windows 远程桌面 |
| `name` | `string` | 是 | 显示名称 |
| `host` | `string` | 是 | 主机 IP/域名 |
| `port` | `number` | 是 | SSH 默认 22；RDP 默认 3389 |
| `username` | `string` | 是 | 登录用户 |
| `authType` | `'password' \| 'key'` | 是 | RDP 仅使用密码 |
| `password` | `string` | 否 | 密码（内存中为明文） |
| `privateKeyId` | `string` | 否 | 本地私钥库中的 id（优先） |
| `privateKeyPath` | `string` | 否 | 兼容旧版：私钥文件路径（SSH） |
| `passphrase` | `string` | 否 | 私钥口令 |
| `remark` | `string` | 否 | 备注 |
| `folder` | `string` | 是 | 目录分组（不能为「未分组」） |
| `source` / `sourceId` | `string` | 否 | 导入来源标记 |

### 2.2 本地存储路径

开发与正式包共用同一用户数据目录：

| 平台 | 用户数据目录 |
|------|----------------|
| macOS | `~/Library/Application Support/easyshell/` |
| Windows | `%APPDATA%/easyshell/` |

| 文件 | 说明 |
|------|------|
| `connections.json` | 连接列表（密码字段经 safeStorage 封装） |
| `folders.json` | 目录分组 |
| `private-keys.json` | 私钥库 |
| `settings.json` | 设置（如是否使用系统代理） |

落盘时 `password` / `passphrase` / 私钥 PEM 会用系统 **safeStorage** 封装（非明文）；应用读入内存后自动还原。

### 2.3 RdpMonitorData（RDP 会话监控）

与 SSH `MonitorData` 不同：RDP 通道无法采集远端 CPU/内存/进程。

| 字段 | 说明 |
|------|------|
| `host` / `port` / `username` | 会话目标 |
| `screen` | `{ width, height }` 协商分辨率 |
| `connectedMs` | 已连接时长 |
| `fps` / `frameCount` / `tileCount` / `bytesIn` | 画面传输概况 |
| `status` | `connecting` \| `connected` \| `closed` |

---

## 3. 接口一览

### 3.1 连接管理

| 前端方法 | IPC Channel | 参数 | 返回 |
|----------|-------------|------|------|
| `listConnections()` | `connections:list` | — | `ConnectionConfig[]` |
| `saveConnection(conn)` | `connections:save` | 连接对象 | 保存后的连接（含 id） |
| `deleteConnection(id)` | `connections:delete` | 连接 id | `boolean` |
| `duplicateConnection(id)` | `connections:duplicate` | 连接 id | 新连接 |
| `renameConnection(id, name)` | `connections:rename` | `{ id, name }` | 更新后的连接 |
| `moveConnection(id, folder)` | `connections:move` | `{ id, folder }` | 更新后的连接 |

### 3.2 目录管理

| 前端方法 | IPC Channel | 参数 | 返回 |
|----------|-------------|------|------|
| `listFolders()` | `connections:folders` | — | `string[]` |
| `createFolder(name)` | `connections:createFolder` | 目录名 | 目录名 |
| `renameFolder(old, new)` | `connections:renameFolder` | `{ oldName, newName }` | 目录列表 |
| `deleteFolder(name, mode?, moveTo?)` | `connections:deleteFolder` | `mode`: `delete` 删连接 / `move` 迁走 | `{ folders, connections, removedConnections? }` |

### 3.3 私钥库

| 前端方法 | IPC Channel | 说明 |
|----------|-------------|------|
| `listKeys()` | `keys:list` | 列出私钥元信息（不含 PEM） |
| `importKey()` | `keys:import` | 对话框导入私钥文件 |
| `renameKey(id, name)` | `keys:rename` | 重命名 |
| `deleteKey(id)` | `keys:delete` | 删除 |
| `getKeyInfo(id)` | `keys:get` | 单条元信息 |

连接表单通过 `privateKeyId` 引用库中私钥；SSH 打开会话时由主进程读取 PEM。

### 3.4 导入 / 导出 / 转换

| 前端方法 | IPC Channel | 行为 | 返回要点 |
|----------|-------------|------|----------|
| `exportBackup({ folders? })` | `connections:exportBackup` | 选目录写出；可指定部分分组；含私钥备份文件 | `{ path, connections, folders, keys? }` 或 `null` |
| `importBackup()` | `connections:importBackup` | 选 EasyShell 导出目录并合并（含私钥） | `{ imported, updated, total, ... }` |
| `convertFinalShell()` | `connections:convertFinalShell` | ①选 FinalShell 目录 ②选保存目录 | `{ converted, files, path, ... }` |
| `importFinalShell(dir?)` | `connections:importFinalShell` | 直接导入到本地库（开发/兼容） | `ImportResult` |
| `pickImportDir()` | `connections:pickImportDir` | 仅选择目录 | 路径或 `null` |

**导出目录结构示例：**

```text
导出根目录/
  分组A/
    主机名_connect_config.json
  分组B/
    ...
  easyshell_private_keys.json   # 若有私钥
```

**导出文件中的密码字段：**

- 算法：CryptoJS AES（口令模式，密文形如 `U2FsdGVkX1...`）  
- 口令材料在源码中异或混淆存放，运行时还原；界面不展示算法名称  
- 与历史导出文件格式兼容  

### 3.5 SSH 会话

| 前端方法 | IPC Channel | 说明 |
|----------|-------------|------|
| `openSession({ config, sessionId? })` | `ssh:open` | 建立 SSH+SFTP；自动尝试系统 SOCKS（Clash 等） |
| `closeSession(sessionId)` | `ssh:close` | 关闭会话 |
| `listOpenSessions()` | `ssh:listOpen` | 仍存活的会话（用于刷新恢复标签） |
| `getSessionOutput(sessionId)` | `ssh:getOutput` | 取输出缓冲（避免提示符丢失） |
| `writeSession(sessionId, data)` | `ssh:write` | 向终端写入（同步 send） |
| `resizeSession(sessionId, cols, rows)` | `ssh:resize` | 调整 PTY 尺寸 |
| `getMonitor(sessionId)` | `ssh:monitor` | CPU/内存/进程/磁盘监控 |
| `getHome(sessionId)` | `ssh:home` | 远端家目录 |

**主进程 → 渲染进程事件：**

| 事件 | 载荷 | 说明 |
|------|------|------|
| `ssh:data` | `{ sessionId, data, offset? }` | 终端输出；`offset` 用于去重回放 |
| `ssh:closed` | `{ sessionId }` | 会话关闭 |
| `ssh:error` | `{ sessionId, message }` | 会话错误 |

订阅示例：

```ts
const off = window.easyshell.onSessionData(({ sessionId, data }) => {
  // 写入 xterm
})
// 卸载时
off()
```

### 3.6 SFTP 文件

| 前端方法 | IPC Channel | 说明 |
|----------|-------------|------|
| `listDir(sessionId, remotePath)` | `sftp:list` | 列目录 |
| `download(sessionId, remotePath)` | `sftp:download` | 另存为 |
| `downloadToDir(sessionId, items, localDir?)` | `sftp:downloadToDir` | 批量下载到目录 |
| `upload(sessionId, remotePath)` | `sftp:upload` | 系统对话框选文件上传 |
| `uploadPaths(sessionId, remotePath, localPaths)` | `sftp:uploadPaths` | 指定本地路径上传 |
| `remove` / `removeRecursive` | `sftp:remove` / `sftp:removeRecursive` | 删除 |
| `mkdir` / `rename` | `sftp:mkdir` / `sftp:rename` | 新建目录 / 重命名 |
| `prepareDrag` + `startDrag` | `sftp:prepareDrag` / `drag:start` | macOS 拖出到访达 |

### 3.7 Windows 远程桌面（RDP）

默认在应用**内嵌标签页**中打开（`@electerm/rdpjs` + Canvas），使用已保存密码自动登录。  
连接时按主区域尺寸协商分辨率；画面铺满显示区域。

| 前端方法 | IPC Channel | 说明 |
|----------|-------------|------|
| `openRdpSession({ config })` | `rdp:open` | 内嵌 RDP；`config` 可带 `width`/`height` |
| `closeRdpSession(sessionId)` | `rdp:close` | 关闭会话 |
| `getRdpMonitor(sessionId)` | `rdp:monitor` | 会话信息（非 SSH 系统指标） |
| `rdpPointer` / `rdpWheel` / `rdpKey` | `rdp:pointer` 等 | 键鼠输入（同步 send） |
| `openRdpExternal(config)` | `rdp:openExternal` | 备选：生成临时 `.rdp` 并调用系统客户端 |

**主进程 → 渲染进程事件：**

| 事件 | 说明 |
|------|------|
| `rdp:ready` | 会话就绪（含 screen） |
| `rdp:bitmaps` | 位图块（可 Transferable） |
| `rdp:error` / `rdp:closed` | 错误 / 关闭 |

`openRdpExternal` 平台行为（备选路径）：

| 平台 | 行为 |
|------|------|
| macOS | 优先 Microsoft Remote Desktop，否则系统打开 `.rdp` |
| Windows | `mstsc.exe` |
| Linux | 尝试 `xfreerdp`，否则打开 `.rdp` |

### 3.8 设置与其它

| 前端方法 | IPC Channel | 说明 |
|----------|-------------|------|
| `getSettings()` | `settings:get` | `{ useSystemProxy, detectedProxy }` |
| `setSettings(partial)` | `settings:set` | 更新设置 |
| `writeClipboard(text)` | `clipboard:write` | 写系统剪贴板 |
| `pickDirectory(title?)` | `dialog:pickDirectory` | 选本地目录 |
| `getPathForFile(file)` | —（preload 本地） | 从 File 对象取路径 |

---

## 4. 安全说明（给集成方）

1. **无网络开放端口**：不能通过局域网 HTTP 直接调用上述接口。  
2. **本地库**：敏感字段经 Electron `safeStorage`（系统钥匙串/DPAPI）封装后写入磁盘。  
3. **导入导出**：密码字段使用 CryptoJS AES 加密写入 JSON；口令材料在源码中异或混淆，不以明文常量出现。  
4. **信任边界**：能执行渲染进程 JS（例如被篡改的前端包）即可调用 `window.easyshell`；请勿加载不可信远程页面。  
5. **安装包**：不再打包示例 `SSH/` 配置目录；应用图标来自 `build/icon.*`。  

> 桌面应用无法做到“绝对无法逆向”。当前方案目标是：抬高静态破解成本、避免磁盘明文密码、缩小误分发配置的风险。

---

## 5. 常见错误

| 场景 | 典型 message |
|------|----------------|
| 网络不通 / 未走代理 | 包含「无法到达主机」或「网络不通」 |
| 认证失败 | `认证失败：用户名/密码或私钥不正确` |
| 导出目录无配置 | `未找到连接配置（*_connect_config.json）` |
| RDP 会话不存在 | `RDP 会话不存在` |
| RDP 外开客户端缺失 | `打开远程桌面失败` + 系统错误信息 |
| 解密失败 | `密码解密失败` / `不是 EasyShell 备份文件` |

---

## 6. 版本

文档随仓库维护。接口变更时请同步更新本文件与 `src/vite-env.d.ts`。
