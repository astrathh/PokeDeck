import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AccountAction, AppConfig, Rect } from '../shared/types'
import { ConfigStore } from './store'
import { Logger } from './logger'
import { AccountManager, partitionFor } from './accounts'
import { UpdateWatcher } from './updateWatcher'
import { startMetrics } from './metrics'
import { ExtensionManager } from './extensions'
import { AutoPilot } from './autoPilot'

// Pasta de dados alternativa (testes, ou um segundo Deck separado). Precisa vir antes da trava,
// que é por pasta de dados.
if (process.env['DECK_USER_DATA']) app.setPath('userData', process.env['DECK_USER_DATA'])

// app.quit() é assíncrono: sem o exit, a segunda instância ainda chegaria no whenReady
// e abriria as mesmas partições/config.json da primeira.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: 'Deck',
    backgroundColor: '#0d0f14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // F12 abre o DevTools da interface do Deck (só em desenvolvimento)
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(() => {
  // Sem menu: evita Ctrl+R/zoom acidentais na interface (o zoom quebraria o encaixe das views).
  Menu.setApplicationMenu(null)

  const store = new ConfigStore()
  const log = new Logger()
  log.toFiles(join(app.getPath('userData'), 'logs'), (id) => store.get().accounts.find((a) => a.id === id)?.name ?? id)
  const win = createWindow()
  mainWindow = win

  const extensions = new ExtensionManager(store, log)
  extensions.start()
  const manager = new AccountManager(win, store, log, extensions)
  const updates = new UpdateWatcher(store, log, manager)
  const autoPilot = new AutoPilot(store, log, manager, () => extensions.autoVersion())
  // auto.js mudou com o Deck aberto (desenvolvimento): recarrega as contas, uma a uma, com a versão nova.
  extensions.onBuiltinsChanged = (v) => manager.reloadAll(`automação atualizada (${v})`)

  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
  const publishConfig = (c: AppConfig): AppConfig => {
    send('config', c)
    return c
  }

  log.on('entry', (e) => send('log', e))
  manager.on('runtime', (r) => send('runtime', r))
  manager.on('focused', (id) => send('account:focused', id))
  const stopMetrics = startMetrics(manager, (s) => send('metrics', s))

  ipcMain.handle('config:get', () => store.get())

  ipcMain.handle('config:update', (_e, patch: Partial<AppConfig>) => {
    const prev = store.get()
    const next = store.update(patch)
    manager.onConfigChanged(prev, next)
    if (prev.updateWatch !== next.updateWatch || prev.gameUrl !== next.gameUrl) updates.restart()
    if (JSON.stringify(prev.extensions) !== JSON.stringify(next.extensions)) void extensions.refresh()
    if (JSON.stringify(prev.auto) !== JSON.stringify(next.auto)) {
      if (prev.auto.enabled && !next.auto.enabled) log.info(null, 'Automação desligada')
      autoPilot.restart()
    }
    return publishConfig(next)
  })

  ipcMain.handle('account:add', (_e, name?: string) => {
    const c = store.get()
    const acc = {
      id: randomUUID().slice(0, 8),
      name: name?.trim() || `Conta ${c.accounts.length + 1}`,
      // Só a primeira conta começa com som, senão vira barulheira.
      muted: c.accounts.length > 0,
      enabled: true
    }
    const next = store.update({ accounts: [...c.accounts, acc] })
    manager.sync()
    log.info(acc.id, `Conta adicionada: ${acc.name}`)
    return publishConfig(next)
  })

  ipcMain.handle('account:remove', async (_e, id: string) => {
    const c = store.get()
    const name = c.accounts.find((a) => a.id === id)?.name ?? id
    const next = store.update({ accounts: c.accounts.filter((a) => a.id !== id) })
    manager.sync()
    await session
      .fromPartition(partitionFor(id))
      .clearStorageData()
      .catch(() => undefined)
    log.info(null, `Conta removida: ${name}`)
    return publishConfig(next)
  })

  ipcMain.handle('account:action', (_e, id: string, action: AccountAction) => manager.action(id, action))
  ipcMain.handle('accounts:reloadAll', () => manager.reloadAll('recarregamento manual'))
  ipcMain.handle('update:check', () => updates.check(true))
  ipcMain.handle('runtime:get', () => manager.runtime())
  ipcMain.handle('logs:get', () => log.all())
  ipcMain.on('layout:bounds', (_e, rects: Record<string, Rect | null>) => manager.setBounds(rects))
  ipcMain.on('layout:overlay', (_e, open: boolean) => manager.setOverlay(open))

  manager.sync()
  manager.restartWatchdog()
  updates.restart()
  autoPilot.restart()
  log.info(null, 'Deck iniciado')

  win.on('closed', () => {
    stopMetrics()
    updates.stop()
    autoPilot.stop()
    extensions.stop()
    manager.dispose()
    store.flush()
    log.flush()
    mainWindow = null
    app.quit()
  })
})

app.on('window-all-closed', () => app.quit())
