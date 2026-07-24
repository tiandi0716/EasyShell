# EasyShell

轻量 SSH / SFTP / Windows 远程桌面管理工具，类似 FinalShell 的核心能力：

- 主机连接管理（SSH 密码/私钥、Windows RDP）
- 多标签 SSH 终端（xterm.js）
- SFTP 文件浏览、上传、下载、拖拽
- 系统代理自动识别（Clash 等），方便访问内网
- 连接导入导出、FinalShell 配置转换
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

### macOS 安装

1. 打开 `release/` 里的 `EasyShell-1.0.0-arm64.dmg`（Apple Silicon）或 `EasyShell-1.0.0.dmg`（Intel）
2. 把 **EasyShell** 拖到 **应用程序**
3. 首次打开若提示「无法验证开发者」：
   - 系统设置 → 隐私与安全性 → 仍要打开  
   - 或终端执行：`xattr -cr /Applications/EasyShell.app`
4. Windows 远程桌面请安装 [Microsoft Remote Desktop](https://apps.apple.com/app/microsoft-remote-desktop/id1295203466)

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

1. 左侧「+SSH」或「+Win」新建连接
2. 双击连接：SSH 打开终端标签；Windows 调用系统远程桌面
3. SSH 连接后可在文件面板浏览/上传/下载

连接配置位置：

- macOS：`~/Library/Application Support/easyshell/connections.json`
- Windows：`%APPDATA%/easyshell/connections.json`

## 安全说明（摘要）

| 项 | 做法 |
|----|------|
| 本地密码 | 使用系统 `safeStorage` 封装后写入磁盘，避免明文 |
| 导入导出 | 密码字段仍用 CryptoJS AES（与之前相同） |
| 密钥材料 | 源码中异或混淆存放，避免明文常量 |
| 安装包 | 不打包示例主机配置目录 |
| 页面 | 禁止任意外链导航 / 弹窗 |

更完整的接口与安全边界见 [docs/API.md](./docs/API.md)。

> 桌面软件无法做到“绝对防逆向”。本项目重点是：**磁盘不明文、导出难直接肉眼破解、减小误分发风险**。

## 技术栈

- Electron
- React + TypeScript + Vite
- ssh2 / socks
- xterm.js
- electron-builder（安装包）
