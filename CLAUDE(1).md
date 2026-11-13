# CLAUDE.md

Deck: navegador multiconta pessoal (inspirado no idleDeck) para jogar o **Pokeidle** (https://pokeidle.io/app) com várias contas ao mesmo tempo. Atenção: não confundir com o Poke Idle World (poke.idleworld.online), que é outro jogo. Uso só pessoal, Windows. O jogo permite até 4 contas por IP.

Responda e comente em português. O dono é dev front-end (Next.js/TS); prefere perguntas de esclarecimento antes de mudanças grandes.

## Stack e comandos

- Electron 45 (Chromium 156; atualizado do 33 em 2026-11) + electron-vite 2 + React 18 + TypeScript (strict), sem libs de UI nem de estado.
- `npm run dev`: desenvolvimento com hot reload. F12 abre o DevTools da interface (só sem empacotar).
- `npm run typecheck`: `tsc --noEmit`. Rode sempre depois de mudar código.
- `npm run test:auto`: testes da lógica de decisão da automação (`tests/deck-auto.test.mjs`, jogo falso). Rode ao mexer em `resources/deck-auto/auto.js`.
- `npm run build`: gera `out/`.
- `npm run dist`: `.exe` portátil via electron-builder.

## Arquitetura

```
src/main/
  index.ts          janela principal, IPC, liga tudo
  accounts.ts       AccountManager: uma WebContentsView por conta, layout, ações, fila de reload, watchdog
  updateWatcher.ts  detecta nova versão do jogo e recarrega as contas em fila
  extensions.ts     baixa extensões da addons.mozilla.org (config.extensions), confere sha256, carrega em cada sessão; carrega também as embutidas (resources/)
  autoPilot.ts      a cada 60s chama window.__deckAuto.tick(config.auto) em cada conta pronta; loga ações, guarda status
resources/deck-auto/  extensão embutida (MAIN world) com a lógica da automação; empacotada via build.extraResources
  metrics.ts        RAM/CPU por conta (app.getAppMetrics × PID da página), a cada 2s
  store.ts          config em %APPDATA%/deck-multiconta/config.json (DEFAULT_CONFIG aqui)
  logger.ts         log em memória (1000 entradas), emite 'entry'
src/preload/index.ts  expõe window.deck (contextBridge)
src/shared/types.ts   tipos e o contrato DeckApi (fonte da verdade do IPC)
src/renderer/src/     UI React (App, components/, format.ts, styles.css)
```

Canais de IPC: `config:*`, `account:*`, `accounts:reloadAll`, `update:check`, `runtime:get`, `logs:get` (handle); `layout:bounds`, `layout:overlay` (send); eventos `config`, `runtime`, `metrics`, `log`, `account:focused`.

Para adicionar um recurso ao IPC: tipo em `shared/types.ts` (DeckApi) → handler em `main/index.ts` → ponte em `preload/index.ts` → uso na UI.

## Decisões importantes (não desfazer sem motivo)

- **Isolamento:** cada conta usa a partição `persist:acc-<id>` (`partitionFor`). Remover uma conta apaga os dados dela (`clearStorageData`).
- **Views ficam por cima do HTML.** A UI só desenha slots vazios (`.slot-body`). `DeckGrid` mede os retângulos e manda via `setBounds`; o main posiciona as views. Consequências:
  - qualquer modal ou popup na UI precisa chamar `window.deck.setOverlay(true)` enquanto aberto, senão fica escondido atrás das contas;
  - o menu é removido (`Menu.setApplicationMenu(null)`) para não haver zoom na UI, porque zoom desalinha as views.
- **Economia:** `backgroundThrottling: false` mantém o jogo rodando com a view escondida. O modo econômico só deixa visível a conta selecionada.
- **Seleção por clique no jogo** usa `input-event` com `mouseDown`. Não use o evento `focus`: ele dispara no reload e fazia a seleção pular sozinha.
- **Destacar janela:** no `close` da janela destacada, remova a view antes de a janela ser destruída e devolva para a principal, senão a view morre junto.
- **User agent: NÃO alterar.** Antes o Deck tirava `Electron/x` do UA para parecer Chrome; isso deixava o UA contraditório com o resto do navegador e o Turnstile da Cloudflare (login do pokeidle.io) reprovava sempre. Com o UA original do Electron, passa.
- **Popups:** mesmo domínio do jogo ou provedores de login (Google, Discord etc.) abrem no app, na mesma sessão. O resto vai para o navegador padrão.

## Gerenciamento automático (accounts.ts)

- Crash → recarrega em 3s. Falha de rede → backoff 5/10/20…60s. Travada além de `unresponsiveGraceSec` → `forcefullyCrashRenderer` (o handler de crash recarrega).
- Watchdog (intervalo configurável): RAM acima de `memoryLimitMb` → reload; texto de `disconnectPatterns` encontrado no `innerText` da página → reload.
- Todo reload automático passa por `queueReload`: uma conta por vez, com `staggerSec` de intervalo e cooldown de 2 min por conta, para evitar loop. Recarregamentos usam `loadURL(gameUrl)` (volta ao início), não `reload()`.

## Detecção de atualização (updateWatcher.ts)

- Busca a URL do jogo (ou `versionUrl`) com a sessão da primeira conta, sem cache.
- Impressão digital: grupo 1 da `versionRegex`, ou, sem regex, a lista ordenada de `.js/.css` do HTML. Sem impressão digital, nunca recarrega (só avisa no log).
- Só recarrega depois de confirmar a mudança duas vezes, com 30s de intervalo.

## Extensões (extensions.ts)

- `config.extensions`: slugs ou links da addons.mozilla.org. Padrão: `hunt-for-pokeidle` (/hunt for PokeIdle, dev Liang: painel de melhores hunts por XP/h e ouro/h; só lê o WebSocket do jogo, não envia nada).
- Baixa pela API v5 da AMO, confere o `sha256` do arquivo, extrai (unzip próprio com zlib, com proteção contra caminho fora da pasta) em `userData/extensions/<slug>/<versão>/`. Procura atualização ao abrir e a cada 6h; apaga versões antigas.
- `AccountManager.create` espera `extensions.attach(ses)` antes do `loadURL`: content scripts com `run_at: document_start` precisam estar carregados antes da página abrir. Extensão nova ou atualizada só vale depois de recarregar a conta.
- O Electron só carrega extensão em sessão persistente (`persist:`), e só content scripts funcionam bem (sem popup do ícone, APIs `chrome.*` parciais). `world: MAIN` funciona no Electron 45.
- `DECK_USER_DATA=<pasta>` troca a pasta de dados (testes sem tocar na config real; a trava de instância única é por pasta).

## Automação (resources/deck-auto/auto.js + autoPilot.ts)

- Os termos do Pokeidle (pokeidle.io/terms, seção Automação) **permitem** automação que siga as regras de quem joga na mão: sem explorar falhas, sem burlar limite de contas/rede, sem sobrecarregar o servidor. Manter cadência baixa.
- O script só age dentro de `tick()`, chamado pelo main. Desligar = parar de chamar. Padrão: desligado e em simulação (`dryRun`), que só loga "[simulação] faria: …".
- Depende do /hunt: lê `welcome`/`estado` por `__pokeidleHunt.on` e usa `__pokeidleHunt.engine.analisar` (o mesmo cálculo do painel; o contexto é copiado de `contexto()` do ui.js dele). Se o /hunt mudar e quebrar, o tick devolve erro e para; não age às cegas.
- Ações = as mensagens dos botões do jogo (lidas no app.js do cliente): `shop.buy {kind:'item', id, qty}`, `hunt.select {slug}`, `auto.set {...automation, potionIds}`.
- Poção: menor `npcPrice / min(cura, (1 − hpLimiar) × hpMax)`. Cura = `healAmount` ou `healPct × hpMax`. Catálogo: `/assets/items.json` + `welcome.itensNossos` (o mesmo do Market; `itensCompraveis` é só preço de ovo). Consumo/h = `danoPorAbate × kph / cura útil`.
- Usa o que já tem antes de comprar: `potionIds` = **só** a melhor poção em estoque para o pokémon atual (troca ao mudar de pokémon/hunt). Quando ela zera, `vigiarPocaoAtiva()` (em cada `estado` do jogo) marca a próxima do ranking na hora, sem esperar o tick nem a fila. Estoque em horas = Σ qtd × cura útil / HP por hora; abaixo de 1h compra a ideal (menor preço por HP útil) até 2h.
- Hunt segura: liberada, não `umHit`, `hitPct < hpLimiar` (golpe maior que o HP no limiar mata antes da poção disparar) e `hitPct ≤ teto` (30% para nível do treinador ≤ 200). Escolhe maior `xpTreinadorH`. Troca para qualquer XP/h maior, com ≥ 15 min na hunt (oscilação da estimativa); hunt atual insegura troca já (mín. 2 min entre trocas). Nunca no Safari.
- **Troca de hunt = missão** (roda na página, passo de 1 s): espera a trava de combate (o jogo só deixa trocar depois de 3 s sem dar nem tomar golpe, ou com a onda encerrada) → `hunt.select` direto (como o mapa do jogo) → confere a chegada. Recusa: 7× direto → pelo Centro (até 10 `centro.ir`, depois 3 `hunt.select` de lá) → se nada der, `hunt.select` de volta para a hunt de origem. Opção `hunts.viaCenter` (padrão desligada): trava → `centro.ir` → no Centro, `hunt.select`. **Nunca** `centro.desistir` (perde XP). Golpes/mortes vêm das mensagens `{t:'batalha', ev}` do socket (o /hunt não repassa). Recusa repetida (3×) volta para a hunt de origem. Desistir após 5 min. Lógica da trava: `restaCombateHuntMs`/`huntSaidaLivreAgora` no app.js do cliente.
- **Sempre numa hunt:** no Centro (`eu.noCentro`) ou sem `huntSlug`, e fora de safari/boss/místico/casa, o tick abre uma missão com `de = null` para a melhor hunt segura (sem tempo mínimo; no máximo 1 tentativa por minuto). Se o jogo recusar 3× lá do Centro, a hunt entra em `mem.recusadas` por 10 min e o próximo tick tenta a próxima segura. Sem hunt segura, fica no Centro.
- **Memória persistente:** `mem` (campos em `PERSISTE`) vai para `localStorage['deckAuto.mem.v1']` ao fim de cada tick e quando uma hunt é recusada; `carregarMem()` no início. `mem.simul` também persiste, senão todo recarregamento disparava o reset de troca simulação↔real.
- **Seleção de contas:** `auto.excludedIds` (lista negativa: conta nova entra ligada). `AutoPilot.contents()` filtra tick e drenar; `restart()` limpa o status das excluídas.
- **Recarga da automação em dev:** `ExtensionManager.watchBuiltins()` observa `resources/deck-auto` (só sem `app.isPackaged`), debounce 3 s, compara hash; se mudou, `removeExtension`/`loadExtension` em cada sessão e `onBuiltinsChanged` → `manager.reloadAll`. `autoVersion()` = `versao` do auto.js + sha curto, vai em `AutoStatus.version`.
- **Eventos em arquivo:** `Logger.toFiles(userData/logs, nomeDaConta)`, buffer de 1 s, `flush()` síncrono ao fechar, apaga arquivos com mais de 14 dias.
- **Saída da hunt sem atraso:** a janela sem combate é curta (um golpe trava de novo por 3 s), então a saída (`hunt.select` direto ou `centro.ir`) é disparada por evento no instante em que a trava expira (último golpe + 3,1 s) ou quando um selvagem morre sem golpe depois (fim da onda; esses palpites não contam nas 7 recusas). Não passa pela fila nem pelo intervalo.
- **Ritmo:** as outras ações (lista de poções, compra, escolha de hunt já no Centro) saem de uma fila com 2–5 s entre uma e outra. O autoPilot chama `drenar()` a cada 3 s para os eventos da missão aparecerem logo, e `parar()` ao desligar (cancela missão e fila).
- Confere a compra no tick seguinte (estoque subiu?). Compra não confirmada pausa compras por 30 min.
- **Não validado com conta logada**: nomes de campos (`eu.items`, `eu.gold`, `automation.hpLimiar` 30 ou 0.3, `pk.maxHp`) saíram da leitura do cliente. Validar rodando em simulação primeiro.

## Status

- Feito e testado (Xvfb, jogo de teste local): grade com 3 contas, isolamento, persistência entre execuções, reload em fila ao detectar atualização.
- Ainda não validado no jogo real: frase exata da tela de desconexão e se a detecção por assets funciona no Pokeidle (o rodapé mostra a versão, ex. `v1.420.0`; a detecção por assets já registrou versão sozinha).

## Próximos passos

1. Calibrar `disconnectPatterns` e a detecção de versão no jogo real.
2. Validar a automação (poção + hunt) em simulação numa conta real e só depois desligar o modo simulação.
3. Ideias vistas no idleDeck: atalho para votar/bônus diário, links de lives (Twitch/Kick), botão "Otimizar" para liberar memória.
