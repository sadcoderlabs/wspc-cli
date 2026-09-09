import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { createReadStream } from "node:fs"
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pipeline } from "node:stream/promises"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = await mkdtemp(join(tmpdir(), "wspc-export-streaming-"))
const cli = resolve(process.argv[2] ?? "dist/cli.js")
const python = process.platform === "win32" ? "python" : "python3"
const fixtureTool = fileURLToPath(new URL("./check-drive-export-fixture.py", import.meta.url))
const jobId = "exp_01HW3K4N9V5G6Z8C2Q7B1Y0M3F"
let fixture
let size
let mode = "download"
let child
const server = createServer(async (request, response) => {
  assert.equal(request.headers.authorization, "Bearer fixture-token")
  const url = new URL(request.url, "http://localhost")
  if (url.pathname === "/drive/export") {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ workspace_id: "org_fixture", job: null }))
    return
  }
  assert.equal(url.searchParams.get("job_id"), jobId)
  assert.equal(url.searchParams.get("workspace_id"), "org_fixture")
  if (mode === "collision") await writeFile(join(root, "output.tar"), "original", { flag: "wx" })
  response.writeHead(200, {
    "content-type": "application/x-tar",
    "content-length": size,
    "x-wspc-export-job-id": jobId,
    "x-wspc-workspace-id": "org_fixture",
  })
  if (mode.startsWith("SIG")) {
    response.write(Buffer.alloc(1024))
    // The response can arrive before the temporary file is opened; wait for the OS file boundary.
    const interval = setInterval(async () => {
      if ((await readdir(root)).some((name) => name.endsWith(".tmp"))) {
        clearInterval(interval)
        child.kill(mode)
      }
    }, 10)
    response.on("close", () => clearInterval(interval))
    return
  }
  await pipeline(createReadStream(fixture), response).catch(() => undefined)
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
const address = server.address()
const configDir = join(root, ".wspc")
await mkdir(configDir)
await writeFile(
  join(configDir, "config.json"),
  JSON.stringify({
    current_env: "fixture",
    envs: {
      fixture: {
        api_base: `http://127.0.0.1:${address.port}`,
        current_account: "fixture@example.test",
        accounts: {
          "fixture@example.test": { email: "fixture@example.test", api_key: "fixture-token" },
        },
      },
    },
  }),
)
const preload = join(root, "os-boundary.mjs")
// Isolate the actual CLI's ConfigStore without changing HOME or the user's configuration.
await writeFile(
  preload,
  `import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module';
os.homedir = () => ${JSON.stringify(root)}; syncBuiltinESMExports();
process.on('exit', () => process.stderr.write('OS_PEAK_RSS_KIB=' + process.resourceUsage().maxRSS + '\\n'));`,
)
async function run() {
  child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(preload).href,
      cli,
      "--account",
      "fixture@example.test",
      "--json",
      "drive",
      "export",
      "download",
      jobId,
      "--output",
      join(root, "output.tar"),
    ],
    {
      env: { ...process.env, WSPC_ENV: "fixture", WSPC_ACCOUNT: "fixture@example.test" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  let stdout = "",
    stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000)
  const code = await new Promise((done, reject) => {
    child.on("error", reject)
    child.on("close", done)
  })
  clearTimeout(timeout)
  assert(!stdout.includes("fixture-token") && !stderr.includes("fixture-token"))
  assert(!(await readdir(root)).some((name) => name.endsWith(".tmp")), stderr)
  return { code, stdout, stderr, peakRssKiB: Number(stderr.match(/OS_PEAK_RSS_KIB=(\d+)/)?.[1]) }
}
const evidence = {
  node: process.version,
  os: process.platform,
  arch: process.arch,
  measurements: [],
  checks: [],
}
try {
  for (const mib of [128, 512]) {
    size = mib * 1024 * 1024
    fixture = join(root, `${mib}.tar`)
    const manifest = JSON.parse(
      execFileSync(python, [fixtureTool, "create", fixture, String(size)], { encoding: "utf8" }),
    )
    const peaks = []
    for (let round = 0; round < 3; round++) {
      const result = await run()
      assert.equal(result.code, 0, result.stderr)
      assert.equal(JSON.parse(result.stdout).bytes_written, size)
      assert(result.peakRssKiB > 0, "OS peak RSS must be available")
      assert.deepEqual(
        JSON.parse(
          execFileSync(python, [fixtureTool, "verify", join(root, "output.tar"), String(size)], {
            encoding: "utf8",
          }),
        ),
        manifest,
      )
      peaks.push(result.peakRssKiB)
      await rm(join(root, "output.tar"))
    }
    evidence.measurements.push({
      mib,
      peaksKiB: peaks,
      medianKiB: [...peaks].sort((a, b) => a - b)[1],
      manifest,
    })
    if (mib === 128) await rm(fixture)
  }
  const delta = evidence.measurements[1].medianKiB - evidence.measurements[0].medianKiB
  assert(delta < 64 * 1024, `Peak RSS increased by ${delta} KiB`)
  evidence.deltaKiB = delta
  mode = "collision"
  const collision = await run()
  assert.notEqual(collision.code, 0)
  assert.equal(collision.stdout, "")
  assert.equal(await readFile(join(root, "output.tar"), "utf8"), "original")
  await rm(join(root, "output.tar"))
  evidence.checks.push("concurrent destination preserved")
  if (process.platform !== "win32") {
    for (mode of ["SIGINT", "SIGTERM"]) {
      const interrupted = await run()
      assert.notEqual(interrupted.code, 0)
      assert.equal(interrupted.stdout, "")
      assert(!(await readdir(root)).includes("output.tar"))
      evidence.checks.push(`${mode}: nonzero, no output or temporary file`)
    }
  }
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
  await rm(root, { recursive: true, force: true })
}
