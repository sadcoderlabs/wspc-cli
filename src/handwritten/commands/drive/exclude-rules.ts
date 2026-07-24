import { readFile } from "node:fs/promises"
import { join, posix as pathPosix } from "node:path"
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
  matches(path: string, kind?: "file" | "directory"): boolean
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
  const filePatterns = new Set<string>()
  const directoryPatterns = new Set<string>()
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
    const patterns = directory ? directoryPatterns : filePatterns
    patterns.add(path)
  }
  return {
    size: filePatterns.size + directoryPatterns.size,
    matches(path, kind = "file") {
      if (kind === "file" && [...filePatterns].some((pattern) => pathPosix.matchesGlob(path, pattern))) return true
      for (const pattern of directoryPatterns) {
        if (kind === "directory" && pathPosix.matchesGlob(path, pattern)) return true
        for (let ancestor = pathPosix.dirname(path); ancestor !== "."; ancestor = pathPosix.dirname(ancestor)) {
          if (pathPosix.matchesGlob(ancestor, pattern)) return true
        }
      }
      return false
    },
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}
