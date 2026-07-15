import { contextBridge, ipcRenderer } from 'electron'

// Narrow, explicit API surface — the renderer can only do what is listed here.
export interface LockResult {
  locked: boolean
  reason?: string
}

const api = {
  getPcId: (): Promise<string> => ipcRenderer.invoke('get-pc-id'),
  lockWorkstation: (): Promise<LockResult> => ipcRenderer.invoke('lock-workstation')
}

contextBridge.exposeInMainWorld('lanlock', api)

export type LanLockApi = typeof api
