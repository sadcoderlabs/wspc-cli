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
  const positional = input.xCli.positional ?? []
  const aliases = input.xCli.aliases ?? {}

  const args: string[] = positional.map((name) => {
    const field = input.bodyFields.find((f) => f.name === name)
    const required = field?.required ?? true
    return `.argument("${required ? `<${name}>` : `[${name}]`}", "${name}")`
  })

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

  const options: string[] = input.bodyFields
    .filter((f) => !positional.includes(f.name))
    .map((f) => {
      const { longFlag, short } = resolveAlias(f.name)
      const flagSpec = short ? `-${short}, --${longFlag} <value>` : `--${longFlag} <value>`
      return `.option("${flagSpec}", "${f.name}")`
    })

  const argNames = positional.map((p) => p)
  const optMap = input.bodyFields
    .filter((f) => !positional.includes(f.name))
    .map((f) => {
      const { longFlag } = resolveAlias(f.name)
      return `      ${f.name}: opts.${camelize(longFlag)}`
    })
    .join(",\n")
  const posMap = positional.map((p) => `      ${p}`).join(",\n")
  const bodyAssembly = [posMap, optMap].filter(Boolean).join(",\n")

  return [
    `// AUTO-GENERATED — DO NOT EDIT (source: ${input.operationId})`,
    `import { Command } from "commander"`,
    `import { ${fnName} } from "../../generated/sdk/index.js"`,
    `import { loadSdkClient } from "../../handwritten/auth/load-sdk-client.js"`,
    ``,
    `export const ${fnName}Command = new Command(${JSON.stringify(cmdLeaf)})`,
    `  .description(${JSON.stringify(input.summary ?? input.xCli.command)})`,
    ...args.map((a) => `  ${a}`),
    ...options.map((o) => `  ${o}`),
    `  .action(async (${[...argNames, "opts"].join(", ")}) => {`,
    `    const client = await loadSdkClient()`,
    `    const result = await ${fnName}({`,
    `      client: (client as unknown as { _rawClient: unknown })._rawClient as never,`,
    `      body: {`,
    bodyAssembly,
    `      },`,
    `    })`,
    `    console.log(JSON.stringify(result.data, null, 2))`,
    `  })`,
    ``,
  ].join("\n")
}
