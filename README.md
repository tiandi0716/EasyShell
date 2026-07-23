# EasyShell

轻量 SSH / SFTP 远程管理工具，类似 FinalShell 的核心能力：

- 主机连接管理（密码 / 私钥）
- 多标签 SSH 终端（xterm.js）
- SFTP 文件浏览、上传、下载、新建目录、删除
- 本地保存连接配置，无激活、无账号绑定

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

1. 左侧「新建连接」，填写主机、端口、用户名和认证信息
2. 点击「连接」打开终端标签
3. 右侧文件面板可浏览远程目录，支持上传/下载

连接配置位置：

- macOS：`~/Library/Application Support/easyshell/connections.json`
- Windows：`%APPDATA%/easyshell/connections.json`

## 技术栈

- Electron
- React + TypeScript + Vite
- ssh2
- xterm.js
- electron-builder（安装包）
