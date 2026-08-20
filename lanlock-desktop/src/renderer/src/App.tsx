import { useEffect, useRef, useState } from 'react'
import QRCode from 'react-qr-code'
import {
  socketService,
  type ConnectionStatus,
  type DisplayMessagePayload
} from './services/socket.service'

const ACTION_YELLOW = '#FACC15'

// Which café this agent is installed at — stamped into the pairing QR and
// the socket handshake so the backend can attribute the session (billing +
// LanCoins eligibility) and the admin dashboard can scope by venue. Defaults
// to LURK, matching this build's pricing/branding above.
const VENUE_ID = import.meta.env.VITE_VENUE_ID ?? 'venue-lurk-noida-110'

// Billing constants — mirror the mobile app's demo economy.
const RATE_PER_HOUR = 100 // ₹
const BASE_COINS = 740
const COINS_PER_HOUR = 100

// How long an operator message stays on screen before auto-dismissing.
const MESSAGE_DISMISS_MS = 12_000

const sessionCost = (seconds: number): number => (seconds / 3600) * RATE_PER_HOUR
const sessionCoins = (seconds: number): number =>
  Math.floor((seconds * COINS_PER_HOUR) / 3600)

const formatSession = (seconds: number): string => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

// Mock launcher tiles (Geto-style "Game Hub") — demo dressing only.
const GAME_HUB = [
  { name: 'VALORANT', tag: 'READY', emoji: '🎯' },
  { name: 'CS2', tag: 'READY', emoji: '🔫' },
  { name: 'GTA VI', tag: 'PRE-LOAD', emoji: '🌴' },
  { name: 'Steam', tag: 'LIBRARY', emoji: '🎮' }
]

// Idle digital signage — rotates while the PC is unpaired, turning an idle
// screen into venue marketing (ggLeap-style). QR stays visible throughout.
const SIGNAGE_SLIDES = [
  '💰 ₹100/hr · 5 hrs ₹450 · 10 hrs ₹900 — LURK packages',
  '🌴 GTA VI — PRE-LOAD READY on all stations',
  '🏆 Friday Night Cup — LanCoins prizes every week'
]

// Daily quests (Arcade-lite). The first quest's progress is REAL (session
// clock); the rest are demo dressing.
const QUEST_PLAY_TARGET_SECONDS = 2 * 3600

// Placeholder VPA — swap for the venue's real UPI id when payments go live.
const UPI_TOPUP_URI = 'upi://pay?pa=lurk@demo&pn=LURK%20Gaming%20Cafe&am=100&cu=INR'

// Seat-side F&B menu. Matches the admin Kitchen Display; swap for LURK's
// real menu when provided. Amounts in ₹.
const FNB_MENU = [
  { item: 'Cheese Maggi', price: 60, emoji: '🍜' },
  { item: 'Cold Coffee', price: 80, emoji: '🥤' },
  { item: 'Veg Sandwich', price: 90, emoji: '🥪' },
  { item: 'Red Bull', price: 125, emoji: '⚡' },
  { item: 'Masala Fries', price: 70, emoji: '🍟' },
  { item: 'Iced Tea', price: 65, emoji: '🧋' }
]

