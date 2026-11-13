// Deck Auto — roda dentro da página do Pokeidle (world MAIN), uma instância por conta.
//
// Não faz nada sozinho: o processo principal do Deck chama `window.__deckAuto.tick(cfg)` de tempos
// em tempos (src/main/autoPilot.ts). Desligar a automação no Deck = parar de chamar o tick.
//
// Lê o estado do jogo e o ranking de hunts pela extensão /hunt for PokeIdle (window.__pokeidleHunt)
// e age mandando as mesmas mensagens que os botões do jogo mandam pelo WebSocket:
//   - compra na loja do NPC:  { t: 'shop.buy', kind: 'item', id, qty }
//   - troca de hunt:          { t: 'hunt.select', slug }
//   - lista de poções da automação do jogo: { t: 'auto.set', ...automation, potionIds }
(function () {
  'use strict';
  if (window.__deckAuto) return;

  // ---- o socket do jogo ---------------------------------------------------------------------
  // Guarda a referência do WebSocket do próprio jogo (mesmo host da página). Precisa rodar antes do
  // cliente abrir o socket, por isso document_start. Convive com o gancho do /hunt: cada um embrulha
  // o construtor que encontrou.
  let sock = null;
  const Original = window.WebSocket;
  function WebSocketDoDeck(...args) {
    const ws = new Original(...args);
    try {
      const alvo = new URL(String(args[0]), location.href);
      if (alvo.host === location.host) {
        sock = ws;
        ws.addEventListener('message', ouvirSocket);
        ws.addEventListener('close', () => { if (sock === ws) sock = null; });
      }
    } catch { /* URL estranha: não é o socket do jogo */ }
    return ws;
  }
  WebSocketDoDeck.prototype = Original.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) WebSocketDoDeck[k] = Original[k];
  window.WebSocket = WebSocketDoDeck;

  // ---- estado vindo do /hunt -----------------------------------------------------------------
  let welcome = null;
  let eu = null;
  let assinado = false;
  const PIH = () => window.__pokeidleHunt;
  function assinar() {
    if (assinado) return true;
    const p = PIH();
    if (!p?.on) return false;
    // 'welcome' e 'estado' ficam retidos no barramento do /hunt: quem assina tarde recebe o último.
    p.on('welcome', (m) => { welcome = m; });
    p.on('estado', (e) => { eu = e; medirGasto(); vigiarPocaoAtiva(); });
    assinado = true;
    return true;
  }
  // Tenta já, para não perder nada; o tick tenta de novo se o /hunt carregar depois.
  setTimeout(assinar, 0);

  // ---- catálogo de poções --------------------------------------------------------------------
  let catalogo = null; // Map id → item
  async function pocoesDoJogo() {
    if (!catalogo) {
      const mapa = new Map();
      try {
        const r = await fetch('/assets/items.json', { cache: 'no-cache' });
        const j = await r.json();
        for (const i of j.items ?? []) mapa.set(i.id, i);
      } catch { /* sem o arquivo, usa só o que veio no welcome */ }
      catalogo = mapa;
    }
    // Itens próprios do servidor (ex.: a poção que cura % do HP) vêm em welcome.itensNossos e
    // completam o arquivo — é o mesmo catálogo que o Market do jogo usa (estado.itens).
    // (welcome.itensCompraveis é outra coisa: preços de ovos no formato { itemId, preco }.)
    for (const i of welcome?.itensNossos ?? []) {
      if (i && i.id != null) catalogo.set(i.id, { ...catalogo.get(i.id), ...i });
    }
    return [...catalogo.values()].filter(
      (i) => i.category === 'heal' && Number(i.npcPrice) > 0 && (Number(i.healAmount) > 0 || Number(i.healPct) > 0)
    );
  }

  // ---- memória entre ticks -------------------------------------------------------------------
  const mem = {
    ultimaAvaliacao: -Infinity,
    ultimaTroca: -Infinity,
    ultimaCompra: -Infinity,
    compraPendente: null, // { id, antes, em }
    comprasPausadasAte: 0,
    ultimaListaPocao: '',
    // Para trocar a poção na hora em que a ativa acaba (sem esperar o próximo tick):
    vigiaPocao: null, // { ranking: [{ id, nome }] da melhor para a pior } — null = não gerenciar
    reservaPedida: null,
    utilPorId: null, // Map id → HP útil da poção para o pokémon em campo (do último tick)
    avisos: new Map(), // chave → quando avisou
    // Fora de hunt (Centro): sai para a melhor hunt segura, no máximo uma tentativa por minuto.
    ultimaSaidaCentro: -Infinity,
    recusadas: new Map(), // slug → quando o jogo não aceitou entrar (pula essa hunt por 10 min)
  };
  const AVISO_REPETE_MS = 30 * 60_000;

  // A memória sobrevive ao recarregar a página (watchdog, atualização do jogo, automação nova): sem
  // isso a conta esquecia o tempo mínimo na hunt, a compra a confirmar e as hunts recusadas. Fica no
  // localStorage da própria conta (cada conta tem a sua sessão). Datas são Date.now(), valem entre
  // recarregamentos; -Infinity vira null no JSON e volta aqui.
  const CHAVE_MEM = 'deckAuto.mem.v1';
  const PERSISTE = ['simul', 'ultimaAvaliacao', 'ultimaTroca', 'ultimaCompra', 'compraPendente',
    'comprasPausadasAte', 'ultimaSaidaCentro', 'recusadas', 'avisos'];
  function carregarMem() {
    try {
      const salvo = JSON.parse(window.localStorage?.getItem(CHAVE_MEM) ?? 'null');
      if (!salvo || typeof salvo !== 'object') return;
      for (const k of PERSISTE) {
        if (!(k in salvo)) continue;
        const v = salvo[k];
        if (k === 'recusadas' || k === 'avisos') mem[k] = new Map(Array.isArray(v) ? v : []);
        else if (k === 'simul' || k === 'compraPendente') mem[k] = v;
        else mem[k] = typeof v === 'number' ? v : -Infinity;
      }
    } catch { /* sem localStorage ou dado estragado: começa do zero */ }
  }
  function guardarMem() {
    try {
      for (const [slug, em] of mem.recusadas) if (Date.now() - em > 10 * MIN) mem.recusadas.delete(slug);
      const o = {};
      for (const k of PERSISTE) {
        const v = mem[k];
        o[k] = v instanceof Map ? [...v] : v;
      }
      window.localStorage?.setItem(CHAVE_MEM, JSON.stringify(o));
    } catch { /* sem localStorage: segue só na memória */ }
  }
  carregarMem();

  const nf = new Intl.NumberFormat('pt-BR');
  const num = (v) => nf.format(Math.round(v));
  const pct = (v) => `${Math.round(v * 100)}%`;
  const MIN = 60_000;
  const EMPATE_XP = 0.01; // XP/h com menos de 1% de diferença = empate (decide pelo golpe menor)

  function enviar(msg) {
    if (!sock || sock.readyState !== Original.OPEN) throw new Error('socket do jogo fechado');
    sock.send(JSON.stringify(msg));
  }

  // ---- combate: a trava de 3 s para sair da hunt ------------------------------------------------
  // O jogo só deixa sair da hunt (ir ao Centro) depois de 3 s sem dar nem tomar dano, ou quando não
  // há selvagem vivo (fim da onda). Os golpes chegam em mensagens { t: 'batalha', ev: [...] }; aqui
  // só se lê, nada é alterado. Erros do servidor ({ t: 'erro' }) são guardados para o log da troca.
  const TRAVA_COMBATE_MS = 3000;
  const combate = { ultimoGolpe: -Infinity, ultimoFimDeOnda: -Infinity, ultimoErro: null };
  function ouvirSocket(ev) {
    if (typeof ev.data !== 'string') return;
    const cab = ev.data.slice(0, 40);
    const batalha = cab.includes('"t":"batalha"');
    const erro = cab.includes('"t":"erro"');
    if (!batalha && !erro) return;
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    const agora = Date.now();
    if (erro) { combate.ultimoErro = { em: agora, txt: m.chave ?? m.msg ?? 'erro' }; return; }
    let morreu = false;
    for (const e of m.ev ?? []) {
      if (e.k === 'ataque') combate.ultimoGolpe = agora;
      else if (e.k === 'morte' && e.quem === 'selvagem') { combate.ultimoFimDeOnda = agora; morreu = true; }
      else if (e.k === 'spawn') combate.ultimoFimDeOnda = -Infinity;
    }
    // Saindo da hunt: reage na hora. Selvagem morreu sem golpe depois → tenta já (a onda pode ter
    // acabado); golpe → reagenda para o instante em que a trava de 3 s expira.
    if (missao?.fase === 'sair') {
      if (morreu && combate.ultimoFimDeOnda >= combate.ultimoGolpe) passoMissao();
      else agendarSaida();
    }
  }
  // A janela de troca é curta (qualquer golpe trava de novo por 3 s): o envio sai no instante em que
  // ela abre, sem espera nem polling. Se o palpite errar, o servidor recusa e a missão tenta de novo
  // na próxima janela — nunca usa "desistir".
  const FOLGA_MS = 100; // o golpe chega aqui depois de acontecer no servidor
  const livrePorTempo = (agora) => agora - combate.ultimoGolpe >= TRAVA_COMBATE_MS + FOLGA_MS;
  const livrePorOnda = () => combate.ultimoFimDeOnda > -Infinity && combate.ultimoFimDeOnda >= combate.ultimoGolpe;
  const REENVIO_MS = 800; // espera a resposta do servidor antes de tentar de novo
  const MAX_TENTATIVAS_ONDA = 20; // palpites "fim da onda" (não contam nas 7 recusas)
  function agendarSaida() {
    const m = missao;
    if (!m || m.fase !== 'sair') return;
    clearTimeout(m.agenda);
    const agora = Date.now();
    const quando = Math.max(combate.ultimoGolpe + TRAVA_COMBATE_MS + FOLGA_MS, m.ultimoEnvio + REENVIO_MS);
    m.agenda = setTimeout(passoMissao, Math.max(0, quando - agora));
  }

  // ---- fila de ações: alguns segundos entre uma e outra ------------------------------------------
  // Marcar poções, comprar e escolher a hunt já no Centro saem um de cada vez, com 2–5 s entre eles,
  // no ritmo de quem joga na mão (e sem rajada de mensagens para o servidor). A SAÍDA da hunt não
  // espera: a janela sem combate é curta.
  const ESPACO_MIN_MS = 2000;
  const ESPACO_MAX_MS = 5000;
  const espaco = () => ESPACO_MIN_MS + Math.random() * (ESPACO_MAX_MS - ESPACO_MIN_MS);
  const fila = [];
  let filaRodando = false;
  let proximaAcaoEm = -Infinity;
  function enfileirar(rotulo, fn) {
    fila.push({ rotulo, fn });
    rodarFila();
  }
  function rodarFila() {
    if (filaRodando || !fila.length) return;
    filaRodando = true;
    setTimeout(() => {
      const a = fila.shift();
      let mandou = true;
      try { mandou = a?.fn() !== false; } catch (err) { registrar('warn', `não consegui ${a.rotulo}: ${err?.message ?? err}`); }
      if (mandou) proximaAcaoEm = Date.now() + espaco(); // só o que foi para o jogo conta no ritmo
      filaRodando = false;
      rodarFila();
    }, Math.max(0, proximaAcaoEm - Date.now()));
  }
  /** Para ações fora da fila (passos da missão): manda já se o espaço passou; senão espera. */
  function podeAgir(agora) { return !filaRodando && !fila.length && agora >= proximaAcaoEm; }
  function agiu() { proximaAcaoEm = Date.now() + espaco(); }

  // ---- missão de troca de hunt -------------------------------------------------------------------
  // Saída: disparada por evento (fim da trava / fim da onda), com um passo de 1 s como rede de segurança.
  // Padrão: espera a trava de combate e escolhe a hunt nova direto (como o mapa do jogo faz).
  // Com `viaCentro`: espera a trava, vai ao Centro ('centro.ir', botão "Ir ao Centro") e de lá escolhe.
  // Nunca manda 'centro.desistir' (perde XP).
  const PASSO_MS = 1000;
  const MISSAO_MAX_MS = 5 * MIN;
  let missao = null;
  const pendentes = []; // ações da missão, entregues ao Deck no próximo drenar()/tick
  const registrar = (nivel, msg) => pendentes.push({ nivel, msg });

  // Direto: 7 recusas → tenta pelo Centro. Pelo Centro: até 10 'centro.ir' e 3 'hunt.select' lá
  // dentro; se a hunt nova não aceitar, volta para a hunt de onde saiu.
  const MAX_DIRETO = 7;
  const MAX_IR_CENTRO = 10;
  const MAX_DO_CENTRO = 3;
  function iniciarMissao(de, para, viaCentro) {
    pararMissao();
    missao = {
      de, para, viaCentro: !!viaCentro, fase: 'sair', inicio: Date.now(), ultimoEnvio: -Infinity,
      enviosSair: 0, enviosOnda: 0, enviosEntrar: 0, agenda: null, timer: setInterval(passoMissao, PASSO_MS),
    };
    passoMissao();
  }
  function pararMissao() {
    if (missao?.timer) clearInterval(missao.timer);
    if (missao?.agenda) clearTimeout(missao.agenda);
    missao = null;
  }
  function passoMissao() {
    const m = missao;
    if (!m || !eu) return;
    const agora = Date.now();
    const chegou = eu.huntSlug === m.para.slug && !eu.noCentro;
    if (chegou) {
      registrar('info', `chegou em ${m.para.nome} (${Math.round((agora - m.inicio) / 1000)} s)`);
      return pararMissao();
    }
    if (agora - m.inicio > MISSAO_MAX_MS) {
      const erro = combate.ultimoErro && combate.ultimoErro.em >= m.inicio ? ` — jogo: ${combate.ultimoErro.txt}` : '';
      registrar('warn', `troca para ${m.para.nome} não terminou em 5 min (fase: ${m.fase === 'sair' ? 'saindo da hunt' : 'no Centro'})${erro}`);
      return pararMissao();
    }
    if (eu.safari?.dentro || eu.boss?.arena || eu.mistico || eu.casa?.dentro) {
      registrar('warn', `troca para ${m.para.nome} cancelada: a conta entrou em outra atividade`);
      return pararMissao();
    }
    if (!sock || sock.readyState !== Original.OPEN) return; // reconectando: espera
    if (eu.noCentro && m.fase === 'sair') { m.fase = 'entrar'; agiu(); } // escolhe a hunt alguns segundos depois de chegar

    if (m.fase === 'sair') {
      // Janela aberta = manda JÁ (sem o intervalo da fila). Fora dela, agenda para quando abrir.
      const porTempo = livrePorTempo(agora);
      const porOnda = !porTempo && livrePorOnda() && m.enviosOnda < MAX_TENTATIVAS_ONDA;
      if ((porTempo || porOnda) && agora - m.ultimoEnvio >= REENVIO_MS) {
        const erro = combate.ultimoErro && combate.ultimoErro.em >= m.inicio ? ` — jogo: ${combate.ultimoErro.txt}` : '';
        if (porTempo && !m.viaCentro && m.enviosSair >= MAX_DIRETO) {
          registrar('warn', `o jogo recusou ${MAX_DIRETO} vezes a troca direta para ${m.para.nome}; tentando pelo Centro${erro}`);
          m.viaCentro = true; // a janela está aberta: vai ao Centro agora mesmo
          m.enviosSair = 0;
        } else if (porTempo && m.viaCentro && m.enviosSair >= MAX_IR_CENTRO) {
          registrar('warn', `o jogo recusou ${MAX_IR_CENTRO} vezes ir ao Centro; continua em ${m.de?.nome ?? "onde está"}${erro}`);
          return pararMissao();
        }
        enviar(m.viaCentro ? { t: 'centro.ir' } : { t: 'hunt.select', slug: m.para.slug });
        m.ultimoEnvio = agora;
        if (porTempo) m.enviosSair++;
        else m.enviosOnda++;
        agiu();
      }
      agendarSaida();
    } else if (agora - m.ultimoEnvio >= 5000 && podeAgir(agora)) {
      if (m.enviosEntrar >= MAX_DO_CENTRO) {
        const erro = combate.ultimoErro && combate.ultimoErro.em >= m.inicio ? ` — jogo: ${combate.ultimoErro.txt}` : '';
        mem.recusadas.set(m.para.slug, agora);
        guardarMem();
        if (!m.de) {
          // Saiu do Centro e a hunt não aceitou: o próximo tick tenta a próxima hunt segura.
          registrar('warn', `o jogo não aceitou ir para ${m.para.nome}; tenta outra hunt em seguida${erro}`);
          return pararMissao();
        }
        // Não deixa a conta parada no Centro: volta para a hunt de onde saiu.
        enviar({ t: 'hunt.select', slug: m.de.slug });
        registrar('warn', `o jogo não aceitou ir para ${m.para.nome}; voltando para ${m.de.nome}${erro}`);
        return pararMissao();
      }
      enviar({ t: 'hunt.select', slug: m.para.slug });
      m.ultimoEnvio = agora;
      m.enviosEntrar++;
      agiu();
    }
  }

  // ---- poção ativa acabou: marca a próxima na hora ------------------------------------------------
  // Chamado a cada atualização de estado do jogo. Só age se o tick deixou o ranking (modo real com
  // "gerenciar Usar Poções") e a única poção marcada zerou.
  function vigiarPocaoAtiva() {
    const v = mem.vigiaPocao;
    if (!v || !eu?.automation) return;
    const ativa = eu.automation.potionIds ?? [];
    if (ativa.length !== 1 || Number(eu.items?.[ativa[0]] ?? 0) > 0) return;
    const prox = v.ranking.find((x) => x.id !== ativa[0] && Number(eu.items?.[x.id] ?? 0) > 0);
    if (!prox || mem.reservaPedida === prox.id) return;
    mem.reservaPedida = prox.id;
    mem.ultimaListaPocao = JSON.stringify([prox.id]);
    const acabou = v.ranking.find((x) => x.id === ativa[0])?.nome ?? `item ${ativa[0]}`;
    registrar('info', `${acabou} acabou: passando a usar ${prox.nome}`);
    // Sem o intervalo da fila: o pokémon não pode ficar sem poção.
    try { enviar({ t: 'auto.set', ...eu.automation, potionIds: [prox.id] }); agiu(); }
    catch (err) { registrar('warn', `não consegui trocar a poção: ${err?.message ?? err}`); }
  }

  // ---- gasto real de poção ------------------------------------------------------------------------
  // A estimativa do /hunt (dano por abate × abates/h) pode errar muito (ex.: Conta 1 estimava 36
  // Golden/h e gastava ~160/h). Aqui se mede o HP útil em poções que some do estoque a cada estado do
  // jogo, nos últimos 30 min, na mesma hunt e com o mesmo pokémon. Compra (estoque sobe) não conta.
  // O tick usa o maior entre estimado e medido.
  const JANELA_GASTO_MS = 30 * MIN;
  const MIN_MEDICAO_MS = 5 * MIN;
  const gasto = { chave: '', ultimoHp: null, quedas: [], desde: 0 };
  const hpEmPocoes = (util) => {
    let hp = 0;
    for (const [id, u] of util) hp += Number(eu?.items?.[id] ?? 0) * u;
    return hp;
  };
  function medirGasto() {
    const util = mem.utilPorId;
    if (!util || !eu) return;
    const agora = Date.now();
    const chave = `${eu.activeId}|${eu.huntSlug}|${eu.noCentro ? 'c' : 'h'}`;
    const hp = hpEmPocoes(util);
    if (chave !== gasto.chave) {
      Object.assign(gasto, { chave, ultimoHp: hp, quedas: [], desde: agora });
      return;
    }
    if (gasto.ultimoHp != null && hp < gasto.ultimoHp) gasto.quedas.push({ t: agora, hp: gasto.ultimoHp - hp });
    gasto.ultimoHp = hp;
    while (gasto.quedas.length && agora - gasto.quedas[0].t > JANELA_GASTO_MS) gasto.quedas.shift();
  }
  /** HP/h gasto em poções, medido; null enquanto não há pelo menos 5 min de medição nesta hunt. */
  function gastoMedido(agora) {
    const span = Math.min(JANELA_GASTO_MS, agora - gasto.desde);
    if (!gasto.chave || span < MIN_MEDICAO_MS) return null;
    const soma = gasto.quedas.filter((q) => agora - q.t <= JANELA_GASTO_MS).reduce((s, q) => s + q.hp, 0);
    return (soma / span) * 60 * MIN;
  }

  function limiarDe(automation) {
    const v = Number(automation?.hpLimiar);
    if (!Number.isFinite(v) || v <= 0) return null;
    return v > 1 ? v / 100 : v;
  }

  // ---- o tick ----------------------------------------------------------------------------------
  async function tick(cfg) {
    try { return await tickInterno(cfg); } finally { guardarMem(); }
  }
  async function tickInterno(cfg) {
    const agora = Date.now();
    const simul = !!cfg.dryRun;
    const prefixo = simul ? '[simulação] faria: ' : '';
    // Ao trocar entre simulação e modo real, esquece as ações registradas: uma troca de hunt ou
    // lista de poções "feita" na simulação não pode segurar a de verdade (tempo mínimo na hunt etc.).
    if (mem.simul !== simul) {
      pararMissao();
      fila.length = 0;
      Object.assign(mem, {
        simul, ultimaAvaliacao: -Infinity, ultimaTroca: -Infinity,
        ultimaCompra: -Infinity, compraPendente: null, comprasPausadasAte: 0, ultimaListaPocao: '',
        ultimaSaidaCentro: -Infinity,
      });
    }
    const status = { state: 'aguardando', message: '', checkedAt: agora };
    const acoes = pendentes.splice(0); // o que a missão de troca fez desde o último tick
    const fim = (state, message) => ({ status: { ...status, state, message }, acoes });
    // Avisos que se repetiriam a cada tick saem no máximo uma vez a cada 30 min.
    const avisar = (chave, msg) => {
      if (mem.avisos.has(chave) && agora - mem.avisos.get(chave) < AVISO_REPETE_MS) return;
      mem.avisos.set(chave, agora);
      acoes.push({ nivel: 'warn', msg });
    };

    if (!assinar()) return fim('erro', 'A extensão /hunt for PokeIdle não está carregada nesta conta');
    if (!sock || sock.readyState !== Original.OPEN) return fim('aguardando', 'Esperando a conexão com o jogo');
    if (!welcome || !eu) return fim('aguardando', 'Esperando o jogo mandar o estado');

    const pk = eu.pokemons?.find((p) => p.id === eu.activeId);
    if (!pk) return fim('aguardando', 'Sem pokémon em campo');
    status.pokemon = pk.nome ?? pk.name ?? `#${pk.speciesId}`;

    const p = PIH();
    if (!p.engine?.analisar || !p.carregarJogo) return fim('erro', 'O /hunt mudou: engine.analisar não encontrado');

    // Confere a compra do tick anterior (o servidor pode recusar sem avisar a gente). A troca de
    // hunt se confere sozinha, na missão.
    if (mem.compraPendente && agora - mem.compraPendente.em > 20_000) {
      const tem = Number(eu.items?.[mem.compraPendente.id] ?? 0);
      if (!simul && tem <= mem.compraPendente.antes) {
        mem.comprasPausadasAte = agora + 30 * MIN;
        acoes.push({ nivel: 'warn', msg: 'a compra de poção não se confirmou; compras pausadas por 30 min' });
      }
      mem.compraPendente = null;
    }

    // ---- análise (a mesma do painel /hunt) ----
    const jogo = await p.carregarJogo();
    const chave = p.geo?.chaveDoPokemon?.(pk);
    const ctx = {
      mod: jogo.mod,
      especies: jogo.especies,
      hunts: welcome.hunts ?? [],
      consts: {
        tabelaTipos: welcome.tabelaTipos,
        ampliacaoHunt: welcome.ampliacaoHunt,
        multHpSelvagem: welcome.multHpSelvagem,
        multDanoSelvagem: welcome.multDanoSelvagem,
        tiposBoost: welcome.tiposBoost,
        catalogoBolas: welcome.catalogoBolas,
        captura: welcome.captura,
        chanceShiny: welcome.chanceShiny,
        shinyLooks: welcome.shinyLooks,
      },
      eu,
      ritmo: p.ritmo ?? null,
      mapaVisto: (slug) => p.geo?.mapaDa?.(slug) ?? null,
      ritmoMedido: (slug) => (chave ? p.geo?.ritmoMedido?.(slug, chave) ?? null : null),
    };
    const r = p.engine.analisar(pk, ctx, { ordem: 'xp', soLiberadas: true, comPocao: true });
    const REGRAS = p.engine.REGRAS ?? {};
    const hpMax = Number(pk.maxHp) || Math.max(REGRAS.hpCombateMin ?? 1, Math.round(pk.stats.hp * (REGRAS.hpCombateMult ?? 1)));
    status.hpMax = hpMax;

    const automation = eu.automation ?? {};
    const L = limiarDe(automation);
    if (L == null) return fim('erro', 'Não achei o limiar da poção automática do jogo (automation.hpLimiar)');
    status.limiar = L;

    // ---- 1) poções: ranking por preço por HP útil ----
    // A poção dispara com a vida abaixo de L, então faltam pelo menos (1 − L) × HP máx: o que a poção
    // curar além disso é desperdício.
    const falta = (1 - L) * hpMax;
    const pocoes = (await pocoesDoJogo()).map((i) => {
      const cura = Number(i.healAmount) > 0 ? Number(i.healAmount) : Number(i.healPct) * hpMax;
      const util = Math.min(cura, falta);
      return {
        id: i.id, nome: i.name ?? `item ${i.id}`, preco: Number(i.npcPrice), cura, util,
        custoHp: Number(i.npcPrice) / util, qtd: Number(eu.items?.[i.id] ?? 0),
      };
    }).filter((x) => x.util > 0).sort((a, b) => a.custoHp - b.custoHp);
    if (!pocoes.length) return fim('erro', 'Nenhuma poção comprável no NPC encontrada no catálogo do jogo');
    // Poção que cura menos que um golpe do selvagem não segura o pokémon (ex.: Small de 60 HP num
    // pokémon de 19k levando golpes de 2.900): não é usada, não é comprada e não conta no estoque.
    const linhasR = r.linhas ?? [];
    const golpe = (linhasR.find((l) => l.slug === eu.huntSlug)?.hitPct ?? 0) * hpMax;
    const adequadas = pocoes.filter((x) => x.cura >= golpe);
    // `ideal`: a que vale a pena comprar. `emEstoque`: as adequadas que a conta já tem, da melhor para a
    // pior — a primeira vai para "Usar Poções"; quando acaba, a próxima. Só elas contam no estoque.
    const ideal = adequadas[0] ?? [...pocoes].sort((a, b) => b.cura - a.cura)[0];
    const emEstoque = adequadas.filter((x) => x.qtd > 0);
    const ignoradas = pocoes.filter((x) => x.qtd > 0 && x.cura < golpe);
    const usando = emEstoque[0] ?? ideal;
    // HP útil de cada poção para este pokémon (a medição de gasto usa). Mudou (subiu de nível etc.):
    // reancora a medição sem contar a diferença como gasto.
    mem.utilPorId = new Map(pocoes.map((x) => [x.id, x.util]));
    if (gasto.chave) gasto.ultimoHp = hpEmPocoes(mem.utilPorId);
    else medirGasto();

    const hpH = (l) => (l.danoPorAbate || 0) * (l.kph || 0); // HP curado por hora na hunt
    const custoH = (l) => (hpH(l) / ideal.util) * ideal.preco; // custo de longo prazo (repondo com a ideal)
    const pocoesH = (l) => hpH(l) / usando.util;

    // ---- 2) quais hunts são seguras ----
    const h = cfg.hunts;
    const nivelRef = h.levelOf === 'pokemon' ? Number(pk.level) : Number(eu.level);
    const teto = nivelRef <= h.lowLevel ? h.lowLevelMaxHitPct / 100 : 1;
    const segura = (l) =>
      !l.inviavel && l.liberada && !l.umHit &&
      l.hitPct < L && // um golpe maior que o HP no limiar pode matar antes da poção disparar
      l.hitPct <= teto &&
      (!h.requirePositiveGold || l.ouroH - custoH(l) >= 0);
    const linhas = linhasR;
    // Ordem de preferência: a de maior XP/h; mas hunts com XP/h praticamente igual ao da melhor (menos
    // de EMPATE_XP de diferença) são empate — entre elas ganha a de menor golpe. Evita trocar por "+0%"
    // para uma hunt mais arriscada (ex.: Nincada 2% ↔ Shedinja 15%).
    const porXp = linhas.filter(segura).sort((a, b) => b.xpTreinadorH - a.xpTreinadorH);
    const topo = porXp[0]?.xpTreinadorH ?? 0;
    const naFaixa = (l) => l.xpTreinadorH >= topo * (1 - EMPATE_XP);
    const seguras = [
      ...porXp.filter(naFaixa).sort((a, b) => a.hitPct - b.hitPct || b.xpTreinadorH - a.xpTreinadorH),
      ...porXp.filter((l) => !naFaixa(l)),
    ];
    const atual = linhas.find((l) => l.slug === eu.huntSlug) ?? null;
    const melhor = seguras[0] ?? null;

    if (atual) status.hunt = { name: atual.nome, xpH: atual.xpTreinadorH, hitPct: atual.hitPct, safe: segura(atual) };
    if (melhor) status.best = { name: melhor.nome, xpH: melhor.xpTreinadorH, hitPct: melhor.hitPct };

    // ---- 3) trocar de hunt? ----
    let alvo = atual; // a hunt em que a conta vai estar (para calcular o estoque)
    const podeAvaliar = agora - mem.ultimaAvaliacao >= cfg.intervalMin * MIN;
    const ocupada = eu.safari?.dentro || eu.boss?.arena || eu.mistico || eu.casa?.dentro;
    const foraDeHunt = eu.noCentro || !eu.huntSlug;
    if (h.enabled && foraDeHunt && !ocupada && !missao) {
      // A conta deve estar sempre numa hunt: do Centro vai para a melhor hunt segura (pula por 10 min
      // as que o jogo acabou de recusar). Sem hunt segura, fica no Centro.
      const recusadaAgora = (l) => agora - (mem.recusadas.get(l.slug) ?? -Infinity) < 10 * MIN;
      const destino = seguras.find((l) => !recusadaAgora(l)) ?? null;
      if (!destino) {
        status.huntNote = melhor ? 'fora de hunt: o jogo recusou as hunts seguras; tenta de novo em 10 min' : 'fora de hunt e nenhuma hunt segura para este pokémon';
        if (!melhor) avisar('sem-hunt', `nenhuma hunt liberada passa no limite de risco para ${status.pokemon}`);
      } else if (agora - mem.ultimaSaidaCentro >= MIN) {
        mem.ultimaSaidaCentro = agora;
        mem.ultimaTroca = agora;
        mem.ultimaAvaliacao = agora;
        const para = { slug: destino.slug, nome: destino.nome };
        if (!simul) enfileirar(`ir para ${para.nome}`, () => { iniciarMissao(null, para, false); return missao?.enviosSair > 0; });
        alvo = destino;
        status.huntNote = `saindo ${eu.noCentro ? 'do Centro' : 'para uma hunt'}: indo para ${destino.nome}`;
        acoes.push({
          nivel: 'info',
          msg: `${prefixo}${eu.noCentro ? 'sair do Centro e ' : ''}ir para ${destino.nome} (${num(destino.xpTreinadorH)} XP/h, golpe ${pct(destino.hitPct)}, ${num(pocoesH(destino))} poções/h)`,
        });
      } else {
        status.huntNote = `fora de hunt: tenta ir para ${destino.nome} de novo em instantes`;
      }
    } else if (h.enabled && eu.huntSlug && atual && !ocupada && !eu.noCentro && !missao) {
      const insegura = !segura(atual);
      // Maior XP/h segura sempre ganha; empatada (atual na faixa de EMPATE_XP), só troca por golpe menor.
      const atualEmpata = !insegura && naFaixa(atual);
      const ganhoOk = melhor && melhor.slug !== atual.slug && (atualEmpata
        ? melhor.hitPct < atual.hitPct
        : melhor.xpTreinadorH > atual.xpTreinadorH);
      const ficouOBastante = agora - mem.ultimaTroca >= h.minStayMin * MIN;
      // Insegura: sai logo (só respeita 2 min entre trocas, para não martelar o servidor).
      const trocar = melhor && melhor.slug !== atual.slug && (
        (insegura && agora - mem.ultimaTroca >= 2 * MIN) ||
        (podeAvaliar && ganhoOk && ficouOBastante)
      );
      if (podeAvaliar || insegura) mem.ultimaAvaliacao = agora;
      if (trocar) {
        const motivo = insegura
          ? `hunt atual arriscada (golpe tira ${pct(atual.hitPct)} do HP)`
          : atualEmpata
            ? `mesmo XP/h (diferença menor que ${pct(EMPATE_XP)}) com golpe menor: ${pct(atual.hitPct)} → ${pct(melhor.hitPct)}`
            : `+${Math.round((melhor.xpTreinadorH / Math.max(1, atual.xpTreinadorH) - 1) * 100)}% de XP/h do treinador`;
        // Troca = voltar ao Centro (quando a trava de combate liberar) e escolher a hunt nova.
        if (!simul) {
          const de = { slug: atual.slug, nome: atual.nome };
          const para = { slug: melhor.slug, nome: melhor.nome };
          enfileirar(`trocar para ${para.nome}`, () => { iniciarMissao(de, para, h.viaCenter); return missao?.enviosSair > 0; });
        }
        mem.ultimaTroca = agora;
        alvo = melhor;
        acoes.push({
          nivel: 'info',
          msg: `${prefixo}${h.viaCenter ? 'voltar ao Centro e ' : ''}trocar de ${atual.nome} para ${melhor.nome} (${motivo}; ${num(melhor.xpTreinadorH)} XP/h, golpe ${pct(melhor.hitPct)}, ${num(pocoesH(melhor))} poções/h)`,
        });
        status.huntNote = `trocando para ${melhor.nome}`;
      } else if (!melhor) {
        status.huntNote = 'nenhuma hunt segura para este pokémon';
      } else if (melhor.slug === atual.slug) {
        const quaseIgual = porXp[0] && porXp[0].slug !== atual.slug ? porXp[0] : null;
        status.huntNote = quaseIgual
          ? `já está na melhor hunt: ${quaseIgual.nome} rende praticamente igual (+${((quaseIgual.xpTreinadorH / Math.max(1, atual.xpTreinadorH) - 1) * 100).toFixed(1)}%) com golpe maior (${pct(quaseIgual.hitPct)})`
          : 'já está na hunt segura de maior XP/h';
      } else if (atualEmpata && !ganhoOk) {
        status.huntNote = `já está numa hunt de XP/h praticamente igual ao de ${melhor.nome}, com golpe menor ou igual`;
      } else if (!ficouOBastante) {
        status.huntNote = `troca para ${melhor.nome} em ${Math.ceil((h.minStayMin * MIN - (agora - mem.ultimaTroca)) / MIN)} min (tempo mínimo na hunt)`;
      } else {
        status.huntNote = `troca para ${melhor.nome} na próxima avaliação`;
      }
    } else if (h.enabled) {
      if (!melhor && podeAvaliar) {
        mem.ultimaAvaliacao = agora;
        avisar('sem-hunt', `nenhuma hunt liberada passa no limite de risco para ${status.pokemon}`);
      }
      // Por que não está avaliando: aparece no painel da conta.
      status.huntNote =
        eu.safari?.dentro ? 'no Safari: não troca de hunt'
        : ocupada ? 'em outra atividade (boss, místico ou casa): não troca de hunt'
        : !atual ? `a hunt atual (${eu.huntSlug}) não aparece no ranking do /hunt: não troca`
        : missao ? `trocando para ${missao.para.nome}: ${missao.fase === 'sair' ? (missao.viaCentro ? 'esperando a trava de combate para ir ao Centro' : 'esperando a trava de combate') : 'no Centro, indo para a hunt'}`
        : '';
    }

    // ---- 4) poções: lista da automação do jogo + estoque ----
    const pc = cfg.potions;
    // Gasto: o maior entre a estimativa do /hunt e o medido (só vale para a hunt atual).
    const estimado = alvo ? hpH(alvo) : 0;
    const medido = alvo && alvo === atual ? gastoMedido(agora) : null;
    const usaMedido = medido != null && medido > estimado;
    const hpHora = usaMedido ? medido : estimado;
    // O estoque conta todas as poções que a conta tem, cada uma pelo HP útil que cura.
    const hpEmEstoque = emEstoque.reduce((s, x) => s + x.qtd * x.util, 0);
    const horas = hpHora > 0 ? hpEmEstoque / hpHora : Infinity;
    status.potion = {
      name: usando.nome, stock: usando.qtd, perHour: hpHora / usando.util, hours: horas, buy: ideal.nome,
      measured: medido != null ? medido / usando.util : undefined, estimated: estimado / usando.util,
    };

    mem.vigiaPocao = null;
    if (pc.enabled) {
      if (!automation.autoPotion) {
        avisar('autopotion', '"Usar Poções" está desligado na automação do jogo');
      }
      // "Usar Poções" do jogo = só a melhor poção que a conta tem para este pokémon (ex.: nada de
      // Small num pokémon de 17k). Muda quando troca o pokémon ou a hunt; quando a ativa acaba,
      // vigiarPocaoAtiva() marca a próxima na hora. Sem nenhuma em estoque, deixa como está (a compra
      // abaixo resolve e o próximo tick marca).
      const lista = emEstoque.length ? [usando.id] : [];
      const chaveLista = JSON.stringify(lista);
      mem.vigiaPocao = pc.manageList && !simul ? { ranking: emEstoque.map((x) => ({ id: x.id, nome: x.nome })) } : null;
      mem.reservaPedida = null;
      if (pc.manageList && lista.length && JSON.stringify(automation.potionIds ?? []) !== chaveLista && mem.ultimaListaPocao !== chaveLista) {
        if (!simul) enfileirar('marcar a poção', () => enviar({ t: 'auto.set', ...(eu.automation ?? automation), potionIds: lista }));
        mem.ultimaListaPocao = chaveLista;
        const outras = emEstoque.slice(1).map((x) => `${x.nome} ${x.custoHp.toFixed(2)}`).join(', ');
        const fracas = ignoradas.map((x) => x.nome).join(', ');
        acoes.push({
          nivel: 'info',
          msg: `${prefixo}deixar só ${usando.nome} em "Usar Poções" (${usando.custoHp.toFixed(2)} ouro por HP útil; HP máx ${num(hpMax)}, limiar ${pct(L)}${outras ? `; reserva: ${outras}` : ''}${fracas ? `; ignoradas (curam menos que um golpe de ${num(golpe)}): ${fracas}` : ''})`,
        });
      }

      // Compra quando o estoque (todas as poções) não dá para `refillBelowHours` horas; completa até
      // `stockHours` com a de menor preço por HP útil.
      // O motivo de comprar ou não fica no painel da conta (status.potionNote).
      const precisa = hpHora > 0 && horas < pc.refillBelowHours;
      const minutos = (t) => `${Math.max(1, Math.ceil((t - agora) / MIN))} min`;
      if (!precisa) {
        status.potionNote = hpHora > 0
          ? `estoque ok (compra quando durar menos de ${pc.refillBelowHours} h)`
          : 'sem consumo estimado nesta hunt: não compra';
      } else if (mem.compraPendente) {
        status.potionNote = `esperando o jogo confirmar a compra de ${ideal.nome}`;
      } else if (agora < mem.comprasPausadasAte) {
        status.potionNote = `compras pausadas por mais ${minutos(mem.comprasPausadasAte)} (a última não se confirmou)`;
      } else if (agora - mem.ultimaCompra < 5 * MIN) {
        status.potionNote = `próxima compra em ${minutos(mem.ultimaCompra + 5 * MIN)} (5 min entre compras)`;
      } else {
        let qty = Math.ceil((hpHora * pc.stockHours - hpEmEstoque) / ideal.util);
        const ouro = Number(eu.gold ?? 0);
        // Trava: uma compra nunca passa de `maxGoldPct` do ouro da conta.
        const maxQty = Math.floor((ouro * pc.maxGoldPct / 100) / ideal.preco);
        if (qty > maxQty) {
          if (maxQty > 0) avisar('teto-ouro', `compra de ${ideal.nome} limitada a ${num(maxQty)} (teto de ${pc.maxGoldPct}% do ouro)`);
          qty = maxQty;
        }
        if (qty > 0) {
          if (!simul) enfileirar(`comprar ${ideal.nome}`, () => enviar({ t: 'shop.buy', kind: 'item', id: ideal.id, qty }));
          mem.ultimaCompra = agora;
          mem.compraPendente = { id: ideal.id, antes: ideal.qtd, em: agora };
          status.potionNote = `${simul ? '[simulação] ' : ''}comprando ${num(qty)} ${ideal.nome}`;
          acoes.push({
            nivel: 'info',
            msg: `${prefixo}comprar ${num(qty)} ${ideal.nome} por ${num(qty * ideal.preco)} de ouro (estoque de poções dura ~${horas.toFixed(1)} h; gasta ~${num(hpHora / ideal.util)}/h dela${usaMedido ? `, medido — o /hunt estimava ${num(estimado / ideal.util)}/h` : ''})`,
          });
        } else {
          // Sem ouro nem para 1 dentro do teto: não compra, mas avisa (senão parece que travou).
          status.potionNote = `sem ouro: ${pc.maxGoldPct}% de ${num(ouro)} não paga 1 ${ideal.nome} (${num(ideal.preco)})`;
          avisar('sem-ouro', `precisa de ${ideal.nome} (estoque dura ~${horas.toFixed(1)} h), mas ${pc.maxGoldPct}% do ouro (${num(ouro)}) não paga nem 1 (${num(ideal.preco)} cada)`);
        }
      }
    }

    const partes = [];
    if (atual) partes.push(`${atual.nome}: ${num(atual.xpTreinadorH)} XP/h`);
    partes.push(`${usando.nome} ×${num(usando.qtd)}`);
    return fim('ok', partes.join(' · '));
  }

  window.__deckAuto = {
    versao: '0.3.0',
    /** Desligaram a automação: cancela a troca em andamento (não manda mais nada). */
    parar() {
      if (missao) registrar('warn', `troca para ${missao.para.nome} cancelada (automação desligada)`);
      pararMissao();
      fila.length = 0; // ações ainda não enviadas não saem mais
      mem.vigiaPocao = null;
      return pendentes.splice(0);
    },
    /** O que a missão de troca fez desde a última consulta (o Deck consulta a cada poucos segundos). */
    drenar() {
      return { acoes: pendentes.splice(0), trocando: missao ? missao.para.nome : null };
    },
    async tick(cfg) {
      try {
        return await tick(cfg);
      } catch (err) {
        return { status: { state: 'erro', message: String(err?.message ?? err), checkedAt: Date.now() }, acoes: [] };
      }
    },
  };
})();
