import { InvalidArgumentError } from "commander"

/**
 * Parse a `--flag` value that the API expects as a JSON object or array.
 *
 * Commander hands option values to us as raw strings, so an object/array body
 * field would otherwise reach the server as a string and fail validation
 * (e.g. `custom_fields: expected record, received string`). We JSON.parse it
 * here. An omitted flag stays `undefined`; malformed JSON throws a clear,
 * option-specific error for the root dispatcher to report.
 */
export function parseJsonField<T = unknown>(raw: string | undefined, flag: string): T | undefined {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new InvalidArgumentError(`Invalid JSON for --${flag}: ${raw}`)
  }
}
