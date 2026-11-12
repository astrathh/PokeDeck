interface Props {
  values: number[]
  max?: number
  height?: number
  color?: string
}

/** Gráfico de linha mínimo, sem dependência. */
export function Sparkline({ values, max, height = 44, color = 'var(--accent)' }: Props) {
  const W = 300
  if (values.length < 2) return <div className="sparkline-empty" style={{ height }} />
  const top = Math.max(max ?? 0, ...values, 1)
  const step = W / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / top) * (height - 2) - 1).toFixed(1)}`)
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }}>
      <polygon points={`0,${height} ${pts.join(' ')} ${W},${height}`} fill={color} opacity={0.15} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
