# CLAUDE.md

Deck: navegador multiconta pessoal (inspirado no idleDeck) para jogar o **Pokeidle** (https://pokeidle.io/app) com várias contas ao mesmo tempo. Atenção: não confundir com o Poke Idle World (poke.idleworld.online), que é outro jogo. Uso só pessoal, Windows. O jogo permite até 4 contas por IP.

Responda e comente em português. O dono é dev front-end (Next.js/TS); prefere perguntas de esclarecimento antes de mudanças grandes.

## Stack e comandos

- Electron 45 (Chromium 156; atualizado do 33 em 2026-11) + electron-vite 2 + React 18 + TypeScript (strict), sem libs de UI nem de estado.
- `npm run dev`: desenvolvimento com hot reload. F12 abre o DevTools da interface (só sem empacotar).
- `npm run typecheck`: `tsc --noEmit`. Rode sempre depois de mudar código.
- `npm run build`: gera `out/`.
- `npm run dist`: `.exe` portátil via electron-builder.

## Arquitetura

```
src/main/
  index.ts          janela principal, IPC, liga tudo
  accounts.ts       AccountManager: uma WebContentsView por conta, layout, ações, fila de reload, watchdog
  updateWatcher.ts  detecta nova versão do jogo e recarrega as contas em fila
  extensions.ts     baixa extensões da addons.mozilla.org (config.extensions), confere sha256, carrega em cada sessão
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

## Status

- Feito e testado (Xvfb, jogo de teste local): grade com 3 contas, isolamento, persistência entre execuções, reload em fila ao detectar atualização.
- Ainda não validado no jogo real: frase exata da tela de desconexão e se a detecção por assets funciona no Pokeidle (o rodapé mostra a versão, ex. `v1.420.0`; a detecção por assets já registrou versão sozinha).

## Próximos passos

1. Calibrar `disconnectPatterns` e a detecção de versão no jogo real.
2. Fase 2: automação do market (comprar item quando estiver acabando). Caminho sugerido: script por conta via `webContents.executeJavaScript` ou um preload dedicado às views do jogo, com regras configuráveis na UI (item, quantidade mínima, quanto comprar). Antes, confirmar nas regras do jogo se automação externa é permitida.
3. Ideias vistas no idleDeck: atalho para votar/bônus diário, links de lives (Twitch/Kick), botão "Otimizar" para liberar memória.
