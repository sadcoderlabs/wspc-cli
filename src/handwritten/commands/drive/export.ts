import { Command } from "commander"
import { DateTime } from "luxon"
import { open, lstat, link, unlink } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { loadAuthedFetch, type AuthedFetch } from "../../auth/load-sdk-client.js"
import { render, renderObject, shouldOutputJson } from "../../output/render.js"

type Job = {
  id: string
  status: string
  created_at: number
  updated_at: number
  completed_at: number | null
  expires_at: number | null
  items_written: number
  items_total: number | null
  bytes_written: number
  error_code: string | null
}
type Envelope = { workspace_id: string; job: Job | null }
const incompatible = () =>
  new Error("Drive export requires a compatible server; update the server before retrying.")
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function envelope(value: unknown): Envelope {
  if (
    !record(value) ||
    typeof value.workspace_id !== "string" ||
    !/^org_[A-Za-z0-9]+$/.test(value.workspace_id)
  )
    throw incompatible()
  const job = value.job
  if (job !== null) {
    if (
      !record(job) ||
      typeof job.id !== "string" ||
      !/^exp_[A-Za-z0-9]+$/.test(job.id) ||
      typeof job.status !== "string" ||
      !["pending", "running", "completed", "failed", "expired"].includes(job.status) ||
      !["created_at", "updated_at", "items_written", "bytes_written"].every(
        (key) => Number.isSafeInteger(job[key]) && Number(job[key]) >= 0,
      ) ||
      !["completed_at", "expires_at", "items_total"].every(
        (key) => job[key] === null || (Number.isSafeInteger(job[key]) && Number(job[key]) >= 0),
      ) ||
      !(
        job.error_code === null ||
        (typeof job.error_code === "string" && /^[a-z_]+$/.test(job.error_code))
      )
    )
      throw incompatible()
  }
  if (job === null) return { workspace_id: value.workspace_id, job: null }
  const {
    id,
    status,
    created_at,
    updated_at,
    completed_at,
    expires_at,
    items_written,
    items_total,
    bytes_written,
    error_code,
  } = job as Job
  return {
    workspace_id: value.workspace_id,
    job: {
      id,
      status,
      created_at,
      updated_at,
      completed_at,
      expires_at,
      items_written,
      items_total,
      bytes_written,
      error_code,
    },
  }
}
function httpError(response: Response): Error {
  const retry = response.headers.get("retry-after")
  const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : undefined
  const date = retry ? DateTime.fromHTTP(retry) : undefined
  const hint =
    seconds !== undefined && Number.isSafeInteger(seconds)
      ? String(seconds)
      : date?.isValid
        ? date.toUTC().toISO()
        : undefined
  return new Error(
    `Drive export failed: HTTP ${response.status}${hint ? `; Retry-After: ${hint}` : ""}`,
  )
}
async function request(
  client: AuthedFetch,
  method: "GET" | "POST",
): Promise<{ data: Envelope; reused: boolean }> {
  let response: Response
  try {
    response = await client.fetch(`${client.baseUrl}/drive/export`, { method })
  } catch {
    throw new Error(
      method === "POST"
        ? "Export creation outcome is unknown; run `wspc drive export show` before trying again."
        : "Drive export request failed; check the connection and authentication.",
    )
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    if (method === "POST" && response.ok)
      throw new Error(
        "Export creation outcome is unknown; run `wspc drive export show` before trying again.",
      )
    if (!response.ok) throw httpError(response)
    throw incompatible()
  }
  if (
    method === "POST" &&
    response.status === 409 &&
    record(value) &&
    record(value.error) &&
    value.error.code === "DRIVE_EXPORT_IN_PROGRESS"
  ) {
    const data = envelope(value.error.details)
    if (!data.job || !["pending", "running"].includes(data.job.status)) throw incompatible()
    return { data, reused: true }
  }
  if (!response.ok) throw httpError(response)
  const data = envelope(value)
  if (method === "POST" && !data.job) throw incompatible()
  return { data, reused: false }
}
function show(account: string, data: Envelope, reused?: boolean): void {
  const output = {
    account,
    ...data,
    ...(reused === undefined ? {} : { reused }),
  }
  if (shouldOutputJson()) {
    render({ kind: "drive_export" }, output)
    return
  }
  const fields = {
    account,
    workspace_id: data.workspace_id,
    ...(data.job ?? { job: null }),
    ...(reused === undefined ? {} : { reused }),
  }
  if (data.job) {
    const timestamps = Object.fromEntries(
      ["created_at", "updated_at", "completed_at", "expires_at"].map((key) => {
        const value = data.job![key as "created_at" | "updated_at" | "completed_at" | "expires_at"]
        return [key, value === null ? null : DateTime.fromMillis(value).toISO()]
      }),
    )
    renderObject({ ...fields, ...timestamps })
    process.stdout.write(
      data.job.status === "completed"
        ? `Next: wspc drive export download ${data.job.id} --output <path>\n`
        : "Next: wspc drive export show\n",
    )
  } else {
    renderObject(fields)
    process.stdout.write("Next: wspc drive export add\n")
  }
}
export function driveExportCommand(options: Parameters<typeof loadAuthedFetch>[0] = {}): Command {
  const command = new Command("export").description(
    "Export current Workspace files as an uncompressed tar",
  )
  command
    .command("show")
    .description("Show the latest Export Job")
    .action(async () => {
      const client = await loadAuthedFetch(options)
      const { data } = await request(client, "GET")
      show(client.account, data)
    })
  command
    .command("add")
    .description("Start an Export Job without waiting for completion")
    .action(async () => {
      const client = await loadAuthedFetch(options)
      const { data, reused } = await request(client, "POST")
      show(client.account, data, reused)
    })
  command
    .command("download")
    .description("Download a specific Export Package without overwriting files")
    .argument("<job-id>", "Export Job ID")
    .requiredOption("--output <path>", "New output file in an existing directory")
    .action(async (jobId: string, opts: { output: string }) => {
      if (!/^exp_[0-9A-HJKMNP-TV-Z]{26}$/.test(jobId)) throw new Error("Invalid Export Job ID.")
      const output = resolve(opts.output)
      try {
        await lstat(output)
        throw new Error(`Output already exists: ${output}`)
      } catch (error) {
        if (!record(error) || error.code !== "ENOENT") throw error
      }
      const client = await loadAuthedFetch(options)
      const { data } = await request(client, "GET")
      const url = new URL(`${client.baseUrl}/drive/export/download`)
      url.searchParams.set("job_id", jobId)
      url.searchParams.set("workspace_id", data.workspace_id)
      const controller = new AbortController()
      const abort = () => controller.abort()
      process.once("SIGINT", abort)
      process.once("SIGTERM", abort)
      const temp = join(dirname(output), `.wspc-export-${randomUUID()}.tmp`)
      let file: Awaited<ReturnType<typeof open>> | undefined
      let published = false
      let bytes = 0
      try {
        let response: Response
        try {
          response = await client.fetch(url, { signal: controller.signal })
        } catch {
          throw new Error("Drive export download failed; check the connection and authentication.")
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw httpError(response)
        }
        const length = response.headers.get("content-length")
        const expected = length && /^\d+$/.test(length) ? Number(length) : NaN
        if (
          response.headers.get("x-wspc-export-job-id") !== jobId ||
          response.headers.get("x-wspc-workspace-id") !== data.workspace_id ||
          response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
            "application/x-tar" ||
          (response.headers.has("content-encoding") &&
            response.headers.get("content-encoding") !== "identity") ||
          !Number.isSafeInteger(expected) ||
          expected < 0 ||
          !response.body
        ) {
          await response.body?.cancel()
          throw incompatible()
        }
        try {
          file = await open(temp, "wx", 0o600)
        } catch (error) {
          await response.body.cancel().catch(() => undefined)
          throw error
        }
        const counter = new Transform({
          transform(chunk, _encoding, callback) {
            bytes += chunk.length
            callback(
              bytes > expected ? new Error("Export exceeds Content-Length.") : undefined,
              chunk,
            )
          },
        })
        try {
          await pipeline(
            Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>),
            counter,
            file.createWriteStream(),
            { signal: controller.signal },
          )
        } catch (error) {
          const code =
            record(error) && ["ENOSPC", "EACCES", "EIO", "ABORT_ERR"].includes(String(error.code))
              ? ` (${error.code})`
              : ""
          throw new Error(`Export transfer failed${code}; no output was published.`)
        }
        if (bytes !== expected) throw new Error("Export is shorter than Content-Length.")
        await file.close()
        controller.signal.throwIfAborted()
        await link(temp, output)
        published = true
      } finally {
        process.removeListener("SIGINT", abort)
        process.removeListener("SIGTERM", abort)
        if (file) {
          await file.close().catch(() => undefined)
          try {
            await unlink(temp)
          } catch {
            process.stderr.write(
              `${published ? "Output is complete; temporary file remains" : "Download failed; temporary file remains"}: ${temp}\n`,
            )
          }
        }
      }
      render(
        { kind: "drive_export_download", display: { shape: "object" } },
        {
          account: client.account,
          workspace_id: data.workspace_id,
          job_id: jobId,
          output,
          bytes_written: bytes,
        },
      )
    })
  return command
}
