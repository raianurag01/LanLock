import { io, Socket } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'rejected'

export interface DisplayMessagePayload {
  message: string
  from?: string
}

export interface OrderAckPayload {
  id: string
  item: string
  qty: number
  amount: number
}

type StatusListener = (status: ConnectionStatus) => void
type MessageListener = (payload: DisplayMessagePayload) => void
type OrderAckListener = (payload: OrderAckPayload) => void

class SocketService {
  private socket: Socket | null = null
  private pcId = ''
  private statusListener: StatusListener | null = null
  private messageListener: MessageListener | null = null
  private orderAckListener: OrderAckListener | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  /** Register the handler for operator messages pushed from the mobile app. */
  onDisplayMessage(listener: MessageListener | null): void {
    this.messageListener = listener
  }

  /** Forward game-detection telemetry to the backend (no-op when offline). */
  sendAgentStatus(payload: { gameActive: boolean; gameName: string | null }): void {
    this.socket?.emit('agent-status', payload)
  }

  /** Place an F&B order from this seat (backend persists + feeds the KDS). */
  sendOrder(payload: { item: string; qty: number; amount: number }): void {
    this.socket?.emit('place-order', payload)
  }

  /** Register the handler for order confirmations from the backend. */
  onOrderPlaced(listener: OrderAckListener | null): void {
    this.orderAckListener = listener
  }

  /**
   * Call once after the pcId has been fetched from the main process.
   * Idempotent — safe against React StrictMode double-invocation. venueId is
   * this build's café (App.tsx's VENUE_ID) — the backend stamps it onto the
   * device's socket session for order/session attribution.
   */
  connect(pcId: string, venueId?: string, onStatus?: StatusListener): void {
    if (this.socket) return

    this.pcId = pcId
    this.statusListener = onStatus ?? null
    this.emitStatus('connecting')

    // Connection telemetry: the URL we dial and the exact pcId we hand to the
    // backend handshake — compare 1:1 with the backend's [Handshake] logs.
    console.log('🔗 [DESKTOP DEBUG] Target Socket URL:', SERVER_URL)
    console.log('🔗 [DESKTOP DEBUG] Attempting handshake with pcId:', this.pcId)

    this.socket = io(SERVER_URL, {
      auth: { pcId: this.pcId, venueId },
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
      .on('display-message', this.onDisplayMessageEvent)
      .on('order-placed', this.onOrderPlacedEvent)
  }

  dispose(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.socket?.off()
    this.socket?.disconnect()
    this.socket = null
    this.statusListener = null
    this.messageListener = null
    this.orderAckListener = null
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private emitStatus(status: ConnectionStatus): void {
    this.statusListener?.(status)
  }

  private readonly onConnect = (): void => {
    console.log('✅ [DESKTOP DEBUG] Connection established successfully!')
    console.log('✅ [DESKTOP DEBUG] Socket ID:', this.socket?.id, '— pcId:', this.pcId)
  }

  private readonly onDisconnect = (reason: string): void => {
    console.log('⚠️ [DESKTOP DEBUG] Disconnected from server. Reason:', reason)
    this.emitStatus('disconnected')
    // Socket.io's built-in reconnection re-sends the auth object on every
    // handshake, so re-authentication after a drop is automatic.
  }

  private readonly onConnectError = (err: Error): void => {
    console.error('❌ [DESKTOP DEBUG] Connection failed:', err.message)
    this.emitStatus('disconnected')
  }

  private readonly onAuthenticated = (data: { pcId: string }): void => {
    // High-visibility confirmation that we are connected AND the backend has
    // joined us to our device room — i.e. we are now eligible to receive
    // lock-device. Compare this pcId against the backend's emit log.
    console.log('========================================')
    console.log('[LanLock] ✅ CONNECTED & JOINED ROOM')
    console.log('[LanLock] pcId:', data.pcId)
    console.log('[LanLock] Listening for lock-device...')
    console.log('========================================')
    this.emitStatus('connected')
  }

  private readonly onAuthError = (data: { reason: string }): void => {
    console.error(`[LanLock] Auth rejected — ${data.reason}`)
    this.emitStatus('rejected')
    this.socket?.disconnect()
    // Rejection usually means "not paired YET" — the user may be scanning the
    // QR at this very moment. Keep polling so we join the device room within
    // seconds of the pairing landing in the backend, without an app restart.
    this.scheduleReconnect(5_000)
  }

  /** Re-dial the server after a delay (single pending retry at a time). */
  private scheduleReconnect(delayMs: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      console.log('🔁 [DESKTOP DEBUG] Retrying connection…')
      this.socket?.connect()
    }, delayMs)
  }

  private readonly onLockDevice = (payload: Record<string, unknown>): void => {
    console.log('🔒 [SOCKET] Received lock-device event!', payload)
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
    // End of session: the backend releases the pairing on lock, so re-dial.
    // The fresh handshake will be rejected (unpaired again), dropping the UI
    // back to the pairing QR — ready for the next user to scan.
    this.socket?.disconnect()
    this.scheduleReconnect(1_000)
  }

  private readonly onUnlockDevice = (payload: Record<string, unknown>): void => {
    // OS-level unlock is not scriptable on Windows — the user must enter
    // their PIN/password at the lock screen. Log receipt only.
    console.log('[LanLock] UNLOCK command received', payload)
  }

  private readonly onDisplayMessageEvent = (payload: DisplayMessagePayload): void => {
    console.log('📩 [SOCKET] display-message received:', payload)
    this.messageListener?.(payload)
  }

  private readonly onOrderPlacedEvent = (payload: OrderAckPayload): void => {
    console.log('🍜 [SOCKET] order confirmed:', payload)
    this.orderAckListener?.(payload)
  }
}

export const socketService = new SocketService()
