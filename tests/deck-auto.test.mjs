// Testa a lógica de decisão de resources/deck-auto/auto.js com um jogo falso. Rode: npm run test:auto
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const SRC = readFileSync(process.argv[2] ?? new URL("../resources/deck-auto/auto.js", import.meta.url), "utf8")

const ITEMS = [
  { id: 200, name: 'Small Potion', category: 'heal', healAmount: 60, npcPrice: 50 },
  { id: 201, name: 'Great Potion', category: 'heal', healAmount: 150, npcPrice: 150 },
  { id: 202, name: 'Ultra Potion', category: 'heal', healAmount: 400, npcPrice: 400 },
  { id: 203, name: 'Hyper Potion', category: 'heal', healAmount: 1000, npcPrice: 800 },
  { id: 204, name: 'Ultimate Potion', category: 'heal', healAmount: 3000, npcPrice: 1500 },
  { id: 207, name: 'Medicine', category: 'heal', healAmount: 20, npcPrice: 0 },
  { id: 9, name: 'Poke Ball', category: 'ball', npcPrice: 10 },
]
const PCT50 = { id: 999, name: 'Max Elixir 50%', category: 'heal', healPct: 0.5, npcPrice: 2500 }

/**
 * Monta uma página falsa com o auto.js carregado. O "servidor" falso aplica as regras do jogo:
 * sem a trava de combate (3 s sem golpe) ou no Centro, 'hunt.select' troca direto; 'centro.ir' só sem a trava.
 * Relógio falso: `avancar(ms)` anda o tempo e roda os timers (fila de ações e missão de 1 s).
 */
