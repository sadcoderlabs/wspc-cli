import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { validateDrivePath } from "./path-policy.js"
import { DRIVE_DIR } from "./state.js"

const IGNORE_FILE = "ignore"

export class DriveIgnoreError extends Error {
  readonly code = "INVALID_DRIVE_IGNORE"
  readonly retryable = false

  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = "DriveIgnoreError"
  }
}

export interface DriveExcludeRules {
  readonly size: number
  matches(path: string): boolean
}

const emptyDriveExcludeRules: DriveExcludeRules = {
  size: 0,
  matches: () => false,
}

export async function loadDriveExcludeRules(root: string): Promise<DriveExcludeRules> {
  const path = join(root, DRIVE_DIR, IGNORE_FILE)
  try {
    return parseDriveExcludeRules(await readFile(path, "utf8"), path)
  } catch (error) {
    if (isNotFoundError(error)) return emptyDriveExcludeRules
    throw error
  }
}

export function parseDriveExcludeRules(content: string, source = `${DRIVE_DIR}/${IGNORE_FILE}`): DriveExcludeRules {
  const exactPaths = new Set<string>()
  const directoryPaths = new Set<string>()
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const rule = line.trim()
    if (rule === "" || rule.startsWith("#")) continue
    const directory = rule.endsWith("/")
    let path: string
    try {
      path = validateDrivePath(directory ? rule.slice(0, -1) : rule)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new DriveIgnoreError(`${source}:${index + 1}: ${message}`, error)
    }
    const paths = directory ? directoryPaths : exactPaths
    paths.add(path)
  }
  return {
    size: exactPaths.size + directoryPaths.size,
    matches(path) {
      if (exactPaths.has(path)) return true
      for (const directory of directoryPaths) {
        if (path === directory || path.startsWith(`${directory}/`)) return true
      }
      return false
    },
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}
