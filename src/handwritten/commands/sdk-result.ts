import { loadSdkClient } from "../auth/load-sdk-client.js"
import { render } from "../output/render.js"
import type { RenderContext } from "../output/types.js"

export interface SdkCommandResult<TData> {
  data?: TData
  error?: unknown
  response?: {
    ok?: boolean
    status?: number
  }
}

export async function runSdkCommand<TData, TSelected = TData>(
  ctx: RenderContext,
  operation: (client: never) => Promise<SdkCommandResult<TData>>,
  selectData?: (result: SdkCommandResult<TData>) => TSelected | undefined,
): Promise<SdkCommandResult<TData> | undefined> {
  const client = await loadSdkClient()
  const result = await operation(client._rawClient as never)
  if (result.error || !result.response?.ok) {
    process.stderr.write(
      `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
    )
    process.exitCode = 1
    return undefined
  }
  render(ctx, selectData?.(result) ?? result.data)
  return result
}
