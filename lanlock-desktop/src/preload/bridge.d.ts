import type { LanLockApi } from './index'

declare global {
  interface Window {
    lanlock: LanLockApi
  }
}

export {}
