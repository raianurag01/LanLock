import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'

const ACTION_YELLOW = '#FACC15'

function App(): React.JSX.Element {
  // The pcId lives in the main process (persisted via electron-store) and is
  // fetched once over IPC — the renderer never generates its own identity, so
  // refreshes and reboots always show the same QR code.
  const [pcId, setPcId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.lanlock
      .getPcId()
      .then(setPcId)
      .catch(() => setError('Could not load device identity from main process.'))
  }, [])

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
                backgroundColor: '#22c55e',
                boxShadow: '0 0 8px #22c55e',
                flexShrink: 0,
                animation: 'pulse 2s ease-in-out infinite'
              }}
            />
            <span style={{ fontSize: '0.875rem', color: '#22c55e', fontWeight: 600 }}>
              Pairing Mode Active
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
