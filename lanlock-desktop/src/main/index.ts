import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { v4 as uuidv4 } from 'uuid'
import Store from 'electron-store'
import { startMonitor, stopMonitor, getSessionActive, getDetectedGame } from './processMonitor'

const execAsync = promisify(exec)

// Unpackaged builds default the app name to "Electron", which would put the
// store in %APPDATA%\Electron. Pin the name so dev and packaged builds share
// %APPDATA%\lanlock-desktop — otherwise the pcId would change after packaging.
app.setName('lanlock-desktop')

// ── Device identity ──────────────────────────────────────────────────────────
// The pcId is this machine's permanent identity: minted exactly once on first
// launch, then reused forever. Pairing records on the backend key off it, so
// it must survive reboots, app updates, and renderer reloads.
// Stored in %APPDATA%/lanlock-desktop/config.json.

interface StoreSchema {
  pcId: string
}

const store = new Store<StoreSchema>()

function resolvePcId(): string {
  const existing = store.get('pcId')
  if (existing) {
    console.log(`[LanLock] Loaded persisted pcId: ${existing}`)
    return existing
  }
  const fresh = uuidv4()
  store.set('pcId', fresh)
  console.log(`[LanLock] First launch — minted new pcId: ${fresh}`)
  return fresh
}

const pcId = resolvePcId()

// High-visibility startup banner so this machine's identity is impossible to
// miss in the terminal — it MUST match the pcId linked in the mobile app and
// the room the backend targets on lock.
console.log('========================================')
console.log('[LanLock] DESKTOP AGENT STARTING')
console.log('[LanLock] This device pcId:', pcId)
console.log('[LanLock] (must match the pcId shown in the mobile app / backend lock logs)')
console.log('========================================')

let mainWindow: BrowserWindow | null = null

// ── Locking ──────────────────────────────────────────────────────────────────

const GRACE_PERIOD_SECONDS = 60

// Non-null while a grace countdown is running. Deliberately never cleared by
// anything except its own firing — once started, the lock is inevitable.
let graceTimer: ReturnType<typeof setTimeout> | null = null

async function lockNow(): Promise<void> {
  await execAsync('rundll32.exe user32.dll,LockWorkStation')
  console.log('[LanLock] Workstation locked.')
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-pc-id', () => pcId)

ipcMain.handle('lock-workstation', async () => {
  // No game running — lock immediately, no ceremony.
  if (!getSessionActive()) {
    try {
      await lockNow()
      return { locked: true }
    } catch (err) {
      console.error('[LanLock] Lock command failed:', err)
      throw err
    }
  }

  // Game running — the lock still happens, just after a grace period.
  if (graceTimer !== null) {
    const reason = 'Grace period already in progress.'
    console.warn(`[LanLock] ${reason}`)
    return { locked: false, reason }
  }

  console.warn(
    `[LanLock] Game process active — locking in ${GRACE_PERIOD_SECONDS}s (grace period).`
  )
  mainWindow?.webContents.send('start-grace-period', GRACE_PERIOD_SECONDS)

  graceTimer = setTimeout(() => {
    graceTimer = null
    lockNow().catch((err) => {
      console.error('[LanLock] Grace-period lock failed:', err)
    })
  }, GRACE_PERIOD_SECONDS * 1_000)

  return {
    locked: false,
    reason: `Grace period started — locking in ${GRACE_PERIOD_SECONDS}s.`,
    gracePeriod: GRACE_PERIOD_SECONDS
  }
})

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  const win = new BrowserWindow({
    width: 520,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = win

  // Mirror renderer console output (socket telemetry etc.) into this
  // terminal so debugging doesn't require opening DevTools.
  win.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[Renderer] ${message}`)
  })

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  startMonitor()
  createWindow()

  // Push game-detection changes to the renderer (additive telemetry channel —
  // the renderer forwards it to the backend over its socket). Lock logic
  // continues to read getSessionActive() directly and is unaffected.
  let lastGame: string | null = null
  let lastActive = false
  setInterval(() => {
    const active = getSessionActive()
    const game = getDetectedGame()
    if (active !== lastActive || game !== lastGame) {
      lastActive = active
      lastGame = game
      mainWindow?.webContents.send('agent-game-status', { active, game })
    }
  }, 5_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  stopMonitor()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
