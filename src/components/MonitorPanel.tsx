import { useEffect, useMemo, useState } from 'react'
import type { MonitorData, RdpMonitorData } from '../vite-env'
import { formatBytes, formatRate, pct } from '../utils/format'

interface Props {
  /** SSH 会话 id；与 rdpSessionId 互斥 */
  sessionId: string | null
  /** RDP 会话 id */
  rdpSessionId?: string | null
  /** 无可用会话时的说明 */
  unavailableReason?: string | null
}

type ProcSortKey = 'rss' | 'cpu'
type ProcSortDir = 'desc' | 'asc'

function Meter({
  label,
  value,
  text,
  tone = 'green',
}: {
  label: string
  value: number
  text: string
  tone?: 'green' | 'orange' | 'blue'
}) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span>{text}</span>
      </div>
      <div className="meter-track">
        <div
          className={`meter-fill tone-${tone}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  )
}

function NetChart({ history }: { history: MonitorData['netHistory'] }) {
  const w = 220
  const h = 56
  const max = Math.max(1, ...history.map((p) => Math.max(p.rxRate, p.txRate)))
  const toPoints = (key: 'rxRate' | 'txRate') =>
    history
      .map((p, i) => {
        const x = history.length <= 1 ? 0 : (i / (history.length - 1)) * (w - 2)
        const y = h - 2 - (p[key] / max) * (h - 6)
        return `${x},${y}`
      })
      .join(' ')

  return (
    <svg className="net-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline fill="none" stroke="#22a06b" strokeWidth="1.6" points={toPoints('rxRate')} />
      <polyline fill="none" stroke="#e24c4c" strokeWidth="1.6" points={toPoints('txRate')} />
    </svg>
  )
}

function sortMark(active: boolean, dir: ProcSortDir) {
  if (!active) return ''
  return dir === 'desc' ? ' ↓' : ' ↑'
}

function formatDuration(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}时${m}分${s}秒`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

function statusLabel(status: RdpMonitorData['status']) {
  if (status === 'connected') return '已连接'
  if (status === 'connecting') return '连接中'
  return '已断开'
}

function RdpMonitorView({ data }: { data: RdpMonitorData }) {
  return (
    <div className="monitor">
      <section className="monitor-block">
        <h4>会话信息</h4>
        <div className="info-line">状态：{statusLabel(data.status)}</div>
        <div className="info-line">
          主机：{data.host}:{data.port}
        </div>
        <div className="info-line">用户：{data.username || '-'}</div>
        <div className="info-line">
          分辨率：{data.screen.width} × {data.screen.height}
        </div>
        <div className="info-line">已连接：{formatDuration(data.connectedMs)}</div>
      </section>

      <section className="monitor-block">
        <h4>画面传输</h4>
        <div className="info-line">刷新约：{data.fps.toFixed(1)} FPS</div>
        <div className="info-line">帧批次：{data.frameCount}</div>
        <div className="info-line">图块数：{data.tileCount}</div>
        <div className="info-line">已接收：{formatBytes(data.bytesIn)}</div>
      </section>
    </div>
  )
}

export default function MonitorPanel({
  sessionId,
  rdpSessionId = null,
  unavailableReason,
}: Props) {
  const [data, setData] = useState<MonitorData | null>(null)
  const [rdpData, setRdpData] = useState<RdpMonitorData | null>(null)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<ProcSortKey>('cpu')
  const [sortDir, setSortDir] = useState<ProcSortDir>('desc')

  useEffect(() => {
    if (!rdpSessionId) {
      setRdpData(null)
      return
    }
    let alive = true
    const tick = async () => {
      try {
        const next = await window.easyshell.getRdpMonitor(rdpSessionId)
        if (alive) {
          setRdpData(next)
          setError('')
        }
      } catch (err) {
        if (alive) {
          setRdpData(null)
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 1500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [rdpSessionId])

  useEffect(() => {
    if (!sessionId) {
      setData(null)
      if (!rdpSessionId) setError('')
      return
    }
    let alive = true
    const tick = async () => {
      try {
        const next = await window.easyshell.getMonitor(sessionId)
        if (alive) {
          setData(next)
          setError('')
        }
      } catch (err) {
        if (alive) {
          setData(null)
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [sessionId, rdpSessionId])

  const processes = useMemo(() => {
    if (!data) return []
    const list = [...data.processes]
    const factor = sortDir === 'desc' ? -1 : 1
    list.sort((a, b) => {
      const av = sortKey === 'rss' ? a.rss : a.cpu
      const bv = sortKey === 'rss' ? b.rss : b.cpu
      if (av === bv) return Number(b.pid) - Number(a.pid)
      return (av - bv) * factor
    })
    return list.slice(0, 12)
  }, [data, sortKey, sortDir])

  function toggleSort(key: ProcSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
      return
    }
    setSortKey(key)
    setSortDir('desc')
  }

  if (rdpSessionId) {
    if (!rdpData) {
      return (
        <div className="monitor-empty">
          <p>{error || '正在采集远程桌面会话信息…'}</p>
        </div>
      )
    }
    return <RdpMonitorView data={rdpData} />
  }

  if (!sessionId) {
    return (
      <div className="monitor-empty">
        <p>{unavailableReason || '连接 SSH 主机后显示系统监控'}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="monitor-empty">
        <p>{error || '正在采集监控数据…'}</p>
      </div>
    )
  }

  const memPct = pct(data.memUsed, data.memTotal)
  const swapPct = pct(data.swapUsed, data.swapTotal)

  return (
    <div className="monitor">
      <section className="monitor-block">
        <h4>系统信息</h4>
        <div className="info-line">运行时间：{data.uptimeText || '-'}</div>
        <div className="info-line">
          系统负载：{data.load.map((n) => n.toFixed(2)).join(' / ')}
        </div>
        <Meter
          label="CPU"
          tone="green"
          value={data.cpuPercent}
          text={`${data.cpuPercent.toFixed(0)}%`}
        />
        <Meter
          label="内存"
          tone="orange"
          value={memPct}
          text={`${memPct.toFixed(0)}%  ${formatBytes(data.memUsed)} / ${formatBytes(data.memTotal)}`}
        />
        <Meter
          label="交换"
          tone="blue"
          value={swapPct}
          text={`${swapPct.toFixed(0)}%  ${formatBytes(data.swapUsed)} / ${formatBytes(data.swapTotal)}`}
        />
      </section>

      <section className="monitor-block">
        <h4>进程</h4>
        <div className="proc-table">
          <div className="proc-head">
            <span>PID</span>
            <button
              type="button"
              className={`proc-sort ${sortKey === 'rss' ? 'active' : ''}`}
              onClick={() => toggleSort('rss')}
              title="按内存排序"
            >
              内存{sortMark(sortKey === 'rss', sortDir)}
            </button>
            <button
              type="button"
              className={`proc-sort ${sortKey === 'cpu' ? 'active' : ''}`}
              onClick={() => toggleSort('cpu')}
              title="按 CPU 排序"
            >
              CPU{sortMark(sortKey === 'cpu', sortDir)}
            </button>
            <span>命令</span>
          </div>
          {processes.map((p) => (
            <div className="proc-row" key={`${p.pid}-${p.command}`}>
              <span title={`PID ${p.pid}`}>{p.pid}</span>
              <span>{formatBytes(p.rss * 1024)}</span>
              <span>{p.cpu.toFixed(1)}%</span>
              <span title={p.command}>{p.command}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="monitor-block">
        <h4>网络</h4>
        <div className="net-meta">
          <span>↓ {formatRate(data.rxRate)}</span>
          <span>↑ {formatRate(data.txRate)}</span>
        </div>
        <NetChart history={data.netHistory} />
      </section>

      <section className="monitor-block">
        <h4>磁盘</h4>
        <div className="disk-table">
          <div className="disk-head">
            <span>路径</span>
            <span>可用/大小</span>
          </div>
          {data.disks.slice(0, 12).map((d) => {
            const usedPct = d.size > 0 ? Math.min(100, (d.used / d.size) * 100) : 0
            const tone = usedPct >= 90 ? 'danger' : usedPct >= 75 ? 'warn' : 'ok'
            return (
              <div className="disk-row" key={`${d.mount}-${d.filesystem}`}>
                <span title={d.mount}>{d.mount}</span>
                <span
                  className={`disk-usage tone-${tone}`}
                  title={`已用 ${formatBytes(d.used)} · ${usedPct.toFixed(0)}%`}
                >
                  <i className="disk-usage-bar" style={{ width: `${usedPct}%` }} />
                  <em>
                    {formatBytes(d.avail)}/{formatBytes(d.size)}
                  </em>
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
