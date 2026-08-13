import { loadSdkClient } from "../auth/load-sdk-client.js";
import { render } from "../output/render.js";
import type { RenderContext } from "../output/types.js";

interface SdkResult<Data> {
  data?: Data;
  error?: unknown;
  response?: {
    ok: boolean;
    status: number;
  };
}

interface RunSdkCommandOptions<Data> {
  operation: (options: never) => Promise<SdkResult<Data>>;
  input: Record<string, unknown>;
  context: RenderContext;
  selectData?: (data: Data) => unknown;
  renderResult?: boolean;
}

export async function runSdkCommand<Data>({
  operation,
  input,
  context,
  selectData,
  renderResult = true,
}: RunSdkCommandOptions<Data>): Promise<Data | undefined> {
  const client = await loadSdkClient();
  const result = await operation({
    client: client._rawClient,
    ...input,
  } as never);
  if (result.error || !result.response?.ok) {
    process.stderr.write(
      `HTTP ${result.response?.status ?? "?"}: ${JSON.stringify(result.error ?? "unknown error", null, 2)}\n`,
    );
    process.exitCode = 1;
    return undefined;
  }
  if (renderResult) {
    render(
      context,
      result.data === undefined || selectData === undefined
        ? result.data
        : selectData(result.data),
    );
  }
  return result.data;
}