function pagina({ hp, limiar = 30, nivel = 150, huntSlug = 'a', linhas, items = {}, gold = 1e7, potionIds = [200, 203, 204], recusar = [], storage = null, inicio = 1_000_000 }) {
  const enviados = []
  const tempos = [] // quando cada mensagem saiu
  const relogio = { t: inicio }
  const ouvintes = {}
  let timers = []
  let ultimoGolpe = -Infinity
  let soDoCentro = false // servidor que só aceita trocar de hunt a partir do Centro
  let eu = null
  let ouvinteSocket = null
  class FakeWS {
    static OPEN = 1
    constructor(url) { this.url = url; this.readyState = 1 }
    addEventListener(tipo, fn) { if (tipo === 'message') ouvinteSocket = fn }
    send(s) {
      const m = JSON.parse(s)
      enviados.push(m)
      tempos.push(relogio.t)
      if (m.t === 'centro.ir' && relogio.t - ultimoGolpe >= 3000) eu.noCentro = true
      const livre = relogio.t - ultimoGolpe >= 3000
      if (m.t === 'hunt.select' && (eu.noCentro || (livre && !soDoCentro)) && !recusar.includes(m.slug)) { eu.huntSlug = m.slug; eu.noCentro = false }
    }
  }
  const win = {
    WebSocket: FakeWS,
    localStorage: storage,
    location: { href: 'https://pokeidle.io/app', host: 'pokeidle.io' },
    __pokeidleHunt: {
      on: (t, fn) => { ouvintes[t] = fn },
      carregarJogo: async () => ({ mod: {}, especies: new Map() }),
      engine: { REGRAS: { hpCombateMin: 1, hpCombateMult: 1 }, analisar: () => ({ linhas }) },
    },
  }
  const novoTimer = (fn, ms, repete) => { const id = Symbol(); timers.push({ id, fn, quando: relogio.t + (ms ?? 0), ms, repete }); return id }
  const ctx = vm.createContext({
    window: win, location: win.location, URL, Intl, Math, Number, JSON, Date: { now: () => relogio.t }, Promise, String, Map, Infinity, console,
    setTimeout: (fn, ms) => novoTimer(fn, ms, false),
    setInterval: (fn, ms) => novoTimer(fn, ms, true),
    clearInterval: (id) => { timers = timers.filter((x) => x.id !== id) },
    clearTimeout: (id) => { timers = timers.filter((x) => x.id !== id) },
    fetch: async () => ({ json: async () => ({ items: ITEMS }) }),
  })
  vm.runInContext(SRC, ctx)
  new win.WebSocket('wss://pokeidle.io/ws') // o jogo abre o socket
  eu = {
    level: nivel, gold, huntSlug, activeId: 1, items,
    pokemons: [{ id: 1, nome: 'Teste', speciesId: 1, level: 100, maxHp: hp, stats: { hp } }],
    automation: { autoPotion: true, hpLimiar: limiar, potionIds },
  }
  // Formato real: itens do servidor em itensNossos; itensCompraveis = preços de ovos { itemId, preco }
  const avancar = (ms) => {
    const fimT = relogio.t + ms
    while (relogio.t < fimT) {
      relogio.t += 100
      for (const x of [...timers]) {
        if (!timers.includes(x) || x.quando > relogio.t) continue
        if (x.repete) x.quando = relogio.t + x.ms
        else timers = timers.filter((y) => y !== x)
        x.fn()
      }
    }
  }
  avancar(100) // o auto.js assina o /hunt
  ouvintes.welcome?.({ hunts: [], itensNossos: [PCT50], itensCompraveis: [{ itemId: 500, preco: 1e6 }] })
  ouvintes.estado?.(eu)
  /** Evento de batalha como o jogo manda no socket. */
  const batalha = (ev) => ouvinteSocket?.({ data: JSON.stringify({ t: 'batalha', ev: [ev] }) })
  /** Um golpe em combate (renova a trava de 3 s). */
  const golpe = () => { ultimoGolpe = relogio.t; batalha({ k: 'ataque', por: 'selvagem' }) }
  /** O servidor falso libera a saída quando a onda acaba. */
  const fimDaOnda = () => { ultimoGolpe = -Infinity; batalha({ k: 'morte', quem: 'selvagem' }) }
  // tick + 30 s de jogo depois (fila de ações e missão de troca andam)
  const tick = async (cfg) => { const r = await win.__deckAuto.tick(cfg); avancar(30_000); return r }
  return { tick, tickSo: (cfg) => win.__deckAuto.tick(cfg), avancar, golpe, fimDaOnda, soDoCentro: () => { soDoCentro = true }, enviados, tempos, eu, ouvintes, relogio, deck: win.__deckAuto }
}

const CFG = (o = {}) => ({
  dryRun: false, intervalMin: 5,
  potions: { enabled: true, manageList: true, refillBelowHours: 1, stockHours: 2, maxGoldPct: 20 },
  hunts: { enabled: true, minStayMin: 15, viaCenter: false, lowLevel: 200, levelOf: 'trainer', lowLevelMaxHitPct: 30, requirePositiveGold: false },
  ...o,
})
/** Config com "voltar ao Centro antes de trocar" ligado. */
const CFGc = (o = {}) => { const c = CFG(o); c.hunts = { ...c.hunts, viaCenter: true }; return c }
const linha = (slug, xp, hitPct, extra = {}) => ({
  slug, nome: slug.toUpperCase(), liberada: true, inviavel: false, umHit: false,
  hitPct, xpTreinadorH: xp, ouroH: 1e6, danoPorAbate: 100, kph: 600, ...extra,
})

let ok = 0
const caso = async (nome, fn) => { await fn(); ok++; console.log('ok -', nome) }

// ---- 1) escolha da poção pelo HP máximo, limiar 30% ----
for (const [hp, esperado] of [[1000, 'Small Potion'], [2000, 'Hyper Potion'], [5000, 'Ultimate Potion'], [15000, 'Max Elixir 50%']]) {
  await caso(`poção para HP ${hp} = ${esperado}`, async () => {
    const p = pagina({ hp, linhas: [linha('a', 1000, 0.1)], items: { 200: 1e6, 203: 1e6, 204: 1e6, 999: 1e6 } })
    const r = await p.tick(CFG())
    assert.equal(r.status.potion?.name, esperado, JSON.stringify(r))
  })
}

