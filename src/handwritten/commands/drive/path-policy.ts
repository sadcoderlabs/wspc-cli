import { isAbsolute, relative, resolve, sep } from "node:path"

const UTF8_SEGMENT_LIMIT = 255
const UTF8_PATH_LIMIT = 1024
const CONTROL_CHARS = /[\0-\x1f\x7f]/
const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/
const UNC_PREFIX = /^\\\\/
const ABSOLUTE_POSIX_DOUBLE_SLASH = /^\/\//

export class DrivePathError extends Error {
  readonly code = "INVALID_DRIVE_PATH"
  readonly retryable = false

  constructor(message: string) {
    super(message)
    this.name = "DrivePathError"
  }
}

export function validateDrivePath(drivePath: string): string {
  if (drivePath.length === 0) {
    throw new DrivePathError("invalid drive path: empty")
  }

  if (isAbsolute(drivePath) || ABSOLUTE_POSIX_DOUBLE_SLASH.test(drivePath)) {
    throw new DrivePathError(`invalid drive path: ${drivePath}`)
  }

  if (drivePath.includes("\\")) {
    throw new DrivePathError("invalid drive path: backslash")
  }

  if (WINDOWS_DRIVE_PREFIX.test(drivePath) || UNC_PREFIX.test(drivePath)) {
    throw new DrivePathError(`invalid drive path: ${drivePath}`)
  }

  if (CONTROL_CHARS.test(drivePath)) {
    throw new DrivePathError("invalid drive path: control character")
  }

  if (Buffer.byteLength(drivePath, "utf8") > UTF8_PATH_LIMIT) {
    throw new DrivePathError(`invalid drive path: exceeds ${UTF8_PATH_LIMIT} bytes`)
  }

  const segments = drivePath.split("/")
  if (segments.some((segment) => segment.length === 0)) {
    throw new DrivePathError("invalid drive path: empty segment")
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new DrivePathError("invalid drive path: relative segment")
  }

  if (segments.some((segment) => Buffer.byteLength(segment, "utf8") > UTF8_SEGMENT_LIMIT)) {
    throw new DrivePathError(`invalid drive path: segment exceeds ${UTF8_SEGMENT_LIMIT} bytes`)
  }

  return drivePath
}

export function resolveInsideRoot(root: string, drivePath: string): string {
  const normalizedPath = validateDrivePath(drivePath)
  const absoluteRoot = resolve(root)
  const absolutePath = resolve(absoluteRoot, normalizedPath)
  const relativePath = relative(absoluteRoot, absolutePath)
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new DrivePathError(`drive path escapes root: ${drivePath}`)
  }
  return absolutePath
}
