import { afterAll, beforeAll, expect, it } from "vitest"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let directory: string
let body: unknown
let status = 200
const rule = { id: "tdr_fixture", user_id: "usr_creator", assignee_user_id: "usr_assignee", assignee_status: "valid", rrule: "FREQ=WEEKLY", dtstart: "2026-09-15" }
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString())
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(status !== 200 ? { error: { code: status === 422 ? "INVALID_ASSIGNEE" : "ASSIGNEE_CHECK_UNAVAILABLE" } } : req.method === "POST" ? { rule, template_todo_id: "tod_template", materialized_instance_count: 3 } : req.url?.includes("tdr_fixture") ? { rule, template: { id: "tod_template" }, materialized_instance_count: 3 } : { rules: [rule] }))
})
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "wspc-rule-"))
  await mkdir(join(directory, ".wspc"))
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing server port")
  await writeFile(join(directory, ".wspc/config.json"), JSON.stringify({ current_env: "fixture", envs: { fixture: { api_base: `http://127.0.0.1:${address.port}`, current_account: "fixture@example.com", accounts: { "fixture@example.com": { email: "fixture@example.com", api_key: "wspc_fixture" } } } } }))
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(directory, { recursive: true, force: true })
})
function run(args: string[], output = "json") {
  const bootstrap = `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module'; os.homedir=()=>${JSON.stringify(directory)}; syncBuiltinESMExports(); const {dispatch}=await import('./src/cli.ts'); await dispatch(['node','wspc',...process.argv.slice(1)]);`
  return new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, ["--import", "tsx", "--input-type=module", "-e", bootstrap, "--", ...args], { env: { ...process.env, WSPC_ENV: "fixture", WSPC_ACCOUNT: "fixture@example.com", WSPC_OUTPUT: output }, timeout: 15000 }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code) || 1 : 0, stdout, stderr }))
  })
}
it("sends a fixed assignee and explains that it is immutable", async () => {
  status = 200
  const result = await run(["todo", "rule", "add", "Weekly", "--rrule", "FREQ=WEEKLY", "--dtstart", "2026-09-15", "--project", "prj_fixture", "--assignee-user-id", "usr_assignee"])
  expect(result.code, result.stderr).toBe(0)
  expect(body).toEqual({ title: "Weekly", rrule: "FREQ=WEEKLY", dtstart: "2026-09-15", project_id: "prj_fixture", assignee_user_id: "usr_assignee" })
  const help = await run(["todo", "rule", "add", "--help"])
  expect(help.stdout).toContain("--assignee-user-id")
  expect(help.stdout).toContain("Assignment cannot change after rule creation")
})
it.each(["ls", "show"])("shows creator, assignee and status in %s JSON and pretty output", async command => {
  status = 200
  const args = ["todo", "rule", command, ...(command === "ls" ? ["--project-id", "prj_fixture"] : ["tdr_fixture"])]
  for (const output of ["json", "pretty"]) {
    const result = await run(args, output)
    expect(result.code, result.stderr).toBe(0)
    for (const value of ["usr_creator", "usr_assignee", "valid"]) expect(result.stdout).toContain(value)
  }
})
it.each([422, 503])("returns a nonzero exit for membership HTTP %i", async code => {
  status = code
  const result = await run(["todo", "rule", "add", "Weekly", "--rrule", "FREQ=WEEKLY", "--dtstart", "2026-09-15", "--project", "prj_fixture", "--assignee-user-id", "usr_assignee"])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain(code === 422 ? "INVALID_ASSIGNEE" : "ASSIGNEE_CHECK_UNAVAILABLE")
})
it("omits assignment when the caller uses the existing add command", async () => {
  status = 200
  const result = await run(["todo", "rule", "add", "Weekly", "--rrule", "FREQ=WEEKLY", "--dtstart", "2026-09-15", "--project", "prj_fixture"])
  expect(result.code, result.stderr).toBe(0)
  expect(body).toEqual({ title: "Weekly", rrule: "FREQ=WEEKLY", dtstart: "2026-09-15", project_id: "prj_fixture" })
})
