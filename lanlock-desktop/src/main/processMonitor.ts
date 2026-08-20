import psList from 'ps-list'

// Extend as needed. All names compared lowercase. Value is the friendly name
// surfaced to the mobile app / dashboards.
const GAME_PROCESSES = new Map<string, string>([
  ['steam.exe', 'Steam'],
  ['epicgameslauncher.exe', 'Epic Games'],
  ['valorant.exe', 'VALORANT'],
  ['valorant-win64-shipping.exe', 'VALORANT'],
  ['riotclientservices.exe', 'Riot Client'],
  ['deadlock.exe', 'Deadlock'],
  ['cs2.exe', 'CS2'],
  ['csgo.exe', 'CS:GO']
])

let isSessionActive = false
let detectedGame: string | null = null
let intervalId: ReturnType<typeof setInterval> | null = null

async function pollProcesses(): Promise<void> {
  try {
    const processes = await psList()
    const running = new Set(processes.map((p) => p.name.toLowerCase()))
    let match: string | null = null
    for (const [proc, friendly] of GAME_PROCESSES) {
      if (running.has(proc)) {
        match = friendly
        break
      }
    }
    const detected = match !== null

    if (detected !== isSessionActive || match !== detectedGame) {
      isSessionActive = detected
      detectedGame = match
      console.log(
        `[ProcessMonitor] Session → ${
          isSessionActive ? `ACTIVE (${detectedGame})` : 'IDLE'
        }`
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

/** Friendly name of the currently detected game process, or null when idle. */
export function getDetectedGame(): string | null {
  return detectedGame
}
