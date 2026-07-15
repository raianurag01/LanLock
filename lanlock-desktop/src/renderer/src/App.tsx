import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'
import { socketService, type ConnectionStatus } from './services/socket.service'

const ACTION_YELLOW = '#FACC15'

const STATUS_META: Record<ConnectionStatus, { label: string; color: string }> = {
  connecting: { label: 'Connecting…', color: ACTION_YELLOW },
  connected: { label: 'Pairing Mode Active', color: '#22c55e' },
  disconnected: { label: 'Server Offline — Retrying', color: '#f87171' },
  rejected: { label: 'Not Paired — Scan QR First', color: '#f87171' }
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

  useEffect(() => {
    window.lanlock
      .getPcId()
      .then(setPcId)
      .catch(() => setError('Could not load device identity from main process.'))
  }, [])

  useEffect(() => {
    if (!pcId) return undefined
    socketService.connect(pcId, setStatus)
    return () => socketService.dispose()
  }, [pcId])

  useEffect(() => {
    return window.lanlock.onGracePeriodStart((seconds) => {
      setGracePeriodLeft(seconds)
    })
  }, [])

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

      {pcId && (
        <>
          <div
            style={{
              backgroundColor: '#ffffff',
              padding: '1.25rem',
              borderRadius: '14px',
              boxShadow: `0 0 0 4px ${ACTION_YELLOW}, 0 20px 60px rgba(250, 204, 21, 0.15)`,
              marginBottom: '2rem'
            }}
          >
            <QRCode value={pcId} size={224} bgColor="#ffffff" fgColor="#000000" level="H" />
          </div>

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

          <p
            style={{
              fontSize: '0.75rem',
              color: '#8a8a8a',
              maxWidth: 300,
              textAlign: 'center',
              lineHeight: 1.6,
              margin: '0 0 1rem'
            }}
          >
            Scan with the LanLock mobile app to pair this device.
          </p>

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
      `}</style>
    </div>
  )
}

export default App
