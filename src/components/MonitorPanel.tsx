import { useEffect, useMemo, useState } from 'react'
import type { MonitorData } from '../vite-env'
import { formatBytes, formatRate, pct } from '../utils/format'

interface Props {
  sessionId: string | null
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

export default function MonitorPanel({ sessionId }: Props) {
  const [data, setData] = useState<MonitorData | null>(null)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<ProcSortKey>('cpu')
  const [sortDir, setSortDir] = useState<ProcSortDir>('desc')

  useEffect(() => {
    if (!sessionId) {
      setData(null)
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
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [sessionId])

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

  if (!sessionId) {
    return (
      <div className="monitor-empty">
        <p>连接主机后显示系统监控</p>
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
