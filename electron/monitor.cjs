function modeToString(mode) {
  if (!mode && mode !== 0) return ''
  const isDir = (mode & 0o40000) === 0o40000
  const isLnk = (mode & 0o120000) === 0o120000
  const type = isLnk ? 'l' : isDir ? 'd' : '-'
  const perms = [
    (mode & 0o400 ? 'r' : '-') + (mode & 0o200 ? 'w' : '-') + (mode & 0o100 ? 'x' : '-'),
    (mode & 0o040 ? 'r' : '-') + (mode & 0o020 ? 'w' : '-') + (mode & 0o010 ? 'x' : '-'),
    (mode & 0o004 ? 'r' : '-') + (mode & 0o002 ? 'w' : '-') + (mode & 0o001 ? 'x' : '-'),
  ].join('')
  return type + perms
}

function fileTypeLabel(mode, isDir) {
  if ((mode & 0o120000) === 0o120000) return '链接'
  if (isDir) return '文件夹'
  return '文件'
}

function parseCpuLine(line) {
  const parts = line.trim().split(/\s+/)
  if (parts[0] !== 'cpu') return null
  const nums = parts.slice(1).map(Number)
  const idle = nums[3] || 0
  const total = nums.reduce((a, b) => a + b, 0)
  return { idle, total }
}

/**
 * 瞬时进程 CPU%（与 top/FinalShell 同类）：
 * 100 * Δ(utime+stime) / (HZ * Δt)
 * 多核可超过 100。
 */
function parseMonitor(raw, prev) {
  const sections = {}
  let current = ''
  for (const line of String(raw).split('\n')) {
    const m = line.match(/^===([A-Z]+)===/)
    if (m) {
      current = m[1]
      sections[current] = []
      continue
    }
    if (current) sections[current].push(line)
  }

  const uptimeLine = (sections.UPTIME || []).join(' ').trim()
  let uptimeText = uptimeLine
  let load = [0, 0, 0]
  const loadMatch = uptimeLine.match(/load average[s]?: ([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)/i)
  if (loadMatch) load = [Number(loadMatch[1]), Number(loadMatch[2]), Number(loadMatch[3])]
  const upMatch = uptimeLine.match(/up\s+(.+?),\s+\d+\s+user/i)
  if (upMatch) uptimeText = upMatch[1]

  let memTotal = 0
  let memUsed = 0
  let swapTotal = 0
  let swapUsed = 0
  for (const line of sections.MEM || []) {
    if (line.startsWith('Mem:')) {
      const p = line.trim().split(/\s+/).map(Number)
      memTotal = p[1] || 0
      memUsed = p[2] || 0
    }
    if (line.startsWith('Swap:')) {
      const p = line.trim().split(/\s+/).map(Number)
      swapTotal = p[1] || 0
      swapUsed = p[2] || 0
    }
  }

  let cpuPercent = 0
  const cpuLine = (sections.CPU || []).find((l) => l.startsWith('cpu '))
  const cpuNow = cpuLine ? parseCpuLine(cpuLine) : null
  if (cpuNow && prev?.cpu) {
    const idleDiff = cpuNow.idle - prev.cpu.idle
    const totalDiff = cpuNow.total - prev.cpu.total
    if (totalDiff > 0) cpuPercent = Math.max(0, Math.min(100, (1 - idleDiff / totalDiff) * 100))
  }

  const hz = Math.max(1, Number((sections.HZ || [])[0]) || prev?.hz || 100)
  const now = Date.now()
  const dtSec =
    prev?.at && now > prev.at ? Math.max(0.05, (now - prev.at) / 1000) : 0
  const prevTicks = prev?.procTicks || {}

  const procTicks = {}
  const processesRaw = []
  for (const line of sections.PS || []) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 4) continue
    const pid = parts[0]
    const ticks = Number(parts[1]) || 0
    const rssKb = Number(parts[2]) || 0
    const command = parts.slice(3).join(' ') || pid
    if (!/^\d+$/.test(pid)) continue
    procTicks[pid] = ticks

    let cpu = 0
    if (dtSec > 0 && prevTicks[pid] != null) {
      const dTicks = Math.max(0, ticks - prevTicks[pid])
      cpu = (dTicks / (hz * dtSec)) * 100
    }
    const rss = rssKb // KB，与原先 ps rss 字段一致
    const mem = memTotal > 0 ? ((rss * 1024) / memTotal) * 100 : 0
    processesRaw.push({ pid, cpu, mem, rss, command })
  }

  // 按瞬时 CPU 降序，取前 20；若尚无差值则按内存
  processesRaw.sort((a, b) => {
    if (dtSec > 0) return b.cpu - a.cpu || b.rss - a.rss
    return b.rss - a.rss
  })
  const processes = processesRaw.slice(0, 20).map((p) => ({
    ...p,
    cpu: Math.round(p.cpu * 10) / 10,
    mem: Math.round(p.mem * 10) / 10,
  }))

  const disks = []
  for (const line of (sections.DF || []).slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6) continue
    const [filesystem, size, used, avail, usePct, mount] = parts
    if (!mount || mount.startsWith('/snap') || filesystem.startsWith('tmpfs')) continue
    disks.push({
      filesystem,
      size: Number(size) || 0,
      used: Number(used) || 0,
      avail: Number(avail) || 0,
      usePct: String(usePct || '').replace('%', ''),
      mount,
    })
  }

  let rx = 0
  let tx = 0
  for (const line of sections.NET || []) {
    if (!line.includes(':')) continue
    const [iface, rest] = line.split(':')
    const name = iface.trim()
    if (!name || name === 'lo') continue
    const nums = rest.trim().split(/\s+/).map(Number)
    rx += nums[0] || 0
    tx += nums[8] || 0
  }

  let rxRate = 0
  let txRate = 0
  if (prev?.net && prev.net.at) {
    const dt = Math.max(0.001, (now - prev.net.at) / 1000)
    rxRate = Math.max(0, (rx - prev.net.rx) / dt)
    txRate = Math.max(0, (tx - prev.net.tx) / dt)
  }

  const netHistory = [...(prev?.netHistory || [])]
  netHistory.push({ t: now, rxRate, txRate })
  while (netHistory.length > 60) netHistory.shift()

  return {
    uptimeText,
    load,
    cpuPercent,
    memTotal,
    memUsed,
    swapTotal,
    swapUsed,
    processes,
    disks,
    rxRate,
    txRate,
    netHistory,
    _prev: {
      at: now,
      hz,
      cpu: cpuNow,
      procTicks,
      net: { rx, tx, at: now },
      netHistory,
    },
  }
}

