import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearToken,
  getEvents,
  getOrders,
  getSummary,
  getToken,
  getVenuePcs,
  getVenues,
  lockDevice,
  login,
  LURK_VENUE_ID,
  RATE_PER_HOUR,
  releasePc,
  setOrderStatus,
} from './api.js';

const POLL_MS = 5_000;
// Anchor for revenue already banked today before the dashboard opened (mock);
// live session accrual is added on top from real Session rows.
const REVENUE_BASE_TODAY = 2340;
// Mock rate for the idle-compute (distributed computing) widget.
const IDLE_COMPUTE_RATE = 4.2; // ₹ per idle rig per hour

// ── Login ─────────────────────────────────────────────────────────────────────

function Login({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">LanLock</div>
        <div className="login-sub">Command Center</div>
        {error && <div className="login-error">{error}</div>}
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

// MAINTENANCE doubles as the turnover ("needs cleaning") state — see
// releasePc in the backend. Displayed as TURNOVER everywhere.
const STATUS_META = {
  ONLINE: { className: 'online', label: 'AVAILABLE' },
  IN_USE: { className: 'in-use', label: 'IN SESSION' },
  MAINTENANCE: { className: 'maintenance', label: 'TURNOVER' },
  OFFLINE: { className: 'offline', label: 'OFFLINE' },
};

const EVENT_META = {
  LOCKED: { icon: '🔒', bg: 'rgba(250,204,21,0.15)', label: 'PC Locked — session ended' },
  CONNECTED: { icon: '🟢', bg: 'rgba(34,197,94,0.12)', label: 'Desktop agent connected' },
  DISCONNECTED: { icon: '⚪', bg: 'rgba(107,114,128,0.15)', label: 'Desktop agent disconnected' },
  AUTH_REJECTED: { icon: '⛔', bg: 'rgba(239,68,68,0.12)', label: 'Unauthorized connection blocked' },
  PAIRED: { icon: '🔗', bg: 'rgba(96,165,250,0.12)', label: 'Device paired' },
  UNLOCKED: { icon: '🔓', bg: 'rgba(34,197,94,0.12)', label: 'PC unlocked' },
  FAILED_SCAN: { icon: '⚠️', bg: 'rgba(239,68,68,0.12)', label: 'Failed pairing scan' },
};

const truncateId = (pcId) =>
  pcId.length <= 14 ? pcId : `${pcId.slice(0, 8)}…${pcId.slice(-4)}`;

const relativeTime = (iso) => {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

const sessionElapsedMs = (pc) =>
  pc.sessionStartedAt ? Date.now() - new Date(pc.sessionStartedAt).getTime() : 0;

const formatElapsed = (ms) => {
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

const accruedRupees = (ms) => (ms / 3_600_000) * RATE_PER_HOUR;

// ── Stats row ─────────────────────────────────────────────────────────────────

function StatsRow({ pcs, fnbToday = 0 }) {
  const total = pcs.length;
  const available = pcs.filter((p) => p.status === 'ONLINE').length;
  const inUse = pcs.filter((p) => p.status === 'IN_USE').length;
  const availability = total ? Math.round((available / total) * 100) : 0;

  const liveAccrued = pcs.reduce(
    (sum, pc) => sum + (pc.sessionStartedAt ? accruedRupees(sessionElapsedMs(pc)) : 0),
    0,
  );
  const gamingToday = REVENUE_BASE_TODAY + liveAccrued;
  const revenueToday = gamingToday + fnbToday;
  const gamingShare = revenueToday > 0 ? (gamingToday / revenueToday) * 100 : 100;

  return (
    <div className="stats-row">
      <div className="stat-tile">
        <div className="stat-label">System Availability</div>
        <div className={`stat-value ${availability > 30 ? 'green' : 'yellow'}`}>
          {availability}%
        </div>
        <div className="stat-sub">
          {available}/{total} stations open
        </div>
      </div>
      <div className="stat-tile">
        <div className="stat-label">Active Stations</div>
        <div className="stat-value yellow">{inUse}</div>
        <div className="stat-sub">₹{Math.round(inUse * RATE_PER_HOUR)}/hr run-rate</div>
      </div>
      <div className="stat-tile">
        <div className="stat-label">Today's Revenue</div>
        <div className="stat-value">
          ₹{revenueToday.toFixed(0)}
        </div>
        <div className="ledger-bar" title="Gaming vs F&B revenue split">
          <span className="ledger-gaming" style={{ width: `${gamingShare}%` }} />
          <span className="ledger-fnb" style={{ width: `${100 - gamingShare}%` }} />
        </div>
        <div className="stat-sub">
          Gaming ₹{gamingToday.toFixed(0)} · F&amp;B ₹{fnbToday}
        </div>
      </div>
      <div className="stat-tile">
        <div className="stat-label">Avg Session Length</div>
        <div className="stat-value">1h 24m</div>
        <div className="stat-sub">trailing 7 days*</div>
      </div>
    </div>
  );
}

// ── Occupancy rhythm strip ────────────────────────────────────────────────────

// Typical-day occupancy % by hour, shaped like real café traffic: dead
// overnight, adults mid-morning, after-school surge, 6 PM–midnight peak.
const RHYTHM = [
  22, 14, 8, 4, 3, 5, 9, 14, 20, 26, 32, 38,
  42, 45, 52, 64, 72, 78, 87, 92, 95, 90, 74, 48,
];

function RhythmStrip() {
  const [hover, setHover] = useState(null);
  const nowHour = new Date().getHours();
  const peakHour = RHYTHM.indexOf(Math.max(...RHYTHM));

  return (
    <div className="panel rhythm-panel">
      <div className="panel-title">Occupancy rhythm — typical day</div>
      <div className="rhythm-strip">
        {RHYTHM.map((v, h) => (
          <div
            key={h}
            className="rhythm-col"
            onMouseEnter={() => setHover(h)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className={`rhythm-bar ${h === nowHour ? 'now' : ''}`}
              style={{ height: `${v}%` }}
            />
            {h === peakHour && <div className="rhythm-peak">{v}%</div>}
            {hover === h && (
              <div className="rhythm-tip">
                {String(h).padStart(2, '0')}:00 · {v}%
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="rhythm-axis">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}

// ── Floor map ─────────────────────────────────────────────────────────────────

function Desk({ pc, selected, onSelect }) {
  const meta = STATUS_META[pc.status] ?? STATUS_META.OFFLINE;
  const number = pc.name.split('-').pop();
  const elapsed = pc.sessionStartedAt ? sessionElapsedMs(pc) : null;
  return (
    <button
      className={`desk ${meta.className} ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(pc)}
      title={`${pc.name} — ${meta.label}`}
    >
      <span className="desk-num">{number}</span>
      {elapsed !== null ? (
        <span className="desk-meter">
          {formatElapsed(elapsed)}
          <em>₹{accruedRupees(elapsed).toFixed(0)}</em>
        </span>
      ) : (
        <span className="desk-state">{meta.label}</span>
      )}
    </button>
  );
}

function FloorMap({ pcs, venueName, selectedId, onSelect }) {
  // Spatial layout: banks of five desks facing the aisle, counter and
  // entrance at the bottom — reads like the actual room, not a list.
  // Chunking by 5 generalizes to any venue size (15 → 3 rows, 20 → 4 …).
  const rows = [];
  for (let i = 0; i < pcs.length; i += 5) rows.push(pcs.slice(i, i + 5));
  const rowName = (i) => String.fromCharCode(65 + i);

  return (
    <div className="panel">
      <div className="panel-title">
        Floor — {venueName} · {pcs.length} stations
      </div>
      <div className="floor">
        {rows.map((row, i) => (
          <div className="floor-row" key={rowName(i)}>
            <span className="row-label">ROW {rowName(i)}</span>
            <div className="row-desks">
              {row.map((pc) => (
                <Desk
                  key={pc.id}
                  pc={pc}
                  selected={pc.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="floor-bottom">
          <div className="counter">COUNTER</div>
          <div className="entrance">ENTRANCE ▸</div>
        </div>
      </div>
      <div className="legend">
        <span><i style={{ background: '#22c55e' }} /> Available</span>
        <span><i style={{ background: '#facc15' }} /> In Session</span>
        <span><i style={{ background: '#6b7280' }} /> Turnover</span>
        <span><i style={{ background: '#ef4444' }} /> Offline</span>
      </div>
    </div>
  );
}

// ── Station side panel ────────────────────────────────────────────────────────

function StationPanel({ pc, onClose, onReleased }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const meta = STATUS_META[pc.status] ?? STATUS_META.OFFLINE;
  const elapsed = pc.sessionStartedAt ? sessionElapsedMs(pc) : null;

  const release = async () => {
    setBusy(true);
    setError(null);
    try {
      await releasePc(pc.id);
      onReleased(pc);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel station-panel">
      <div className="station-head">
        <div>
          <div className="station-name">{pc.name}</div>
          <span className={`pc-status ${meta.className}`}>{meta.label}</span>
        </div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>
      {pc.specs && <div className="station-specs">{pc.specs}</div>}
      {elapsed !== null && (
        <div className="station-session">
          <div>
            <span className="session-label">Elapsed</span>
            <span className="session-value">{formatElapsed(elapsed)}</span>
          </div>
          <div>
            <span className="session-label">Accrued</span>
            <span className="session-value">₹{accruedRupees(elapsed).toFixed(2)}</span>
          </div>
        </div>
      )}
      {error && <div className="login-error">{error}</div>}
      {pc.status === 'IN_USE' && (
        <button className="action-btn" onClick={release} disabled={busy}>
          {busy ? 'Releasing…' : 'End Session & Release'}
        </button>
      )}
      {pc.status === 'MAINTENANCE' && (
        <button className="action-btn ghost" onClick={release} disabled={busy}>
          {busy ? 'Updating…' : '🧹 Mark Clean'}
        </button>
      )}
    </div>
  );
}

// ── Alerts strip ──────────────────────────────────────────────────────────────

function AlertsStrip({ pcs, events }) {
  const alerts = [];
  pcs
    .filter((p) => p.status === 'MAINTENANCE')
    .forEach((p) => alerts.push({ level: 'warn', text: `${p.name} in maintenance` }));
  pcs
    .filter((p) => p.sessionStartedAt && sessionElapsedMs(p) > 4 * 3_600_000)
    .forEach((p) =>
      alerts.push({
        level: 'warn',
        text: `${p.name} session past 4h — check on guest`,
      }),
    );
  const rejected = events.filter((e) => e.type === 'AUTH_REJECTED').length;
  if (rejected > 0) {
    alerts.push({ level: 'critical', text: `${rejected} blocked connection${rejected > 1 ? 's' : ''}` });
  }

  return (
    <div className="alerts">
      {alerts.length === 0 ? (
        <span className="alert-chip ok">✓ All systems normal</span>
      ) : (
        alerts.map((a, i) => (
          <span key={i} className={`alert-chip ${a.level}`}>
            {a.level === 'critical' ? '⛔' : '⚠️'} {a.text}
          </span>
        ))
      )}
    </div>
  );
}

// ── Activity feed ─────────────────────────────────────────────────────────────

function ActivityFeed({ events, flashId }) {
  return (
    <div className="panel">
      <div className="panel-title">Live Activity — audit trail</div>
      <div className="feed">
        {events.length === 0 && (
          <div className="feed-empty">
            No events yet — lock a PC from the mobile app to see the trail.
          </div>
        )}
        {events.map((ev) => {
          const meta = EVENT_META[ev.type] ?? {
            icon: '•',
            bg: 'rgba(255,255,255,0.06)',
            label: ev.type,
          };
          return (
            <div
              key={ev.id}
              className={[
                'feed-row',
                ev.type === 'LOCKED' ? 'locked' : '',
                ev.id === flashId ? 'flash' : '',
              ].join(' ')}
            >
              <div className="feed-icon" style={{ background: meta.bg }}>
                {meta.icon}
              </div>
              <div className="feed-body">
                <div className="feed-title">{meta.label}</div>
                <div className="feed-meta">{truncateId(ev.pcId)}</div>
              </div>
              <div className="feed-time">{relativeTime(ev.createdAt)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── All-Stores strip (multi-venue HQ) ─────────────────────────────────────────

function AllStoresStrip({ venues, activeVenueId, onSwitch }) {
  return (
    <div className="stores-strip">
      {venues.map((v) => {
        const pct = v.pcTotal ? Math.round((v.pcAvailable / v.pcTotal) * 100) : 0;
        return (
          <button
            key={v.id}
            className={`store-card ${v.id === activeVenueId ? 'active' : ''}`}
            onClick={() => onSwitch(v.id)}
          >
            <span className="store-name">{v.name}</span>
            <span className="store-occ">
              {v.pcAvailable}/{v.pcTotal} open
            </span>
            <span className="store-bar">
              <span style={{ width: `${pct}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Idle-compute earnings (mock, BETA-labeled) ────────────────────────────────

const IDLE_RIGS_PREVIEW = [
  { name: 'GPU cluster A', util: 62 },
  { name: 'GPU cluster B', util: 48 },
  { name: 'GPU cluster C', util: 71 },
];

function IdleComputePanel({ pcs, clock }) {
  const idle = pcs.filter((p) => p.status === 'ONLINE').length;
  const ratePerHour = idle * IDLE_COMPUTE_RATE;
  // Mock cumulative: scales with seconds elapsed today at the current rate.
  const secondsToday =
    clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds();
  const earnedToday = (secondsToday / 3600) * ratePerHour * 0.6;

  return (
    <div className="panel">
      <div className="panel-title">
        Idle Compute — passive earnings <span className="beta-tag">BETA</span>
      </div>
      <div className="idle-head">
        <div>
          <div className="idle-rate">₹{ratePerHour.toFixed(1)}/hr</div>
          <div className="idle-sub">{idle} idle rigs monetized</div>
        </div>
        <div className="idle-earned">
          <span>today</span>₹{earnedToday.toFixed(2)}
        </div>
      </div>
      {IDLE_RIGS_PREVIEW.map((rig) => (
        <div key={rig.name} className="idle-row">
          <span className="idle-name">{rig.name}</span>
          <span className="idle-bar">
            <span style={{ width: `${rig.util}%` }} />
          </span>
          <span className="idle-util">{rig.util}%</span>
        </div>
      ))}
      <div className="idle-foot">Distributed compute on idle GPUs · auto-pauses on booking</div>
    </div>
  );
}

// ── F&B kitchen queue (REAL — orders placed from gaming seats) ────────────────

const ORDER_META = {
  PLACED: { icon: '🍜', bg: 'rgba(250,204,21,0.15)', action: 'Start', next: 'PREPARING' },
  PREPARING: { icon: '🔥', bg: 'rgba(250,204,21,0.25)', action: 'Deliver', next: 'DELIVERED' },
  DELIVERED: { icon: '✅', bg: 'rgba(34,197,94,0.12)', action: null, next: null },
};

function FnbQueue({ orders, fnbToday, onAdvance }) {
  const [busyId, setBusyId] = useState(null);

  const advance = async (order, next) => {
    setBusyId(order.id);
    try {
      await onAdvance(order.id, next);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="panel">
      <div className="panel-title">
        Kitchen Display <span className="beta-tag" style={{ color: '#22c55e', borderColor: 'rgba(34,197,94,0.4)' }}>LIVE</span>
      </div>
      <div className="feed">
        {orders.length === 0 && (
          <div className="feed-empty">
            No orders yet — order from a gaming seat (desktop client → 🍜 Order Food).
          </div>
        )}
        {orders.map((o) => {
          const meta = ORDER_META[o.status] ?? ORDER_META.PLACED;
          return (
            <div key={o.id} className="feed-row">
              <div className="feed-icon" style={{ background: meta.bg }}>
                {meta.icon}
              </div>
              <div className="feed-body">
                <div className="feed-title">
                  {o.qty > 1 ? `${o.qty}× ` : ''}
                  {o.item} · ₹{o.amount}
                </div>
                <div className="feed-meta">{truncateId(o.pcId)}</div>
              </div>
              {meta.action ? (
                <button
                  className="kds-btn"
                  disabled={busyId === o.id}
                  onClick={() => advance(o, meta.next)}
                >
                  {busyId === o.id ? '…' : meta.action}
                </button>
              ) : (
                <div className="feed-time">{relativeTime(o.createdAt)}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="idle-foot">F&amp;B today ₹{fnbToday} · ordered from the seat</div>
    </div>
  );
}

// ── LanCoins leaderboard (mock) ───────────────────────────────────────────────

const LEADERBOARD = [
  { rank: '🥇', tag: 'ShadowStrike_07', coins: 4820 },
  { rank: '🥈', tag: 'NoScopeNina', coins: 4110 },
  { rank: '🥉', tag: 'anurag_rai', coins: 3675 },
  { rank: '4', tag: 'PixelPredator', coins: 2940 },
  { rank: '5', tag: 'LagSpikeLarry', coins: 2255 },
];

function Leaderboard() {
  return (
    <div className="panel">
      <div className="panel-title">Top Players — LanCoins</div>
      {LEADERBOARD.map((p) => (
        <div key={p.tag} className="lb-row">
          <span className="lb-rank">{p.rank}</span>
          <span className="lb-tag">{p.tag}</span>
          <span className="lb-coins">⛁ {p.coins.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ── Paired demo PC control ────────────────────────────────────────────────────

function PairedDeviceControl({ summary, onLocked }) {
  const [busy, setBusy] = useState(false);
  const device = summary?.devices?.[0];
  if (!device) return null;

  const lock = async () => {
    setBusy(true);
    try {
      await lockDevice(device.pcId);
      onLocked();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="paired-chip">
      <span className={`paired-dot ${device.online ? 'on' : 'off'}`} />
      Demo PC {device.online ? 'online' : 'offline'}
      <button className="paired-lock" onClick={lock} disabled={busy}>
        {busy ? 'Locking…' : '🔒 Lock'}
      </button>
    </span>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ onLogout }) {
  const [pcs, setPcs] = useState([]);
  const [venues, setVenues] = useState([]);
  const [activeVenueId, setActiveVenueId] = useState(LURK_VENUE_ID);
  const [events, setEvents] = useState([]);
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const [clock, setClock] = useState(new Date());
  const [flashId, setFlashId] = useState(null);
  const lastTopEvent = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [venueRows, pcRows, eventRows, orderRows, summaryData] = await Promise.all([
        getVenues(),
        getVenuePcs(activeVenueId),
        getEvents(),
        getOrders().catch(() => []),
        getSummary().catch(() => null),
      ]);
      setVenues(venueRows);
      setPcs(pcRows);
      setEvents(eventRows);
      setOrders(orderRows);
      if (summaryData) setSummary(summaryData);
      setError(null);
      // Ping: highlight the newest feed row when it changes between polls.
      const topId = eventRows[0]?.id ?? null;
      if (topId && lastTopEvent.current && topId !== lastTopEvent.current) {
        setFlashId(topId);
        setTimeout(() => setFlashId(null), 4_000);
      }
      lastTopEvent.current = topId;
    } catch (err) {
      if (err.status === 401) {
        onLogout();
        return;
      }
      setError(err.message);
    }
  }, [onLogout, activeVenueId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // 1s clock: drives the header time AND re-renders the live session meters.
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeString = useMemo(
    () => clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    [clock],
  );

  const selectedPc = pcs.find((p) => p.id === selectedId) ?? null;
  const activeVenue = venues.find((v) => v.id === activeVenueId) ?? null;
  const activeVenueName = activeVenue?.name ?? '…';

  const today = new Date().toDateString();
  const fnbToday = orders
    .filter((o) => o.status === 'DELIVERED' && new Date(o.createdAt).toDateString() === today)
    .reduce((sum, o) => sum + o.amount, 0);

  const advanceOrder = async (orderId, status) => {
    try {
      await setOrderStatus(orderId, status);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const switchVenue = (venueId) => {
    setSelectedId(null);
    setActiveVenueId(venueId);
  };

  return (
    <div className="shell">
      <div className="topbar">
        <span className="logo">LanLock</span>
        <span className="venue">Command Center · {activeVenueName}</span>
        <span className="spacer" />
        <PairedDeviceControl summary={summary} onLocked={refresh} />
        <span className="clock">
          <span className="live-dot" />
          {timeString}
        </span>
        <button className="logout" onClick={onLogout}>
          Logout
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <AllStoresStrip
        venues={venues}
        activeVenueId={activeVenueId}
        onSwitch={switchVenue}
      />

      <AlertsStrip pcs={pcs} events={events} />

      <div className="layout">
        <div>
          <StatsRow pcs={pcs} fnbToday={fnbToday} />
          <RhythmStrip />
          <FloorMap
            pcs={pcs}
            venueName={activeVenueName}
            selectedId={selectedId}
            onSelect={(pc) => setSelectedId(pc.id)}
          />
        </div>
        <div className="right-col">
          {selectedPc && (
            <StationPanel
              pc={selectedPc}
              onClose={() => setSelectedId(null)}
              onReleased={() => {
                setSelectedId(null);
                refresh();
              }}
            />
          )}
          <IdleComputePanel pcs={pcs} clock={clock} />
          <FnbQueue orders={orders} fnbToday={fnbToday} onAdvance={advanceOrder} />
          <Leaderboard />
          <ActivityFeed events={events} flashId={flashId} />
        </div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));

  const logout = useCallback(() => {
    clearToken();
    setAuthed(false);
  }, []);

  return authed ? (
    <Dashboard onLogout={logout} />
  ) : (
    <Login onSuccess={() => setAuthed(true)} />
  );
}
