import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"
import { driveIsoTimestamp, systemDriveClock, type DriveClock } from "./clock.js"
import { DRIVE_DIR } from "./state.js"

export interface DriveDebugLogger {
  log(event: string, fields?: Record<string, unknown>): void
}

export const noopDriveDebugLogger: DriveDebugLogger = { log() {} }

export const DEBUG_LOG_FILE = "debug.log"
const MAX_DEBUG_LOG_BYTES = 10 * 1024 * 1024

export function createDriveDebugLogger(
  root: string,
  options: { clock?: DriveClock; maxBytes?: number } = {},
): DriveDebugLogger {
  const clock = options.clock ?? systemDriveClock
  const maxBytes = options.maxBytes ?? MAX_DEBUG_LOG_BYTES
  const dir = join(root, DRIVE_DIR)
  const file = join(dir, DEBUG_LOG_FILE)
  let warned = false
  return {
    log(event, fields = {}) {
      // Debug logging must never break sync; failures are swallowed after a
      // single stderr warning.
      try {
        mkdirSync(dir, { recursive: true })
        try {
          if (statSync(file).size > maxBytes) renameSync(file, `${file}.old`)
        } catch {
          // File missing or unreadable; append below decides the outcome.
        }
        appendFileSync(file, `${JSON.stringify({ ts: driveIsoTimestamp(clock), event, ...fields })}\n`)
      } catch (error) {
        if (!warned) {
          warned = true
          const message = error instanceof Error ? error.message : String(error)
          process.stderr.write(`wspc drive: debug log write failed: ${message}\n`)
        }
      }
    },
  }
}
