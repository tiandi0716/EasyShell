# EasyShell

轻量 SSH / SFTP / Windows 远程桌面客户端（界面风格接近 FinalShell）：

- 主机连接管理（SSH 密码/私钥库、Windows RDP）
- 多标签 SSH 终端（xterm.js）与内嵌 Windows 远程桌面
- SFTP 文件浏览、上传、下载、拖拽（SSH）
- 系统监控：SSH 采集 CPU/内存/进程等；RDP 展示会话与画面传输状态
- 系统代理自动识别（Clash 等），方便访问内网
- 连接导入导出（可按目录导出）、FinalShell 配置转换
- 本地加密保存连接配置（无激活、无账号绑定）

## 接口文档

渲染进程 API、IPC 对照、数据模型与安全说明见：

**[docs/API.md](./docs/API.md)**

TypeScript 类型定义：`src/vite-env.d.ts`

## 开发启动

```bash
cd easyshell
npm install
npm run dev
```

开发模式数据目录为 `easyshell-dev`，与正式安装包的 `easyshell` 隔离。  
开发态 Dock 可能仍显示 Electron 默认图标/名称，属正常现象；正式包使用 `build/icon.*`。

## 安装包（给别人用）

先打包，产物在 `release/` 目录：

```bash
npm install

# 只打 macOS（当前这台 Mac 上推荐）
npm run dist:mac

# 只打 Windows（可在 Mac 上交叉打包）
npm run dist:win

# mac + win 一起打
npm run dist:all
```

应用图标资源：

| 文件 | 用途 |
|------|------|
| `build/icon.png` | 通用 / Windows |
| `build/icon.icns` | macOS |
| `public/icon.png` | 页面 favicon |

### macOS 安装

1. 打开 `release/` 里的 `EasyShell-1.0.0-arm64.dmg`（Apple Silicon）或 `EasyShell-1.0.0.dmg`（Intel）
2. 把 **EasyShell** 拖到 **应用程序**
3. 首次打开若提示「无法验证开发者」：
   - 系统设置 → 隐私与安全性 → 仍要打开  
   - 或终端执行：`xattr -cr /Applications/EasyShell.app`

### Windows 安装

1. 使用 `release/EasyShell Setup 1.0.0.exe`（NSIS 安装包）
2. 按向导安装，可生成桌面快捷方式
3. 若只要绿色版，用 `EasyShell 1.0.0.exe`（portable，免安装）

> 说明：在 macOS 上可以打 Windows 包；在 Windows 上一般打不了 macOS 包。正式发版建议分别在对应系统上打包更稳妥。

## 本地不打包直接跑

```bash
npm run build
npm start
```

## 使用说明

1. 左侧「新建目录 / 新建连接」管理主机；辅助功能可管理私钥
2. 双击连接：
   - **SSH**：打开终端标签 + 右侧文件管理 + 系统监控
   - **Windows**：应用内嵌远程桌面标签（自动填入已保存密码），左侧显示 RDP 会话信息
3. SSH 连接后可在文件面板浏览/上传/下载

连接配置位置：

| 环境 | macOS | Windows |
|------|-------|---------|
| 正式包 | `~/Library/Application Support/easyshell/` | `%APPDATA%/easyshell/` |
| 开发 | `~/Library/Application Support/easyshell-dev/` | `%APPDATA%/easyshell-dev/` |

主要文件：`connections.json`、`folders.json`、`private-keys.json`、`settings.json`

## 安全说明（摘要）

| 项 | 做法 |
|----|------|
| 本地密码 / 私钥 | 使用系统 `safeStorage` 封装后写入磁盘，避免明文 |
| 导入导出 | 密码字段仍用 CryptoJS AES（与之前相同） |
| 密钥材料 | 源码中异或混淆存放，避免明文常量 |
| 安装包 | 不打包示例主机配置目录 |
| 页面 | 禁止任意外链导航 / 弹窗 |

更完整的接口与安全边界见 [docs/API.md](./docs/API.md)。

> 桌面软件无法做到“绝对防逆向”。本项目重点是：**磁盘不明文、导出难直接肉眼破解、减小误分发风险**。

## 技术栈

- Electron
- React + TypeScript + Vite
- ssh2 / socks / @electerm/rdpjs
- xterm.js
- electron-builder（安装包）
