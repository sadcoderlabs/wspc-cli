export interface XCli {
  command: string
  positional?: string[]
  aliases?: Record<string, string>
  examples?: string[]
  hidden?: boolean
}

export interface BodyField {
  name: string
  type: "string" | "number" | "boolean" | "array" | "object"
  required: boolean
}

export interface EmitInput {
  operationId: string
  method: string
  path: string
  summary?: string
  xCli: XCli
  bodyFields: BodyField[]
  pathParams?: string[]
  queryFields?: BodyField[]
  /** Number of directory segments in the output file path (e.g. "todo/add.ts" → depth 2) */
  depth?: number
}

function operationFnName(operationId: string): string {
  // snake_case → camelCase, mirroring Hey API default behavior.
  return operationId.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function leafCommand(cmd: string): string {
  const parts = cmd.split(/\s+/)
  return parts[parts.length - 1]!
}

function kebab(s: string): string {
  return s.replace(/_/g, "-")
}

function camelize(kebabStr: string): string {
  return kebabStr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

export function emitCommand(input: EmitInput): string | null {
  if (input.xCli.hidden) return null
  const fnName = operationFnName(input.operationId)
  const cmdLeaf = leafCommand(input.xCli.command)
  // Compute relative prefix: depth = number of path segments in the output file
  // e.g. "todo add" → parts=["todo","add"] → depth=2 → prefix="../../"
  const cmdParts = input.xCli.command.split(/\s+/)
  const depth = input.depth ?? cmdParts.length
  // Files are placed at src/generated/cli/<cmd parts>.ts.
  // The SDK lives at src/generated/sdk/, so we need depth levels up to reach src/generated/.
  const sdkRelPrefix = "../".repeat(depth)
  // The handwritten helpers live at src/handwritten/, which is one more level up from src/generated/.
  const handwrittenRelPrefix = "../".repeat(depth + 1)
  const positional = input.xCli.positional ?? []
  const aliases = input.xCli.aliases ?? {}
  const pathParams = input.pathParams ?? []
  const queryFields = input.queryFields ?? []

  // Find the alias entry for a field: alias key can be exact field name, its kebab,
  // or a prefix segment (e.g. alias key "project" covers field "project_id").
  function resolveAlias(fieldName: string): { longFlag: string; short?: string } {
    const flagName = kebab(fieldName)
    // Exact match on field name or kebab form
    if (aliases[fieldName] !== undefined) return { longFlag: flagName, short: aliases[fieldName] }
    if (aliases[flagName] !== undefined) return { longFlag: flagName, short: aliases[flagName] }
    // Prefix match: alias key "project" covers "project_id" / "project-id"
    for (const [aliasKey, short] of Object.entries(aliases)) {
      if (fieldName.startsWith(aliasKey + "_") || flagName.startsWith(aliasKey + "-")) {
        return { longFlag: aliasKey, short }
      }
    }
    return { longFlag: flagName }
  }

  // All non-positional options: body fields + query fields (excluding path params, which are positional)
  // Path params that are positional are already handled via .argument()
  const positionalSet = new Set(positional)
  const pathParamSet = new Set(pathParams)

  const args: string[] = positional.map((name) => {
    // Check in pathParams first (always required), then bodyFields
    const isPathParam = pathParamSet.has(name)
    const field = isPathParam ? undefined : input.bodyFields.find((f) => f.name === name)
    const required = isPathParam || (field?.required ?? true)
    return `.argument("${required ? `<${name}>` : `[${name}]`}", "${name}")`
  })

  // Options from body fields (skip positional and path params)
  const bodyOptions = input.bodyFields
    .filter((f) => !positionalSet.has(f.name) && !pathParamSet.has(f.name))
    .map((f) => {
      const { longFlag, short } = resolveAlias(f.name)
      const flagSpec = short ? `-${short}, --${longFlag} <value>` : `--${longFlag} <value>`
      return `.option("${flagSpec}", "${f.name}")`
    })

  // Options from query fields (skip positional and path params)
  const queryOptions = queryFields
    .filter((f) => !positionalSet.has(f.name) && !pathParamSet.has(f.name))
    .map((f) => {
      const { longFlag, short } = resolveAlias(f.name)
      const flagSpec = short ? `-${short}, --${longFlag} <value>` : `--${longFlag} <value>`
      return `.option("${flagSpec}", "${f.name}")`
    })

  const options = [...bodyOptions, ...queryOptions]

  // Build action parameter list: positional args + "opts"
  const argNames = positional

  // Build path block (path params that are positional)
  const pathPositionals = positional.filter((p) => pathParamSet.has(p))
  const pathBlock =
    pathPositionals.length > 0
      ? [`      path: {`, ...pathPositionals.map((p) => `        ${p},`), `      },`]
      : []

  // Build body block (body fields, positional non-path + options)
  const bodyPositionals = positional.filter((p) => !pathParamSet.has(p))
  const bodyOptLines = input.bodyFields
    .filter((f) => !positionalSet.has(f.name) && !pathParamSet.has(f.name))
    .map((f) => {
      const { longFlag } = resolveAlias(f.name)
      return `        ${f.name}: opts.${camelize(longFlag)},`
    })
  const bodyHasContent = bodyPositionals.length > 0 || bodyOptLines.length > 0
  const bodyBlock = bodyHasContent
    ? [
        `      body: {`,
        ...bodyPositionals.map((p) => `        ${p},`),
        ...bodyOptLines,
        `      },`,
      ]
    : []

  // Build query block (query fields)
  const queryOptLines = queryFields
    .filter((f) => !positionalSet.has(f.name) && !pathParamSet.has(f.name))
    .map((f) => {
      const { longFlag } = resolveAlias(f.name)
      return `        ${f.name}: opts.${camelize(longFlag)},`
    })
  const queryBlock =
    queryOptLines.length > 0 ? [`      query: {`, ...queryOptLines, `      },`] : []

  return [
    `// AUTO-GENERATED — DO NOT EDIT (source: ${input.operationId})`,
    `import { Command } from "commander"`,
    `import { ${fnName} } from "${sdkRelPrefix}sdk/index.js"`,
    `import { loadSdkClient } from "${handwrittenRelPrefix}handwritten/auth/load-sdk-client.js"`,
    ``,
    `export const ${fnName}Command = new Command(${JSON.stringify(cmdLeaf)})`,
    `  .description(${JSON.stringify(input.summary ?? input.xCli.command)})`,
    ...args.map((a) => `  ${a}`),
    ...options.map((o) => `  ${o}`),
    `  .action(async (${[...argNames, "opts"].join(", ")}) => {`,
    `    const client = await loadSdkClient()`,
    `    const result = await ${fnName}({`,
    `      client: (client as unknown as { _rawClient: unknown })._rawClient as never,`,
    ...pathBlock,
    ...bodyBlock,
    ...queryBlock,
    `    })`,
    `    if (result.error || !result.response?.ok) {`,
    `      process.stderr.write(`,
    `        \`HTTP \${result.response?.status ?? "?"}: \${JSON.stringify(result.error ?? "unknown error", null, 2)}\\n\`,`,
    `      )`,
    `      process.exitCode = 1`,
    `      return`,
    `    }`,
    `    if (result.data !== undefined) console.log(JSON.stringify(result.data, null, 2))`,
    `  })`,
    ``,
  ].join("\n")
}
