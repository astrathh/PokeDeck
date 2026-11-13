import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DeckApi, Unsubscribe } from '../shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): Unsubscribe {
  const handler = (_e: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: DeckApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  addAccount: (name) => ipcRenderer.invoke('account:add', name),
  removeAccount: (id) => ipcRenderer.invoke('account:remove', id),
  action: (id, action) => ipcRenderer.invoke('account:action', id, action),
  reloadAll: () => ipcRenderer.invoke('accounts:reloadAll'),
  checkUpdateNow: () => ipcRenderer.invoke('update:check'),
  getRuntime: () => ipcRenderer.invoke('runtime:get'),
  getLogs: () => ipcRenderer.invoke('logs:get'),
  setBounds: (rects) => ipcRenderer.send('layout:bounds', rects),
  setOverlay: (open) => ipcRenderer.send('layout:overlay', open),
  setSelected: (id) => ipcRenderer.send('layout:selected', id),
  onConfig: (cb) => subscribe('config', cb),
  onRuntime: (cb) => subscribe('runtime', cb),
  onMetrics: (cb) => subscribe('metrics', cb),
  onLog: (cb) => subscribe('log', cb),
  onFocused: (cb) => subscribe('account:focused', cb),
  getAppUpdate: () => ipcRenderer.invoke('appUpdate:get'),
  checkAppUpdate: () => ipcRenderer.invoke('appUpdate:check'),
  installAppUpdate: () => ipcRenderer.invoke('appUpdate:install'),
  onAppUpdate: (cb) => subscribe('appUpdate', cb)
}

contextBridge.exposeInMainWorld('deck', api)