// ---- 2) troca de hunt ----
await caso('troca por rendimento (+20%) e marca só a poção escolhida', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 1200, 0.2)], items: { 204: 1e6 } })
  const r = await p.tick(CFG())
  assert.deepEqual(p.enviados.find((m) => m.t === 'hunt.select'), { t: 'hunt.select', slug: 'b' })
  assert.deepEqual(p.enviados.find((m) => m.t === 'auto.set').potionIds, [204])
  assert.equal(p.enviados.find((m) => m.t === 'auto.set').hpLimiar, 30, 'mantém o resto da automação do jogo')
  assert.ok(r.acoes.some((a) => a.msg.includes('trocar de A para B')))
})

await caso('troca por qualquer ganho de XP/h (+5%)', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 1050, 0.1)], items: { 204: 1e6 } })
  await p.tick(CFG())
  assert.equal(p.enviados.find((m) => m.t === 'hunt.select')?.slug, 'b')
})

await caso('não troca se a atual já é a de maior XP/h segura', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 1000, 0.1), linha('c', 3000, 0.9)], items: { 204: 1e6 } })
  await p.tick(CFG())
  assert.equal(p.enviados.filter((m) => m.t === 'hunt.select').length, 0)
})

await caso('respeita teto de 30% em nível ≤ 200 (pula hunt melhor com golpe de 35%)', async () => {
  const p = pagina({ hp: 5000, limiar: 50, nivel: 150, linhas: [linha('a', 1000, 0.1), linha('b', 5000, 0.35), linha('c', 1500, 0.25)], items: { 204: 1e6 } })
  await p.tick(CFG())
  assert.equal(p.enviados.find((m) => m.t === 'hunt.select')?.slug, 'c')
})

await caso('acima de nível 200 aceita golpe de 35% (limiar 50%)', async () => {
  const p = pagina({ hp: 5000, limiar: 50, nivel: 250, linhas: [linha('a', 1000, 0.1), linha('b', 5000, 0.35)], items: { 204: 1e6 } })
  await p.tick(CFG())
  assert.equal(p.enviados.find((m) => m.t === 'hunt.select')?.slug, 'b')
})

await caso('golpe ≥ limiar nunca é seguro, mesmo acima de 200', async () => {
  const p = pagina({ hp: 5000, limiar: 30, nivel: 250, linhas: [linha('a', 1000, 0.1), linha('b', 5000, 0.31)], items: { 204: 1e6 } })
  await p.tick(CFG())
  assert.equal(p.enviados.filter((m) => m.t === 'hunt.select').length, 0)
})

await caso('hunt atual arriscada sai mesmo sem ganho de XP', async () => {
  const p = pagina({ hp: 5000, nivel: 150, linhas: [linha('a', 3000, 0.4), linha('b', 1000, 0.1)], items: { 204: 1e6 } })
  const r = await p.tick(CFG())
  assert.equal(p.enviados.find((m) => m.t === 'hunt.select')?.slug, 'b')
  assert.ok(r.acoes.some((a) => a.msg.includes('arriscada')))
})

await caso('não troca dentro do Safari', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 9000, 0.1)], items: { 204: 1e6 } })
  p.eu.safari = { dentro: true }
  await p.tick(CFG())
  assert.equal(p.enviados.filter((m) => m.t === 'hunt.select').length, 0)
})

