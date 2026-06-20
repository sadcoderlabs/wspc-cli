import { Command } from "commander"
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { createDriveApi } from "./api.js"
import { initDriveState } from "./state.js"
import { render } from "../../output/render.js"

async function assertExistingDirectory(path: string): Promise<void> {
  let stats
  try {
    stats = await stat(path)
  } catch {
    throw new Error(`local folder does not exist: ${path}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`local path is not a folder: ${path}`)
  }
}

export function driveBindCommand(): Command {
  return new Command("bind")
    .description("Bind a local folder to an existing Drive library")
    .requiredOption("--library <id>", "existing Drive library id")
    .argument("[path]", "local folder path", ".")
    .action(async (path: string, opts: { library: string }) => {
      const root = resolve(path)
      await assertExistingDirectory(root)
      const api = await createDriveApi()
      const library = await api.getLibrary(opts.library)
      const state = await initDriveState(root, opts.library)

      render(
        { kind: "drive_bind", display: { shape: "object" } },
        {
          root,
          library_id: state.library_id,
          library_name: library.name,
        },
      )
    })
}
