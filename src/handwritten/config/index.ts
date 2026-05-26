import { promises as fs } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface EnvConfig {
  api_base: string
  api_key?: string                       // legacy / escape hatch
  refresh_token?: string
  access_token?: string
  access_token_expires_at?: number
  actor?: "user" | "agent"
  agent_label?: string
}

export interface WspcConfig {
  current_env?: string
  envs: Record<string, EnvConfig>
}

const DEFAULT_DIR = join(homedir(), ".wspc")

export class ConfigStore {
  private readonly configDir: string
  private readonly configFile: string

  constructor(opts: { configDir?: string } = {}) {
    this.configDir = opts.configDir ?? DEFAULT_DIR
    this.configFile = join(this.configDir, "config.json")
  }

  async read(): Promise<WspcConfig> {
    try {
      const buf = await fs.readFile(this.configFile, "utf8")
      const parsed = JSON.parse(buf)
      if (typeof parsed !== "object" || parsed === null || typeof parsed.envs !== "object") {
        return { envs: {} }
      }
      return parsed as WspcConfig
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { envs: {} }
      throw e
    }
  }

  async write(config: WspcConfig): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 })
    if (process.platform !== "win32") {
      await fs.chmod(this.configDir, 0o700).catch(() => {})
    }
    await fs.writeFile(this.configFile, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
  }

  async currentEnv(): Promise<{ name: string; config: EnvConfig } | undefined> {
    const c = await this.read()
    const name = c.current_env
    if (!name) return undefined
    const env = c.envs[name]
    if (!env) return undefined
    return { name, config: env }
  }
}
