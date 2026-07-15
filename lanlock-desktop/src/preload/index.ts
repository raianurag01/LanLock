import { contextBridge, ipcRenderer } from 'electron'

export interface LockResult {
  locked: boolean
  reason?: string
  gracePeriod?: number
}

// Narrow, explicit API surface — the renderer can only do what is listed here.
const api = {
  getPcId: (): Promise<string> => ipcRenderer.invoke('get-pc-id'),
  lockWorkstation: (): Promise<LockResult> => ipcRenderer.invoke('lock-workstation'),

  /**
   * Subscribe to grace-period announcements from the main process.
   * Returns an unsubscribe function for effect cleanup.
   */
  onGracePeriodStart: (callback: (seconds: number) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, seconds: number): void => {
      callback(seconds)
    }
    ipcRenderer.on('start-grace-period', listener)
    return () => {
      ipcRenderer.removeListener('start-grace-period', listener)
    }
  }
}

contextBridge.exposeInMainWorld('lanlock', api)

export type LanLockApi = typeof api
