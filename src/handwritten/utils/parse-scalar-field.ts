import { InvalidArgumentError } from "commander"

function invalidValue(
  raw: string,
  flag: string,
  expected: string,
): InvalidArgumentError {
  return new InvalidArgumentError(
    `--${flag} must be ${expected}; received ${JSON.stringify(raw)}`,
  )
}

export function parseNumberField(raw: string, flag: string): number {
  const value = Number(raw)
  if (raw.trim() === "" || !Number.isFinite(value)) {
    throw invalidValue(raw, flag, "a finite number")
  }
  return value
}

export function parseIntegerField(raw: string, flag: string): number {
  const value = parseNumberField(raw, flag)
  if (!Number.isInteger(value)) {
    throw invalidValue(raw, flag, "an integer")
  }
  return value
}

export function parseBooleanField(raw: string, flag: string): boolean {
  if (raw === "true") return true
  if (raw === "false") return false
  throw invalidValue(raw, flag, '"true" or "false"')
}