await caso('segunda troca espera o tempo mínimo na hunt', async () => {
  const linhas = [linha('a', 1000, 0.1), linha('b', 2000, 0.1)]
  const p = pagina({ hp: 5000, linhas, items: { 204: 1e6 } })
  await p.tick(CFG({ intervalMin: 0 }))
  assert.equal(p.enviados.filter((m) => m.t === 'hunt.select').length, 1)
  p.eu.huntSlug = 'b'
  // 5 min depois aparece uma hunt muito melhor: não pode trocar de novo antes de 15 min
  linhas.push(linha('c', 9000, 0.1))
  p.relogio.t += 5 * 60_000
  await p.tick(CFG({ intervalMin: 0 }))
  assert.equal(p.enviados.filter((m) => m.t === 'hunt.select').length, 1)
  // passados os 15 min, troca
  p.relogio.t += 11 * 60_000
  await p.tick(CFG({ intervalMin: 0 }))
  assert.equal(p.enviados.filter((m) => m.t === 'hunt.select').at(-1).slug, 'c')
})

// ---- 3) compra ----
await caso('compra quando o estoque dura menos de 1h, completando 2h', async () => {
  // consumo: 100 de dano × 600 abates/h = 60.000 HP/h; Ultimate útil 3.000 → 20 poções/h
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1)], items: { 204: 5 } })
  const r = await p.tick(CFG())
  assert.deepEqual(p.enviados.find((m) => m.t === 'shop.buy'), { t: 'shop.buy', kind: 'item', id: 204, qty: 35 })
  assert.equal(Math.round(r.status.potion.perHour), 20)
})

await caso('compra não confirmada pausa as compras por 30 min', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1)], items: { 204: 5 } })
  await p.tick(CFG())
  p.relogio.t += 6 * 60_000 // estoque não subiu (o servidor recusou)
  const r = await p.tick(CFG())
  assert.ok(r.acoes.some((a) => a.msg.includes('não se confirmou')))
  assert.equal(p.enviados.filter((m) => m.t === 'shop.buy').length, 1)
  p.relogio.t += 31 * 60_000
  await p.tick(CFG())
  assert.equal(p.enviados.filter((m) => m.t === 'shop.buy').length, 2)
})

await caso('não compra com estoque suficiente', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1)], items: { 204: 30 } })
  await p.tick(CFG())
  assert.equal(p.enviados.filter((m) => m.t === 'shop.buy').length, 0)
})

await caso('teto de % do ouro limita a compra', async () => {
  const p = pagina({ hp: 5000, gold: 30_000, linhas: [linha('a', 1000, 0.1)], items: { 204: 0 } })
  const r = await p.tick(CFG())
  // 20% de 30.000 = 6.000 → 4 Ultimate
  assert.equal(p.enviados.find((m) => m.t === 'shop.buy')?.qty, 4)
  assert.ok(r.acoes.some((a) => a.msg.includes('limitada')))
})

await caso('sem ouro nem para 1 poção: não compra, avisa e mostra o motivo no painel', async () => {
  const p = pagina({ hp: 5000, gold: 1_000, linhas: [linha('a', 1000, 0.1)], items: { 204: 0 } })
  const r = await p.tick(CFG())
  assert.equal(p.enviados.filter((m) => m.t === 'shop.buy').length, 0)
  assert.ok(r.acoes.some((a) => a.msg.includes('não paga nem 1')))
  assert.match(r.status.potionNote, /^sem ouro/)
})

await caso('painel mostra por que não compra (estoque ok / esperando confirmação)', async () => {
  const ok = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1)], items: { 204: 30 } })
  assert.match((await ok.tick(CFG())).status.potionNote, /^estoque ok/)
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1)], items: { 204: 5 } })
  assert.match((await p.tickSo(CFG())).status.potionNote, /^comprando 35/)
  assert.match((await p.tickSo(CFG())).status.potionNote, /^esperando o jogo confirmar/)
})

// ---- 3b) poções já em estoque (caso da Conta 3) ----
// HP 1.000, limiar 30% → faltam 700. Ouro por HP útil: Small 0,83 · Hyper 1,14 · Ultimate 2,14.
await caso('usa a poção que já tem antes de comprar a ideal', async () => {
  const p = pagina({ hp: 1000, linhas: [linha('a', 1000, 0.1)], items: { 203: 100 } })
  const r = await p.tick(CFG())
  // 100 Hyper × 700 úteis = 70.000 HP; consumo 60.000 HP/h → 1,17 h: não compra
  assert.equal(p.enviados.filter((m) => m.t === 'shop.buy').length, 0)
  assert.deepEqual(p.enviados.find((m) => m.t === 'auto.set').potionIds, [203])
  assert.equal(r.status.potion.name, 'Hyper Potion')
  assert.equal(r.status.potion.buy, 'Small Potion')
})

