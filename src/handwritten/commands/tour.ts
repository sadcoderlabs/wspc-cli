import { Command } from "commander"

// Public, unauthenticated endpoint on the mcp worker. `wspc tour` fetches the
// same WSPC_GUIDE text the MCP guide_start tool returns, so both surfaces stay
// in sync from one source. Override with WSPC_GUIDE_URL for local dev.
export const GUIDE_URL_DEFAULT = "https://mcp.wspc.ai/guide"

export function resolveGuideUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.WSPC_GUIDE_URL?.trim()
  return override ? override : GUIDE_URL_DEFAULT
}

export async function fetchGuide(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`tour_fetch_failed: ${res.status}`)
  return await res.text()
}

// Shown on stderr only when stdout is an interactive terminal (a human). When an
// agent captures stdout (piped, non-TTY) we print the raw script alone so the
// hint never pollutes the agent's context.
export const TOUR_HINT =
  "This is the wspc guided tour for your AI agent — ask your agent to run `wspc tour` and follow it.\n"

export const tourCommand = new Command("tour")
  .description("Print the wspc guided-tour script for your AI agent to read and follow")
  .action(async () => {
    const text = await fetchGuide(resolveGuideUrl())
    if (process.stdout.isTTY) process.stderr.write(TOUR_HINT)
    process.stdout.write(text.endsWith("\n") ? text : text + "\n")
  })
