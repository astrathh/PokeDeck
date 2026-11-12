import { app } from 'electron'
import type { MetricsSample } from '../shared/types'
import type { AccountManager } from './accounts'

/** Coleta RAM/CPU por conta (pelo PID do processo de cada página) a cada `intervalMs`. */
export function startMetrics(
  manager: AccountManager,
  onSample: (s: MetricsSample) => void,
  intervalMs = 2000
): () => void {
  const tick = (): void => {
    const metrics = app.getAppMetrics()
    const byPid = new Map(metrics.map((m) => [m.pid, m]))

    const accounts: MetricsSample['accounts'] = {}
    for (const { id, pid } of manager.pids()) {
      const m = pid ? byPid.get(pid) : undefined
      accounts[id] = {
        // workingSetSize vem em KB
        memoryMb: m ? m.memory.workingSetSize / 1024 : 0,
        cpu: m ? m.cpu.percentCPUUsage : 0
      }
    }
    manager.applyMetrics(accounts)

    onSample({
      ts: Date.now(),
      accounts,
      totalMemoryMb: metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024,
      totalCpu: metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0)
    })
  }

  const timer = setInterval(tick, intervalMs)
  tick()
  return () => clearInterval(timer)
}
