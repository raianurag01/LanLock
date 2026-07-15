import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { v4 as uuidv4 } from 'uuid'
import Store from 'electron-store'

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

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-pc-id', () => pcId)

ipcMain.handle('lock-workstation', async () => {
  try {
    await execAsync('rundll32.exe user32.dll,LockWorkStation')
    console.log('[LanLock] Workstation locked.')
    return { locked: true }
  } catch (err) {
    console.error('[LanLock] Lock command failed:', err)
    throw err
  }
})

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
