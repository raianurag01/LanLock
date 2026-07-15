import { contextBridge, ipcRenderer } from 'electron'

// Narrow, explicit API surface — the renderer can only do what is listed here.
const api = {
  getPcId: (): Promise<string> => ipcRenderer.invoke('get-pc-id'),
  lockWorkstation: (): Promise<{ locked: boolean }> =>
    ipcRenderer.invoke('lock-workstation')
}

contextBridge.exposeInMainWorld('lanlock', api)

export type LanLockApi = typeof api