await caso('marca só a melhor que tem (nada de Small num pokémon de 17k)', async () => {
  const p = pagina({ hp: 17_544, linhas: [linha('a', 1000, 0.1)], items: { 200: 500, 203: 100, 204: 50, 999: 20 }, potionIds: [200, 203, 204, 999] })
  const r = await p.tick(CFG())
  assert.deepEqual(p.enviados.find((m) => m.t === 'auto.set').potionIds, [999])
  assert.ok(r.acoes.some((a) => a.msg.startsWith('deixar só Max Elixir 50%')))
})

await caso('poção ativa acabou: marca a próxima melhor na hora, sem esperar o tick', async () => {
  const p = pagina({ hp: 1000, linhas: [linha('a', 1000, 0.1)], items: { 200: 3, 203: 100, 204: 5 }, potionIds: [200] })
  await p.tick(CFG()) // Small (melhor) já está marcada: nada a mudar
  assert.equal(p.enviados.filter((m) => m.t === 'auto.set').length, 0)
  // a Small acaba no meio da hunt
  p.eu.items[200] = 0
  p.ouvintes.estado(p.eu)
  const set = p.enviados.filter((m) => m.t === 'auto.set')
  assert.equal(set.length, 1)
  assert.deepEqual(set[0].potionIds, [203]) // Hyper 1,14 vem antes de Ultimate 2,14
  assert.ok(p.deck.drenar().acoes.some((a) => a.msg.includes('Small Potion acabou: passando a usar Hyper Potion')))
  // novos estados com a lista antiga não repetem o pedido
  p.ouvintes.estado(p.eu)
  assert.equal(p.enviados.filter((m) => m.t === 'auto.set').length, 1)
})

await caso('simulação não troca a poção quando acaba', async () => {
  const p = pagina({ hp: 1000, linhas: [linha('a', 1000, 0.1)], items: { 200: 3, 203: 100 }, potionIds: [200] })
  await p.tick(CFG({ dryRun: true }))
  p.eu.items[200] = 0
  p.ouvintes.estado(p.eu)
  assert.equal(p.enviados.length, 0)
})

await caso('estoque misto acabando: compra a ideal contando o HP das outras', async () => {
  const p = pagina({ hp: 1000, linhas: [linha('a', 1000, 0.1)], items: { 203: 20 } })
  await p.tick(CFG())
  // 20 Hyper × 700 = 14.000 HP; meta 2 h = 120.000 HP → faltam 106.000 / 60 por Small = 1.767
  assert.deepEqual(p.enviados.find((m) => m.t === 'shop.buy'), { t: 'shop.buy', kind: 'item', id: 200, qty: 1767 })
})

await caso('troca de pokémon troca a poção ativa sozinha', async () => {
  const p = pagina({ hp: 1000, linhas: [linha('a', 1000, 0.1)], items: { 200: 1e4, 204: 1e4 } })
  await p.tick(CFG())
  assert.deepEqual(p.enviados.filter((m) => m.t === 'auto.set').at(-1).potionIds, [200])
  // entra um pokémon de 5.000 de HP (faltam 3.500): Ultimate 0,50 < Small 0,83
  p.eu.pokemons[0].maxHp = 5000
  p.eu.automation.potionIds = [200]
  p.relogio.t += 60_000
  await p.tick(CFG())
  assert.deepEqual(p.enviados.filter((m) => m.t === 'auto.set').at(-1).potionIds, [204])
})

