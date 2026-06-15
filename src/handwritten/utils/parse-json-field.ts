/**
 * Parse a `--flag` value that the API expects as a JSON object or array.
 *
 * Commander hands option values to us as raw strings, so an object/array body
 * field would otherwise reach the server as a string and fail validation
 * (e.g. `custom_fields: expected record, received string`). We JSON.parse it
 * here. An omitted flag stays `undefined`; malformed JSON exits with a clear
 * message instead of an uncaught SyntaxError stack trace.
 */
export function parseJsonField<T = unknown>(raw: string | undefined, flag: string): T | undefined {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    process.stderr.write(`Invalid JSON for --${flag}: ${raw}\n`)
    process.exit(1)
  }
}