// PS 行格式：pid ticks rss_kb comm
// ticks = utime+stime，两次采样算瞬时 CPU%（可 >100，与 top/FinalShell 一致）
// 整段用分号连接成一行，适配 ssh exec / bash -c
const PS_COLLECT =
  'for f in /proc/[0-9]*/stat; do ' +
  '[ -r "$f" ] || continue; ' +
  'line=$(cat "$f" 2>/dev/null) || continue; ' +
  'pid=${line%% *}; ' +
  'rest=${line#* (}; ' +
  'comm=${rest%%) *}; ' +
  'fields=${rest#*) }; ' +
  'set -- $fields; ' +
  'ticks=$(( ${12:-0} + ${13:-0} )); ' +
  'rss=0; ' +
  'if [ -r "/proc/$pid/status" ]; then ' +
  'while read -r key val _; do ' +
  '[ "$key" = "VmRSS:" ] && { rss=$val; break; }; ' +
  'done < "/proc/$pid/status"; ' +
  'fi; ' +
  'echo "$pid $ticks $rss $comm"; ' +
  'done'

const MONITOR_SCRIPT = [
  "echo '===UPTIME==='",
  'uptime',
  "echo '===MEM==='",
  'free -b',
  "echo '===CPU==='",
  "grep '^cpu ' /proc/stat",
  "echo '===HZ==='",
  'getconf CLK_TCK 2>/dev/null || echo 100',
  "echo '===PS==='",
  PS_COLLECT,
  "echo '===DF==='",
  'df -B1 -P 2>/dev/null',
  "echo '===NET==='",
  'cat /proc/net/dev',
].join('; ')

module.exports = { modeToString, fileTypeLabel, parseMonitor, MONITOR_SCRIPT }