// ---- 4) simulação ----
await caso('simulação não envia nada e registra o que faria', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 0 } })
  const r = await p.tick(CFG({ dryRun: true }))
  assert.equal(p.enviados.length, 0)
  assert.ok(r.acoes.filter((a) => a.msg.startsWith('[simulação] faria:')).length >= 2, JSON.stringify(r.acoes))
})

await caso('sair da simulação age já (a troca simulada não segura a real)', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [200] })
  await p.tick(CFG({ dryRun: true }))
  assert.equal(p.enviados.length, 0)
  p.relogio.t += 60_000
  await p.tick(CFG({ dryRun: false }))
  assert.equal(p.enviados.find((m) => m.t === 'hunt.select')?.slug, 'b')
  assert.deepEqual(p.enviados.find((m) => m.t === 'auto.set')?.potionIds, [204])
})

// ---- 5) troca de verdade: Centro → hunt, trava de combate, ritmo ----
await caso('padrão: troca direto de hunt para hunt (sem Centro, sem desistir)', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204] })
  const r = await p.tick(CFG())
  assert.deepEqual(p.enviados.map((m) => m.t), ['hunt.select'])
  assert.equal(p.eu.huntSlug, 'b')
  assert.ok(!r.acoes.some((a) => a.msg.includes('Centro')))
  assert.ok(p.deck.drenar().acoes.some((a) => a.msg.startsWith('chegou em B')))
})

await caso('direto recusado 7× → tenta pelo Centro 3× → volta para a hunt de origem', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204], recusar: ['b'] })
  await p.tickSo(CFG())
  p.avancar(180_000)
  const seq = p.enviados.map((m) => (m.t === 'hunt.select' ? m.slug : m.t))
  assert.deepEqual(seq, ['b', 'b', 'b', 'b', 'b', 'b', 'b', 'centro.ir', 'b', 'b', 'b', 'a'])
  assert.ok(!seq.includes('centro.desistir'))
  assert.equal(p.eu.huntSlug, 'a')
  assert.equal(p.eu.noCentro, false)
  const msgs = p.deck.drenar().acoes.map((a) => a.msg)
  assert.ok(msgs.some((m) => m.includes('7 vezes a troca direta')))
  assert.ok(msgs.some((m) => m.includes('voltando para A')))
})

await caso('direto recusado 7× mas pelo Centro funciona', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204] })
  p.soDoCentro() // servidor que só aceita trocar de hunt a partir do Centro
  await p.tickSo(CFG())
  p.avancar(120_000)
  const seq = p.enviados.map((m) => (m.t === 'hunt.select' ? m.slug : m.t))
  assert.deepEqual(seq, ['b', 'b', 'b', 'b', 'b', 'b', 'b', 'centro.ir', 'b'])
  assert.equal(p.eu.huntSlug, 'b')
})

await caso('opção Centro: passa pelo Centro, nunca usa desistir e confirma a chegada', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204] })
  await p.tick(CFGc())
  const tipos = p.enviados.map((m) => m.t)
  assert.deepEqual(tipos, ['centro.ir', 'hunt.select'])
  assert.ok(!tipos.includes('centro.desistir'))
  assert.equal(p.eu.huntSlug, 'b')
  assert.ok(p.deck.drenar().acoes.some((a) => a.msg.startsWith('chegou em B')))
})

await caso('em combate, espera 3 s sem golpe para trocar', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204] })
  p.golpe()
  await p.tickSo(CFG())
  // 10 s de combate contínuo (golpe a cada segundo): não sai
  let ultimoGolpe = 0
  for (let i = 0; i < 10; i++) { p.golpe(); ultimoGolpe = p.relogio.t; p.avancar(1000) }
  assert.equal(p.enviados.length, 0)
  p.avancar(15_000)
  const i = p.enviados.findIndex((m) => m.t === 'hunt.select')
  const d = p.tempos[i] - ultimoGolpe
  // sai no instante em que a trava abre: nem antes (seria recusado) nem segundos depois (outro golpe trava de novo)
  assert.ok(i >= 0 && d >= 3000 && d <= 3200, `saiu ${d} ms após o último golpe`)
  assert.equal(p.eu.huntSlug, 'b')
})

