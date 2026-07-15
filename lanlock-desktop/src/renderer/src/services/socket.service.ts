import { io, Socket } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'rejected'

type StatusListener = (status: ConnectionStatus) => void

class SocketService {
  private socket: Socket | null = null
  private pcId = ''
  private statusListener: StatusListener | null = null

  /**
   * Call once after the pcId has been fetched from the main process.
   * Idempotent — safe against React StrictMode double-invocation.
   */
  connect(pcId: string, onStatus?: StatusListener): void {
    if (this.socket) return

    this.pcId = pcId
    this.statusListener = onStatus ?? null
    this.emitStatus('connecting')

    this.socket = io(SERVER_URL, {
      auth: { pcId: this.pcId },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
      transports: ['websocket']
    })

    this.socket
      .on('connect', this.onConnect)
      .on('disconnect', this.onDisconnect)
      .on('connect_error', this.onConnectError)
      .on('authenticated', this.onAuthenticated)
      .on('auth-error', this.onAuthError)
      .on('lock-device', this.onLockDevice)
      .on('unlock-device', this.onUnlockDevice)
  }

  dispose(): void {
    this.socket?.off()
    this.socket?.disconnect()
    this.socket = null
    this.statusListener = null
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private emitStatus(status: ConnectionStatus): void {
    this.statusListener?.(status)
  }

  private readonly onConnect = (): void => {
    console.log('[LanLock] Socket connected')
  }

  private readonly onDisconnect = (reason: string): void => {
    console.warn(`[LanLock] Disconnected — ${reason}`)
    this.emitStatus('disconnected')
    // Socket.io's built-in reconnection re-sends the auth object on every
    // handshake, so re-authentication after a drop is automatic.
  }

  private readonly onConnectError = (err: Error): void => {
    console.error(`[LanLock] Connection error — ${err.message}`)
    this.emitStatus('disconnected')
  }

  private readonly onAuthenticated = (data: { pcId: string }): void => {
    console.log(`[LanLock] Authenticated — device=${data.pcId}`)
    this.emitStatus('connected')
  }

  private readonly onAuthError = (data: { reason: string }): void => {
    console.error(`[LanLock] Auth rejected — ${data.reason}`)
    this.emitStatus('rejected')
    // Permanent rejection (device not paired yet) — stop retrying until the
    // user pairs via the mobile app and restarts.
    this.socket?.disconnect()
  }

  private readonly onLockDevice = (payload: Record<string, unknown>): void => {
    console.log('[LanLock] LOCK command received', payload)
    void window.lanlock
      .lockWorkstation()
      .then((result) => {
        if (result.locked) {
          console.log('[LanLock] Workstation locked successfully.')
        } else {
          console.warn(`[LanLock] ${result.reason}`)
        }
      })
      .catch((err) => {
        console.error('[LanLock] Failed to lock workstation:', err)
      })
  }

  private readonly onUnlockDevice = (payload: Record<string, unknown>): void => {
    // OS-level unlock is not scriptable on Windows — the user must enter
    // their PIN/password at the lock screen. Log receipt only.
    console.log('[LanLock] UNLOCK command received', payload)
  }
}

export const socketService = new SocketService()
