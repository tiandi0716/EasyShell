#!/usr/bin/env node
/**
 * 使用国内镜像运行 electron-builder，避免 GitHub 下载过慢。
 * 用法：node scripts/run-builder.cjs --win
 *       node scripts/run-builder.cjs --mac --arm64
 */
const { spawnSync } = require('child_process')
const path = require('path')

const env = {
  ...process.env,
  ELECTRON_MIRROR:
    process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_CUSTOM_DIR: process.env.ELECTRON_CUSTOM_DIR || '{{ version }}',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
    'https://npmmirror.com/mirrors/electron-builder-binaries/',
  // 未配置签名证书时跳过自动探测，减少无意义等待
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false',
}

const args = process.argv.slice(2)
if (!args.length) {
  console.error('用法: node scripts/run-builder.cjs --win|--mac|--linux ...')
  process.exit(1)
}

console.log('[easyshell] ELECTRON_MIRROR =', env.ELECTRON_MIRROR)
console.log(
  '[easyshell] ELECTRON_BUILDER_BINARIES_MIRROR =',
  env.ELECTRON_BUILDER_BINARIES_MIRROR,
)

const electronBuilder = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  'electron-builder',
)

const result = spawnSync(
  electronBuilder,
  [...args, '--publish', 'never'],
  { stdio: 'inherit', env, shell: process.platform === 'win32' },
)

process.exit(result.status == null ? 1 : result.status)
