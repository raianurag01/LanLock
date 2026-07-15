import psList from 'ps-list'

// Extend as needed. All names compared lowercase.
const GAME_PROCESSES = new Set([
  'steam.exe',
  'epicgameslauncher.exe',
  'valorant.exe',
  'valorant-win64-shipping.exe',
  'riotclientservices.exe',
  'deadlock.exe',
  'cs2.exe',
  'csgo.exe'
])

let isSessionActive = false
let intervalId: ReturnType<typeof setInterval> | null = null

async function pollProcesses(): Promise<void> {
  try {
    const processes = await psList()
    const running = new Set(processes.map((p) => p.name.toLowerCase()))
    const detected = [...GAME_PROCESSES].some((g) => running.has(g))

    if (detected !== isSessionActive) {
      isSessionActive = detected
      console.log(
        `[ProcessMonitor] Session → ${isSessionActive ? 'ACTIVE (game detected)' : 'IDLE'}`
      )
    }
  } catch (err) {
    // Keep the previous state on failure — a transient ps-list error must not
    // silently unblock a lock while a game is running.
    console.error('[ProcessMonitor] Poll failed, retaining prior state:', err)
  }
}

export function startMonitor(intervalMs = 5_000): void {
  if (intervalId !== null) return

  // Poll immediately so state is correct before the first lock attempt.
  void pollProcesses()
  intervalId = setInterval(() => void pollProcesses(), intervalMs)

  console.log(`[ProcessMonitor] Started — polling every ${intervalMs / 1_000}s`)
}

export function stopMonitor(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
    console.log('[ProcessMonitor] Stopped')
  }
}

export function getSessionActive(): boolean {
  return isSessionActive
}
