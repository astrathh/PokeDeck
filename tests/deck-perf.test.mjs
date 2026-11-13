// Testes do limitador de FPS (resources/deck-auto/perf.js), com relógio e vsync falsos (60 Hz).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const codigo = readFileSync(new URL('../resources/deck-auto/perf.js', import.meta.url), 'utf8')

function pagina() {
  let t = 0
  let seq = 0
  const rafs = new Map() // id → cb (dispara no próximo vsync)
  const timers = new Map() // id → { quando, fn }
  const win = {
    requestAnimationFrame: (cb) => { const id = ++seq; rafs.set(id, cb); return id },
    cancelAnimationFrame: (id) => rafs.delete(id),
  }
  const ctx = vm.createContext({
    window: win,
    performance: { now: () => t },
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { quando: t + ms, fn }); return id },
    clearTimeout: (id) => timers.delete(id),
    Math, Number, Map, Infinity,
  })
  vm.runInContext(codigo, ctx)
  /** Anda `ms` em passos de 1 ms; a cada 16,67 ms é um vsync. Conta quantas vezes o rAF nativo foi pedido. */
  let pedidosNativos = 0
  const avancar = (ms) => {
    const fim = t + ms
    let proximoVsync = Math.ceil((t + 0.001) / (1000 / 60)) * (1000 / 60)
    while (t < fim) {
      t = Math.min(fim, t + 1)
      for (const [id, x] of [...timers]) if (x.quando <= t) { timers.delete(id); x.fn() }
      if (t >= proximoVsync) {
        proximoVsync += 1000 / 60
        const lote = [...rafs]
        rafs.clear()
        pedidosNativos += lote.length
        for (const [, cb] of lote) cb(t)
      }
    }
  }
  return { win, avancar, pedidos: () => pedidosNativos }
}

/** Loop de animação como o do jogo: cada quadro pede o próximo. */
function loop(win) {
  const s = { quadros: 0, id: 0 }
  const passo = () => { s.quadros++; s.id = win.requestAnimationFrame(passo) }
  s.id = win.requestAnimationFrame(passo)
  return s
}

let ok = 0
const caso = (nome, fn) => { fn(); ok++; console.log('ok -', nome) }

caso('sem limite: ~60 quadros por segundo', () => {
  const p = pagina()
  const l = loop(p.win)
  p.avancar(1000)
  assert.ok(l.quadros >= 58 && l.quadros <= 61, String(l.quadros))
})

caso('limite de 10 FPS: ~10 quadros por segundo e sem acordar a cada vsync', () => {
  const p = pagina()
  p.win.__deckPerf.setFps(10)
  const l = loop(p.win)
  p.avancar(1000)
  assert.ok(l.quadros >= 9 && l.quadros <= 11, String(l.quadros))
  assert.ok(p.pedidos() <= 12, `rAF nativo pedido ${p.pedidos()} vezes`)
})

caso('vários loops no mesmo quadro andam juntos (não dividem o limite entre si)', () => {
  const p = pagina()
  p.win.__deckPerf.setFps(10)
  const a = loop(p.win)
  const b = loop(p.win)
  p.avancar(1000)
  assert.ok(a.quadros >= 9 && a.quadros <= 11, String(a.quadros))
  assert.ok(b.quadros >= 9 && b.quadros <= 11, String(b.quadros))
})

caso('cancelAnimationFrame cancela, esperando o timer ou já no rAF nativo', () => {
  const p = pagina()
  p.win.__deckPerf.setFps(10)
  const l = loop(p.win)
  p.avancar(150)
  const antes = l.quadros
  p.win.cancelAnimationFrame(l.id)
  p.avancar(1000)
  assert.equal(l.quadros, antes)
})

caso('tirar o limite volta a 60 FPS', () => {
  const p = pagina()
  p.win.__deckPerf.setFps(10)
  const l = loop(p.win)
  p.avancar(1000)
  p.win.__deckPerf.setFps(0)
  const antes = l.quadros
  p.avancar(1000)
  assert.ok(l.quadros - antes >= 55, String(l.quadros - antes))
  assert.equal(p.win.__deckPerf.getFps(), 0)
})

console.log(`\n${ok} casos passaram`)