await caso('fim da onda (selvagem morreu, sem golpe depois) libera antes dos 3 s', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204] })
  p.golpe()
  await p.tickSo(CFGc())
  p.avancar(1000)
  p.golpe()
  p.avancar(500)
  p.fimDaOnda()
  const t0 = p.relogio.t
  p.avancar(1500)
  const i = p.enviados.findIndex((m) => m.t === 'centro.ir')
  assert.ok(i >= 0 && p.tempos[i] - t0 <= 100, `saiu ${p.tempos[i] - t0} ms após a onda acabar`)
  assert.equal(p.eu.noCentro, true)
})

await caso('ações saem com 2 a 5 s entre uma e outra (+ até 1 s do passo da missão)', async () => {
  // compra + lista de poções + troca no mesmo tick
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 5 }, potionIds: [200] })
  await p.tick(CFG())
  assert.deepEqual(p.enviados.map((m) => m.t).sort(), ['auto.set', 'hunt.select', 'shop.buy'])
  for (let i = 1; i < p.tempos.length; i++) {
    const d = p.tempos[i] - p.tempos[i - 1]
    assert.ok(d >= 2000 && d <= 6100, `intervalo ${d} ms entre ${p.enviados[i - 1].t} e ${p.enviados[i].t}`)
  }
})

await caso('opção Centro: o jogo recusa a hunt nova, volta para a de onde saiu', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204], recusar: ['b'] })
  await p.tickSo(CFGc())
  p.avancar(60_000)
  assert.deepEqual(p.enviados.filter((m) => m.t === 'hunt.select').map((m) => m.slug), ['b', 'b', 'b', 'a'])
  assert.equal(p.eu.huntSlug, 'a')
  assert.equal(p.eu.noCentro, false)
  assert.ok(p.deck.drenar().acoes.some((a) => a.msg.includes('voltando para A')))
})

await caso('desligar cancela a troca e as ações na fila', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 5 }, potionIds: [200] })
  p.golpe()
  await p.tickSo(CFG())
  p.avancar(500)
  const antes = p.enviados.length
  p.deck.parar()
  p.avancar(60_000)
  assert.equal(p.enviados.length, antes)
})

await caso('sem /hunt: para com erro claro', async () => {
  const p = pagina({ hp: 5000, linhas: [] })
  // derruba o /hunt depois de carregado não é o caso real; simula página sem ele
  const ctx = vm.createContext({ window: { WebSocket: class { static OPEN = 1 }, location: { href: 'https://pokeidle.io/', host: 'pokeidle.io' } }, URL, Intl, Math, Number, JSON, Date, Promise, String, Map, Infinity, setTimeout: (f) => f(), setInterval: () => 0, clearInterval: () => {}, clearTimeout: () => {}, fetch })
  vm.runInContext(SRC, ctx)
  const r = await ctx.window.__deckAuto.tick(CFG())
  assert.equal(r.status.state, 'erro')
  assert.match(r.status.message, /\/hunt/)
  void p
})

// ---- fora de hunt: a conta deve estar sempre numa hunt ----
await caso('no Centro: vai para a melhor hunt segura (com 2–5 s), sem esperar o tempo mínimo', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1), linha('c', 3000, 0.9)], items: { 204: 1e6 }, potionIds: [204] })
  p.eu.noCentro = true
  const r = await p.tickSo(CFG())
  assert.ok(r.acoes.some((a) => a.msg.includes('sair do Centro e ir para B')), JSON.stringify(r.acoes))
  assert.equal(p.enviados.filter((m) => m.t === 'hunt.select').length, 0, 'não manda no mesmo instante')
  p.avancar(6000)
  assert.deepEqual(p.enviados.find((m) => m.t === 'hunt.select'), { t: 'hunt.select', slug: 'b' })
  assert.equal(p.eu.noCentro, false)
  assert.equal(p.eu.huntSlug, 'b')
  assert.ok(!p.enviados.some((m) => m.t === 'centro.desistir'))
})

