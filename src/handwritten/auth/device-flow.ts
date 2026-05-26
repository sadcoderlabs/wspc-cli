export interface DeviceFlowPrompt {
  verification_uri: string
  verification_uri_complete: string
  user_code: string
  expires_in: number
}

export interface DeviceFlowResult {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

export interface RunDeviceFlowOptions {
  baseUrl: string
  clientId: string
  onPrompt: (prompt: DeviceFlowPrompt) => void
  fetchImpl?: typeof fetch
  sleepMs?: (ms: number) => Promise<void>
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function runDeviceFlow(opts: RunDeviceFlowOptions): Promise<DeviceFlowResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const sleep = opts.sleepMs ?? DEFAULT_SLEEP

  // 1. Request device code.
  const codeRes = await fetchImpl(`${opts.baseUrl}/auth/oauth/device`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: opts.clientId }),
  })
  if (!codeRes.ok) {
    throw new Error(`device_authorization_failed: HTTP ${codeRes.status}`)
  }
  const codeJson = (await codeRes.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete: string
    expires_in: number
    interval: number
  }

  opts.onPrompt({
    verification_uri: codeJson.verification_uri,
    verification_uri_complete: codeJson.verification_uri_complete,
    user_code: codeJson.user_code,
    expires_in: codeJson.expires_in,
  })

  // 2. Poll token endpoint.
  const deadline = Date.now() + codeJson.expires_in * 1000
  let interval = codeJson.interval
  while (Date.now() < deadline) {
    await sleep(interval * 1000)
    const tokenRes = await fetchImpl(`${opts.baseUrl}/auth/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: codeJson.device_code,
        client_id: opts.clientId,
      }),
    })
    if (tokenRes.ok) {
      return (await tokenRes.json()) as DeviceFlowResult
    }
    // Server may return either RFC 8628 string form { error: "authorization_pending" }
    // or wspc's envelope { error: { code: "AUTHORIZATION_PENDING", message } }. Handle both.
    const errBody = (await tokenRes.json().catch(() => ({}))) as {
      error?: string | { code?: string }
    }
    const rawCode =
      typeof errBody.error === "string" ? errBody.error : (errBody.error?.code ?? "")
    const errCode = rawCode.toLowerCase()
    switch (errCode) {
      case "authorization_pending":
        continue
      case "slow_down":
        interval += 5
        continue
      case "access_denied":
      case "expired_token":
        throw new Error(`device_flow_${errCode}`)
      default:
        throw new Error(`device_flow_error: ${errCode || "unknown"} (HTTP ${tokenRes.status})`)
    }
  }
  throw new Error("device_flow_timeout")
}