const STATUS_META: Record<ConnectionStatus, { label: string; color: string }> = {
  connecting: { label: 'Connecting…', color: ACTION_YELLOW },
  connected: { label: 'Session Active', color: '#22c55e' },
  disconnected: { label: 'Server Offline — Retrying', color: '#f87171' },
  rejected: { label: 'Ready to Pair — Scan QR', color: ACTION_YELLOW }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

const formatDuration = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

function App(): React.JSX.Element {
  // The pcId lives in the main process (persisted via electron-store) and is
  // fetched once over IPC — the renderer never generates its own identity, so
  // refreshes and reboots always show the same QR code.
  const [pcId, setPcId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  // null = no grace period running; 0 = countdown finished, lock imminent.
  const [gracePeriodLeft, setGracePeriodLeft] = useState<number | null>(null)
  // Local display clock for the "SESSION ACTIVE" strip — starts the moment
  // this socket authenticates. Presentational only, no server round-trip.
  const [sessionSeconds, setSessionSeconds] = useState(0)
  // Mirror for snapshotting: lock-device disconnects the socket, which resets
  // sessionSeconds before the grace overlay renders — the receipt must read
  // the frozen value, never the live one.
  const sessionSecondsRef = useRef(0)
  sessionSecondsRef.current = sessionSeconds
  // Frozen session stats captured the moment the grace period starts.
  const [graceSummary, setGraceSummary] = useState<{ seconds: number; fnb: number } | null>(
    null
  )
  // Operator message pushed from the mobile app (null = no banner).
  const [incomingMessage, setIncomingMessage] = useState<DisplayMessagePayload | null>(null)
  // Game-detection telemetry from the main process's Auto-Guard monitor.
  const [gameStatus, setGameStatus] = useState<{ active: boolean; game: string | null }>({
    active: false,
    game: null
  })
  // Idle signage rotation index (unpaired screen).
  const [signageIndex, setSignageIndex] = useState(0)
  // Modals: game tile chooser ("Just Play") and UPI top-up.
  const [justPlayGame, setJustPlayGame] = useState<string | null>(null)
  const [justPlayBusy, setJustPlayBusy] = useState(false)
  const [showTopUp, setShowTopUp] = useState(false)
  // F&B ordering: menu modal, in-flight item, and this session's tab.
  const [showFoodMenu, setShowFoodMenu] = useState(false)
  const [orderingItem, setOrderingItem] = useState<string | null>(null)
  const [orderConfirmed, setOrderConfirmed] = useState<string | null>(null)
  const [sessionFnb, setSessionFnb] = useState(0) // ₹ ordered this session
  const [ordersPlaced, setOrdersPlaced] = useState(0)
  const sessionFnbRef = useRef(0)
  sessionFnbRef.current = sessionFnb

  useEffect(() => {
    window.lanlock
      .getPcId()
      .then(setPcId)
      .catch(() => setError('Could not load device identity from main process.'))
  }, [])

  useEffect(() => {
    if (!pcId) return undefined
    socketService.connect(pcId, VENUE_ID, setStatus)
    return () => socketService.dispose()
  }, [pcId])

  // Reset and (re)start the session clock whenever a fresh session begins.
  useEffect(() => {
    if (status !== 'connected') {
      setSessionSeconds(0)
      return undefined
    }
    const tick = setInterval(() => setSessionSeconds((s) => s + 1), 1_000)
    return () => clearInterval(tick)
  }, [status])

  useEffect(() => {
    return window.lanlock.onGracePeriodStart((seconds) => {
      // Snapshot the session stats BEFORE the socket teardown resets them.
      setGraceSummary({ seconds: sessionSecondsRef.current, fnb: sessionFnbRef.current })
      setGracePeriodLeft(seconds)
    })
  }, [])

  // Operator messages pushed from the mobile app → on-screen banner.
  useEffect(() => {
    socketService.onDisplayMessage(setIncomingMessage)
    return () => socketService.onDisplayMessage(null)
  }, [])

  useEffect(() => {
    if (!incomingMessage) return undefined
    const timer = setTimeout(() => setIncomingMessage(null), MESSAGE_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [incomingMessage])

  // Game telemetry: main process → here → backend (which serves it to the
  // mobile app's /devices/summary).
  useEffect(() => {
    return window.lanlock.onGameStatus(setGameStatus)
  }, [])

  useEffect(() => {
    if (status !== 'connected') return
    socketService.sendAgentStatus({
      gameActive: gameStatus.active,
      gameName: gameStatus.game
    })
  }, [status, gameStatus])

  // Idle signage rotation while unpaired.
  useEffect(() => {
    if (status === 'connected') return undefined
    const timer = setInterval(() => {
      setSignageIndex((i) => (i + 1) % SIGNAGE_SLIDES.length)
    }, 6_000)
    return () => clearInterval(timer)
  }, [status])

  // "Just Play" mock: brief license-leasing state, then close.
  useEffect(() => {
    if (!justPlayBusy) return undefined
    const timer = setTimeout(() => {
      setJustPlayBusy(false)
      setJustPlayGame(null)
    }, 1_500)
    return () => clearTimeout(timer)
  }, [justPlayBusy])

  // F&B order confirmations from the backend.
  useEffect(() => {
    socketService.onOrderPlaced((ack) => {
      setOrderingItem(null)
      setOrderConfirmed(`${ack.item} — on its way to your seat`)
      setSessionFnb((v) => v + ack.amount)
      setOrdersPlaced((n) => n + 1)
    })
    return () => socketService.onOrderPlaced(null)
  }, [])

  useEffect(() => {
    if (!orderConfirmed) return undefined
    const timer = setTimeout(() => setOrderConfirmed(null), 4_000)
    return () => clearTimeout(timer)
  }, [orderConfirmed])

  // The seat's F&B tab belongs to one session — reset when it ends.
  useEffect(() => {
    if (status !== 'connected') {
      setSessionFnb(0)
      setOrdersPlaced(0)
    }
  }, [status])

  const placeOrder = (item: string, price: number): void => {
    setOrderingItem(item)
    socketService.sendOrder({ item, qty: 1, amount: price })
    // Clear the busy state if no ack arrives (offline edge) so the menu
    // never wedges.
    setTimeout(() => setOrderingItem((cur) => (cur === item ? null : cur)), 4_000)
  }

  // Tick the visible countdown. The actual lock is driven by the main
  // process timer — this is display only, so drift or tampering here
  // changes nothing about when the lock fires.
  useEffect(() => {
    if (gracePeriodLeft === null || gracePeriodLeft <= 0) return undefined
    const tick = setTimeout(() => {
      setGracePeriodLeft((s) => (s === null ? null : s - 1))
    }, 1_000)
    return () => clearTimeout(tick)
  }, [gracePeriodLeft])

  // Once the countdown hits zero the main process locks the machine. Clear
  // the overlay shortly after so the pairing QR is what greets the next
  // person who unlocks the PC.
  useEffect(() => {
    if (gracePeriodLeft !== 0) return undefined
    const reset = setTimeout(() => {
      setGracePeriodLeft(null)
      setGraceSummary(null)
    }, 3_000)
    return () => clearTimeout(reset)
  }, [gracePeriodLeft])

  const statusMeta = STATUS_META[status]

  if (gracePeriodLeft !== null) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: '#7f1d1d',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#ffffff',
          textAlign: 'center',
          userSelect: 'none',
          zIndex: 9999,
          animation: gracePeriodLeft <= 10 ? 'urgentFlash 1s ease-in-out infinite' : undefined
        }}
      >
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>⚠️</div>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.02em', margin: 0 }}>
          SESSION EXPIRED
        </h1>
        <div
          style={{
            fontSize: '9rem',
            fontWeight: 900,
            lineHeight: 1.1,
            fontVariantNumeric: 'tabular-nums',
            margin: '0.5rem 0'
          }}
        >
          {gracePeriodLeft}
        </div>
        <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
          {gracePeriodLeft > 0 ? `LOCKING IN ${gracePeriodLeft} SECONDS` : 'LOCKING NOW'}
        </p>
        <p style={{ fontSize: '1.125rem', marginTop: '1.5rem', opacity: 0.9 }}>
          PLEASE SAVE YOUR GAME.
        </p>
        {graceSummary && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '1.5rem',
              backgroundColor: 'rgba(0,0,0,0.35)',
              borderRadius: '12px',
              padding: '0.9rem 1.75rem',
              marginTop: '1.75rem',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            <span style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.15em', opacity: 0.7 }}>
              SESSION RECEIPT
            </span>
            <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {formatSession(graceSummary.seconds)}
            </span>
            <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              ₹{sessionCost(graceSummary.seconds).toFixed(2)}
            </span>
            {graceSummary.fnb > 0 && (
              <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>
                + F&amp;B ₹{graceSummary.fnb}
              </span>
            )}
            <span style={{ fontSize: '1.05rem', fontWeight: 700, color: ACTION_YELLOW }}>
              +{sessionCoins(graceSummary.seconds)} LanCoins
            </span>
          </div>
        )}
        <style>{`
          @keyframes urgentFlash {
            0%, 100% { background-color: #7f1d1d; }
            50% { background-color: #b91c1c; }
          }
        `}</style>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#ffffff',
        userSelect: 'none'
      }}
    >
      {/* Operator message pushed from the mobile app */}
      {incomingMessage && (
        <div
          style={{
            position: 'fixed',
            top: '1.25rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            backgroundColor: '#27272a',
            border: `1px solid ${ACTION_YELLOW}`,
            borderRadius: '14px',
            padding: '0.9rem 1.25rem',
            maxWidth: '80vw',
            boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 20px rgba(250, 204, 21, 0.15)',
            zIndex: 100,
            animation: 'slideDown 0.35s ease-out'
          }}
        >
          <span style={{ fontSize: '1.5rem' }}>📩</span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: '0.6875rem',
                fontWeight: 800,
                letterSpacing: '0.1em',
                color: ACTION_YELLOW,
                textTransform: 'uppercase',
                marginBottom: '0.2rem'
              }}
            >
              Message from {incomingMessage.from ?? 'your operator'}
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 600, overflowWrap: 'break-word' }}>
              {incomingMessage.message}
            </div>
          </div>
          <button
            onClick={() => setIncomingMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#8a8a8a',
              fontSize: '1rem',
              cursor: 'pointer',
              padding: '0.25rem',
              flexShrink: 0
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* "Just Play" account chooser (mock license orchestration) */}
      {justPlayGame && (
        <div className="modal-backdrop" onClick={() => !justPlayBusy && setJustPlayGame(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            {justPlayBusy ? (
              <>
                <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚡</div>
                <div style={{ fontSize: '1rem', fontWeight: 800 }}>
                  Leasing venue license…
                </div>
                <div style={{ fontSize: '0.75rem', color: '#8a8a8a', marginTop: '0.4rem' }}>
                  Launching {justPlayGame} — credentials injected automatically
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: '0.35rem' }}>
                  Launch {justPlayGame}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#8a8a8a', marginBottom: '1.1rem' }}>
                  Choose how to sign in
                </div>
                <button className="modal-btn primary" onClick={() => setJustPlayBusy(true)}>
                  ⚡ Just Play — venue license
                </button>
                <button className="modal-btn" onClick={() => setJustPlayBusy(true)}>
                  Use your own account
                </button>
                <button className="modal-cancel" onClick={() => setJustPlayGame(null)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Seat-side F&B menu — real orders over the device socket */}
      {showFoodMenu && (
        <div className="modal-backdrop" onClick={() => setShowFoodMenu(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: '0.35rem' }}>
              🍜 Order to your seat
            </div>
            <div style={{ fontSize: '0.75rem', color: '#8a8a8a', marginBottom: '1rem' }}>
              Delivered to this station · added to your session tab
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {FNB_MENU.map((entry) => (
                <div
                  key={entry.item}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    backgroundColor: '#1f1f1f',
                    border: '1px solid #2a2a2a',
                    borderRadius: '10px',
                    padding: '0.55rem 0.75rem'
                  }}
                >
                  <span style={{ fontSize: '1.1rem' }}>{entry.emoji}</span>
                  <span style={{ flex: 1, textAlign: 'left', fontSize: '0.8125rem', fontWeight: 700 }}>
                    {entry.item}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#8a8a8a', fontVariantNumeric: 'tabular-nums' }}>
                    ₹{entry.price}
                  </span>
                  <button
                    onClick={() => placeOrder(entry.item, entry.price)}
                    disabled={orderingItem !== null}
                    style={{
                      backgroundColor: ACTION_YELLOW,
                      color: '#1a1a1a',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.3rem 0.8rem',
                      fontSize: '0.6875rem',
                      fontWeight: 800,
                      cursor: orderingItem ? 'default' : 'pointer',
                      opacity: orderingItem && orderingItem !== entry.item ? 0.5 : 1
                    }}
                  >
                    {orderingItem === entry.item ? '…' : 'Order'}
                  </button>
                </div>
              ))}
            </div>
            {orderConfirmed && (
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#22c55e', marginTop: '0.8rem' }}>
                ✅ {orderConfirmed}
              </div>
            )}
            <button className="modal-cancel" onClick={() => setShowFoodMenu(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* UPI top-up (mock — placeholder VPA) */}
      {showTopUp && (
        <div className="modal-backdrop" onClick={() => setShowTopUp(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: '0.35rem' }}>
              Extend Session
            </div>
            <div style={{ fontSize: '0.75rem', color: '#8a8a8a', marginBottom: '1rem' }}>
              Scan with any UPI app · ₹100 = 1 hour
            </div>
            <div
              style={{
                backgroundColor: '#ffffff',
                padding: '0.9rem',
                borderRadius: '12px',
                display: 'inline-block'
              }}
            >
              <QRCode value={UPI_TOPUP_URI} size={150} bgColor="#ffffff" fgColor="#000000" />
            </div>
            <div style={{ fontSize: '0.625rem', color: '#555555', marginTop: '0.75rem' }}>
              lurk@demo · GPay · PhonePe · Paytm
            </div>
            <button className="modal-cancel" onClick={() => setShowTopUp(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      <h1
        style={{
          color: ACTION_YELLOW,
          fontSize: '2rem',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          margin: 0
        }}
      >
        LanLock
      </h1>

      <p
        style={{
          color: '#8a8a8a',
          fontSize: '0.8125rem',
          margin: '0.25rem 0 2.5rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase'
        }}
      >
        Desktop Agent
      </p>

      {error && (
        <p style={{ color: '#f87171', fontSize: '0.875rem', maxWidth: 320, textAlign: 'center' }}>
          {error}
        </p>
      )}

      {!error && !pcId && (
        <p style={{ color: '#8a8a8a', fontSize: '0.875rem' }}>Loading device identity…</p>
      )}

      {/* Session active — the "door" is closed: hide the QR so nobody can
          re-pair a machine that is currently in use. */}
      {pcId && status === 'connected' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: '2rem'
          }}
        >
          <div style={{ fontSize: '4.5rem', marginBottom: '1rem' }}>🟢</div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, color: '#22c55e' }}>
            SESSION ACTIVE
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: '#8a8a8a',
              maxWidth: 300,
              textAlign: 'center',
              lineHeight: 1.6,
              margin: '0.75rem 0 0'
            }}
          >
            This PC is linked and in use. End the session from the LanLock
            mobile app to lock this PC.
          </p>

          {/* Session parity strip: same live-ticking clock language as the
              mobile app's hero timer, so phone + PC read as one synchronized
              platform on the demo table. Clock is local/presentational —
              it starts when this socket authenticates, not from a
              server-shared session-start timestamp. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              backgroundColor: '#1f1f1f',
              border: '1px solid #2a2a2a',
              borderRadius: '14px',
              padding: '1rem 1.5rem',
              marginTop: '1.5rem',
              minWidth: 260
            }}
          >
            <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
              {[
                {
                  label: 'Session Duration',
                  value: formatDuration(sessionSeconds),
                  color: ACTION_YELLOW
                },
                {
                  label: 'Session Cost',
                  value: `₹${sessionCost(sessionSeconds).toFixed(2)}`,
                  color: '#ffffff'
                },
                {
                  label: 'LanCoins',
                  value: `⛁ ${BASE_COINS + sessionCoins(sessionSeconds)}`,
                  color: '#22c55e'
                }
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                >
                  <span
                    style={{
                      fontSize: '0.625rem',
                      fontWeight: 700,
                      color: '#8a8a8a',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      marginBottom: '0.35rem'
                    }}
                  >
                    {stat.label}
                  </span>
                  <span
                    style={{
                      fontSize: '1.5rem',
                      fontWeight: 800,
                      color: stat.color,
                      fontVariantNumeric: 'tabular-nums',
                      letterSpacing: '0.02em'
                    }}
                  >
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: 'rgba(34, 197, 94, 0.12)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: '999px',
                padding: '0.3rem 0.8rem',
                marginTop: '0.85rem'
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"
                  fill="#22c55e"
                  fillOpacity={0.25}
                />
                <path
                  d="m8.5 12 2.5 2.5 4.5-5"
                  stroke="#22c55e"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#22c55e' }}>
                Protected by LanLock
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginTop: '0.85rem'
              }}
            >
              {gameStatus.active && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    backgroundColor: 'rgba(250, 204, 21, 0.1)',
                    border: '1px solid rgba(250, 204, 21, 0.35)',
                    borderRadius: '999px',
                    padding: '0.3rem 0.8rem',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: ACTION_YELLOW
                  }}
                >
                  🎮 Now playing: {gameStatus.game}
                </span>
              )}
              <button
                onClick={() => setShowTopUp(true)}
                style={{
                  backgroundColor: ACTION_YELLOW,
                  color: '#1a1a1a',
                  border: 'none',
                  borderRadius: '999px',
                  padding: '0.35rem 1rem',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                + Extend Session
              </button>
              <button
                onClick={() => setShowFoodMenu(true)}
                style={{
                  backgroundColor: 'transparent',
                  color: ACTION_YELLOW,
                  border: '1px solid rgba(250, 204, 21, 0.5)',
                  borderRadius: '999px',
                  padding: '0.35rem 1rem',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                🍜 Order Food{sessionFnb > 0 ? ` · ₹${sessionFnb}` : ''}
              </button>
            </div>

            {orderConfirmed && (
              <div
                style={{
                  marginTop: '0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#22c55e'
                }}
              >
                ✅ {orderConfirmed}
              </div>
            )}
          </div>

          {/* Mock launcher tiles — the PC-bang "Game Hub" look. */}
          <div style={{ width: '100%', maxWidth: 420, marginTop: '1.5rem' }}>
            <div
              style={{
                fontSize: '0.625rem',
                fontWeight: 800,
                letterSpacing: '0.15em',
                color: '#8a8a8a',
                marginBottom: '0.6rem',
                textAlign: 'left'
              }}
            >
              GAME HUB
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '0.6rem'
              }}
            >
              {GAME_HUB.map((game) => (
                <div
                  key={game.name}
                  className="game-tile"
                  onClick={() => setJustPlayGame(game.name)}
                  style={{
                    backgroundColor: '#1f1f1f',
                    border: '1px solid #2a2a2a',
                    borderRadius: '10px',
                    padding: '0.7rem 0.4rem',
                    textAlign: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '1.4rem', marginBottom: '0.3rem' }}>{game.emoji}</div>
                  <div style={{ fontSize: '0.6875rem', fontWeight: 800 }}>{game.name}</div>
                  <div
                    style={{
                      fontSize: '0.5rem',
                      fontWeight: 800,
                      letterSpacing: '0.1em',
                      color: game.tag === 'PRE-LOAD' ? ACTION_YELLOW : '#22c55e',
                      marginTop: '0.25rem'
                    }}
                  >
                    {game.tag}
                  </div>
                </div>
              ))}
            </div>

            {/* Arcade-lite daily quests. First bar is real (session clock). */}
            <div
              style={{
                fontSize: '0.625rem',
                fontWeight: 800,
                letterSpacing: '0.15em',
                color: '#8a8a8a',
                margin: '1.25rem 0 0.6rem',
                textAlign: 'left'
              }}
            >
              DAILY QUESTS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[
                {
                  label: 'Play 2 hours',
                  reward: '+50 ⛁',
                  progress: Math.min(sessionSeconds / QUEST_PLAY_TARGET_SECONDS, 1),
                  detail: `${formatSession(sessionSeconds)} / 2h`
                },
                {
                  label: 'Order from your seat',
                  reward: '+20 ⛁',
                  progress: ordersPlaced > 0 ? 1 : 0,
                  detail: `${Math.min(ordersPlaced, 1)} / 1`
                },
                {
                  label: 'Win 3 matches',
                  reward: '+100 ⛁',
                  progress: 1 / 3,
                  detail: '1 / 3'
                }
              ].map((quest) => (
                <div
                  key={quest.label}
                  style={{
                    backgroundColor: '#1f1f1f',
                    border: '1px solid #2a2a2a',
                    borderRadius: '10px',
                    padding: '0.6rem 0.8rem',
                    textAlign: 'left'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.4rem'
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                      {quest.progress >= 1 ? '✅ ' : ''}
                      {quest.label}
                    </span>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 800, color: ACTION_YELLOW }}>
                      {quest.reward}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        width: `${quest.progress * 100}%`,
                        height: '100%',
                        backgroundColor: quest.progress >= 1 ? '#22c55e' : ACTION_YELLOW,
                        borderRadius: 2
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '0.5625rem', color: '#8a8a8a', marginTop: '0.3rem' }}>
                    {quest.detail}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Idle digital signage: rotating venue promos while unpaired. */}
      {pcId && status !== 'connected' && (
        <div
          key={signageIndex}
          style={{
            backgroundColor: 'rgba(250, 204, 21, 0.08)',
            border: '1px solid rgba(250, 204, 21, 0.3)',
            borderRadius: '999px',
            padding: '0.55rem 1.5rem',
            marginBottom: '1.25rem',
            fontSize: '0.8125rem',
            fontWeight: 700,
            color: ACTION_YELLOW,
            letterSpacing: '0.02em',
            animation: 'signageFade 6s ease-in-out'
          }}
        >
          {SIGNAGE_SLIDES[signageIndex]}
        </div>
      )}

      {/* No active session — show the pairing QR (the entry door), framed by
          an onboarding card so a first-time viewer needs zero explanation. */}
      {pcId && status !== 'connected' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: '#1f1f1f',
            border: '1px solid #2a2a2a',
            borderRadius: '18px',
            padding: '1.75rem 2rem',
            marginBottom: '2rem'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1.25rem',
              marginBottom: '1.5rem'
            }}
          >
            {[
              { n: 1, label: 'Open Mobile App' },
              { n: 2, label: 'Scan QR' },
              { n: 3, label: 'Secure Your Session' }
            ].map((step, i, arr) => (
              <div key={step.n} style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      backgroundColor: ACTION_YELLOW,
                      color: '#1a1a1a',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {step.n}
                  </div>
                  <span
                    style={{
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      color: '#a1a1a1',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {step.label}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ width: 20, height: 1, backgroundColor: '#333333', marginBottom: '1.1rem' }} />
                )}
              </div>
            ))}
          </div>

          <div
            className="qr-pulse-ring"
            style={{
              backgroundColor: '#ffffff',
              padding: '1.25rem',
              borderRadius: '14px',
              boxShadow: `0 0 0 4px ${ACTION_YELLOW}, 0 20px 60px rgba(250, 204, 21, 0.15)`
            }}
          >
            <QRCode
              value={JSON.stringify({ action: 'LINK_PC', pcId, venueId: VENUE_ID })}
              size={224}
              bgColor="#ffffff"
              fgColor="#000000"
              level="H"
            />
          </div>
        </div>
      )}

      {pcId && (
        <>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: '#222222',
              border: '1px solid #333333',
              borderRadius: '999px',
              padding: '0.4rem 1.1rem',
              marginBottom: '1.75rem'
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: statusMeta.color,
                boxShadow: `0 0 8px ${statusMeta.color}`,
                flexShrink: 0,
                animation: 'pulse 2s ease-in-out infinite'
              }}
            />
            <span style={{ fontSize: '0.875rem', color: statusMeta.color, fontWeight: 600 }}>
              {statusMeta.label}
            </span>
          </div>

          {status !== 'connected' && (
            <>
              <p
                style={{
                  fontSize: '0.75rem',
                  color: '#8a8a8a',
                  maxWidth: 300,
                  textAlign: 'center',
                  lineHeight: 1.6,
                  margin: '0 0 0.75rem'
                }}
              >
                Scan with the LanLock mobile app to pair this device.
              </p>
              <p
                style={{
                  fontSize: '0.6875rem',
                  color: '#6b7280',
                  margin: '0 0 1rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                ⚡ Earning ₹4.2/hr while idle · distributed compute
                <span
                  style={{
                    fontSize: '0.5rem',
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    color: ACTION_YELLOW,
                    border: '1px solid rgba(250, 204, 21, 0.4)',
                    borderRadius: '4px',
                    padding: '0.1rem 0.3rem'
                  }}
                >
                  BETA
                </span>
              </p>
            </>
          )}

          <code
            style={{
              fontSize: '0.65rem',
              color: '#555555',
              letterSpacing: '0.04em',
              fontFamily: 'monospace'
            }}
          >
            {pcId}
          </code>
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes slideDown {
          from { transform: translate(-50%, -120%); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
        @keyframes signageFade {
          0% { opacity: 0; transform: translateY(-4px); }
          8%, 92% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0.6; }
        }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
        }
        .modal-card {
          background: #27272a;
          border: 1px solid ${ACTION_YELLOW};
          border-radius: 16px;
          padding: 1.75rem 2rem;
          text-align: center;
          max-width: 340px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
        }
        .modal-btn {
          display: block;
          width: 100%;
          background: none;
          border: 1px solid rgba(250, 204, 21, 0.5);
          color: ${ACTION_YELLOW};
          border-radius: 10px;
          font-size: 0.8125rem;
          font-weight: 700;
          padding: 0.7rem;
          margin-bottom: 0.6rem;
          cursor: pointer;
          font-family: inherit;
        }
        .modal-btn.primary {
          background: ${ACTION_YELLOW};
          color: #1a1a1a;
          border: none;
          font-weight: 800;
        }
        .modal-cancel {
          background: none;
          border: none;
          color: #8a8a8a;
          font-size: 0.75rem;
          cursor: pointer;
          margin-top: 0.4rem;
          font-family: inherit;
        }
        .game-tile { transition: border-color 0.15s ease, transform 0.15s ease; }
        .game-tile:hover {
          border-color: ${ACTION_YELLOW} !important;
          transform: translateY(-2px);
        }
        @keyframes qrPulse {
          0% { box-shadow: 0 0 0 4px ${ACTION_YELLOW}, 0 20px 60px rgba(250, 204, 21, 0.15), 0 0 0 4px rgba(250, 204, 21, 0.35); }
          70% { box-shadow: 0 0 0 4px ${ACTION_YELLOW}, 0 20px 60px rgba(250, 204, 21, 0.15), 0 0 0 14px rgba(250, 204, 21, 0); }
          100% { box-shadow: 0 0 0 4px ${ACTION_YELLOW}, 0 20px 60px rgba(250, 204, 21, 0.15), 0 0 0 4px rgba(250, 204, 21, 0); }
        }
        .qr-pulse-ring {
          animation: qrPulse 2.4s ease-out infinite;
        }
      `}</style>
    </div>
  )
}

export default App