await caso('sem hunt (huntSlug vazio): entra na melhor hunt segura', async () => {
  const p = pagina({ hp: 5000, huntSlug: null, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204] })
  await p.tick(CFG())
  assert.equal(p.eu.huntSlug, 'b')
})

await caso('no Centro, hunt recusada 3 vezes: tenta a próxima segura no tick seguinte', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204], recusar: ['b'] })
  p.eu.noCentro = true
  await p.tickSo(CFG())
  p.avancar(30_000)
  assert.equal(p.enviados.filter((m) => m.t === 'hunt.select' && m.slug === 'b').length, 3)
  assert.equal(p.eu.noCentro, true)
  const falhas = p.deck.drenar().acoes
  assert.ok(falhas.some((a) => a.msg.includes('tenta outra hunt')), JSON.stringify(falhas))
  p.relogio.t += 60_000
  const r = await p.tickSo(CFG())
  assert.ok(r.acoes.some((a) => a.msg.includes('ir para A')), JSON.stringify(r.acoes))
  p.avancar(6000)
  assert.equal(p.eu.huntSlug, 'a')
  assert.equal(p.eu.noCentro, false)
})

await caso('no Centro sem nenhuma hunt segura: fica e explica', async () => {
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.9)], items: { 204: 1e6 }, potionIds: [204] })
  p.eu.noCentro = true
  const r = await p.tickSo(CFG())
  assert.equal(p.enviados.filter((m) => m.t === 'hunt.select').length, 0)
  assert.match(r.status.huntNote, /nenhuma hunt segura/)
})

// ---- memória entre recarregamentos da página ----
const fakeStorage = () => { const d = new Map(); return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => d.set(k, String(v)), d } }

await caso('recarregou a página: lembra a troca recente (tempo mínimo na hunt)', async () => {
  const storage = fakeStorage()
  const p1 = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204], storage })
  await p1.tick(CFG())
  assert.equal(p1.eu.huntSlug, 'b')
  // página recarregou 1 min depois; agora 'c' rende mais, mas faz só 1 min da troca
  const p2 = pagina({ hp: 5000, huntSlug: 'b', linhas: [linha('b', 2000, 0.1), linha('c', 3000, 0.1)], items: { 204: 1e6 }, potionIds: [204], storage, inicio: p1.relogio.t + 60_000 })
  const r = await p2.tick(CFG())
  assert.equal(p2.enviados.filter((m) => m.t === 'hunt.select').length, 0, JSON.stringify(r.acoes))
  assert.match(r.status.huntNote, /tempo mínimo/)
})

await caso('recarregou a página: compra pausada continua pausada', async () => {
  const storage = fakeStorage()
  const p1 = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1)], items: { 204: 5 }, storage })
  await p1.tick(CFG())
  p1.relogio.t += 6 * 60_000
  await p1.tick(CFG()) // não se confirmou → pausa 30 min
  const p2 = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1)], items: { 204: 5 }, storage, inicio: p1.relogio.t + 60_000 })
  const r = await p2.tick(CFG())
  assert.equal(p2.enviados.filter((m) => m.t === 'shop.buy').length, 0)
  assert.match(r.status.potionNote, /pausadas/)
})

await caso('memória estragada no storage: começa do zero sem quebrar', async () => {
  const storage = fakeStorage()
  storage.setItem('deckAuto.mem.v1', '{isso não é json')
  const p = pagina({ hp: 5000, linhas: [linha('a', 1000, 0.1), linha('b', 2000, 0.1)], items: { 204: 1e6 }, potionIds: [204], storage })
  const r = await p.tick(CFG())
  assert.equal(r.status.state, 'ok')
  assert.equal(p.eu.huntSlug, 'b')
})

console.log(`\n${ok} casos passaram`)
