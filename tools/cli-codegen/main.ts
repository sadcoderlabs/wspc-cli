import { promises as fs } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { emitCommand, snakeToCamel, type XCli, type BodyField } from "./emit.js"

const SPEC_PATH = "spec/openapi.json"
const OUT_DIR = "src/generated/cli"

interface SchemaLike {
  type?: string
  description?: string
  properties?: Record<string, SchemaLike>
  required?: string[]
  $ref?: string
  oneOf?: SchemaLike[]
}

interface ParameterLike {
  name: string
  in: "path" | "query" | "header" | "cookie"
  required?: boolean
  description?: string
  schema?: SchemaLike
}

export interface OperationLike {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: ParameterLike[]
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: SchemaLike
      }
    }
  }
  "x-cli"?: XCli
}

export function shouldSkipRoute(xCli: { command: string; hidden?: boolean }): boolean {
  if (xCli.hidden) return true
  if (xCli.command === "_internal") return true
  if (xCli.command === "_handwritten") return true
  return false
}

function resolveRef(ref: string, spec: Record<string, unknown>): SchemaLike {
  // Handles "#/components/schemas/Foo" style $ref
  const parts = ref.replace(/^#\//, "").split("/")
  let node: unknown = spec
  for (const part of parts) {
    node = (node as Record<string, unknown>)[part]
  }
  return node as SchemaLike
}

function extractBodyFields(
  op: OperationLike,
  spec: Record<string, unknown>,
): BodyField[] {
  let schema = op.requestBody?.content?.["application/json"]?.schema
  if (!schema) return []
  // Resolve top-level $ref
  if (schema.$ref) {
    schema = resolveRef(schema.$ref, spec)
  }
  if (!schema.properties) return []

  const unwrapKey = op["x-cli"]?.body?.unwrap
  if (unwrapKey && schema.properties[unwrapKey]) {
    let subSchema = schema.properties[unwrapKey]
    if (subSchema.$ref) {
      subSchema = resolveRef(subSchema.$ref, spec)
    }
    let props: Record<string, SchemaLike> = {}
    const required = new Set<string>()
    if (subSchema.properties) {
      props = subSchema.properties
      if (subSchema.required) {
        subSchema.required.forEach((r) => required.add(r))
      }
    } else if (subSchema.oneOf) {
      for (let s of subSchema.oneOf) {
        if (s.$ref) {
          s = resolveRef(s.$ref, spec)
        }
        if (s.properties) {
          Object.assign(props, s.properties)
          if (s.required) {
            s.required.forEach((r) => required.add(r))
          }
        }
      }
    }
    if (Object.keys(props).length > 0) {
      return Object.entries(props).map(([name, def]) => ({
        name,
        type: (def.type as BodyField["type"]) ?? "string",
        required: required.has(name),
        description: def.description,
      }))
    }
  }

  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties).map(([name, def]) => ({
    name,
    type: (def.type as BodyField["type"]) ?? "string",
    required: required.has(name),
    description: def.description,
  }))
}

function extractPathParams(op: OperationLike): string[] {
  return (op.parameters ?? [])
    .filter((p) => p.in === "path")
    .map((p) => p.name)
}

export function extractQueryFields(op: OperationLike): BodyField[] {
  const boolFlagNames = new Set<string>(op["x-cli"]?.booleanFlags ?? [])
  return (op.parameters ?? [])
    .filter((p) => p.in === "query")
    .map((p) => ({
      name: p.name,
      type: (p.schema?.type as BodyField["type"]) ?? "string",
      required: p.required ?? false,
      description: p.description ?? p.schema?.description,
      boolFlag: boolFlagNames.has(p.name),
    }))
}

export interface RouteOp {
  routePath: string
  method: string
  op: OperationLike & { operationId: string; "x-cli": XCli }
}

// Two ops sharing an x-cli command form a Paired Command when exactly one has
// path params: it becomes the primary, the other its no-positional fallback.
export function groupCommands(routes: RouteOp[]): (RouteOp & { fallback?: RouteOp })[] {
  const byCommand = new Map<string, RouteOp[]>()
  for (const r of routes) {
    const command = r.op["x-cli"].command
    byCommand.set(command, [...(byCommand.get(command) ?? []), r])
  }
  return [...byCommand.entries()].map(([command, group]) => {
    if (group.length === 1) return group[0]!
    const withPath = group.filter((r) => extractPathParams(r.op).length > 0)
    const withoutPath = group.filter((r) => extractPathParams(r.op).length === 0)
    if (group.length !== 2 || withPath.length !== 1) {
      const ids = group.map((r) => r.op.operationId).join(", ")
      throw new Error(`x-cli command "${command}" is shared by ${ids} but is not a Paired Command`)
    }
    return { ...withPath[0]!, fallback: withoutPath[0]! }
  })
}

interface EmittedCmd {
  commandPath: string[]
  filePath: string // relative to OUT_DIR
  varName: string
}

interface TreeNode {
  children: Map<string, TreeNode>
  leafVarName?: string
}

function buildTree(items: EmittedCmd[]): TreeNode {
  const root: TreeNode = { children: new Map() }
  for (const it of items) {
    let node = root
    for (let i = 0; i < it.commandPath.length - 1; i++) {
      const seg = it.commandPath[i]!
      if (!node.children.has(seg)) node.children.set(seg, { children: new Map() })
      node = node.children.get(seg)!
    }
    const leaf = it.commandPath[it.commandPath.length - 1]!
    if (!node.children.has(leaf)) node.children.set(leaf, { children: new Map() })
    node.children.get(leaf)!.leafVarName = it.varName
  }
  return root
}

function emitTreeRegistration(node: TreeNode, parentVar: string, depth: number): string[] {
  const out: string[] = []
  const indent = "  ".repeat(depth)
  for (const [seg, child] of node.children) {
    if (child.children.size === 0 && child.leafVarName) {
      out.push(`${indent}${parentVar}.addCommand(${child.leafVarName})`)
    } else {
      const subVar = `${parentVar}_${seg.replace(/[^a-zA-Z0-9]/g, "_")}`
      // Set a description on parent commands too — without one, commander
      // prints a blank next to the segment in --help, which looks broken.
      out.push(
        `${indent}const ${subVar} = ${parentVar}.command(${JSON.stringify(seg)}).description(${JSON.stringify(`${seg} commands`)})`,
      )
      if (child.leafVarName) {
        out.push(`${indent}${subVar}.addCommand(${child.leafVarName})`)
      }
      out.push(...emitTreeRegistration(child, subVar, depth))
    }
  }
  return out
}

function emitIndex(items: EmittedCmd[]): string {
  const imports = items.map(
    (it) => `import { ${it.varName} } from "./${it.filePath.replace(/\.ts$/, ".js")}"`,
  )
  const tree = buildTree(items)
  return [
    `// AUTO-GENERATED — DO NOT EDIT`,
    `import { Command } from "commander"`,
    ...imports,
    ``,
    `export function registerGeneratedCommands(root: Command): void {`,
    ...emitTreeRegistration(tree, "root", 1),
    `}`,
    ``,
  ].join("\n")
}

async function main(): Promise<void> {
  const spec = JSON.parse(await fs.readFile(SPEC_PATH, "utf8")) as {
    paths: Record<string, Record<string, OperationLike>>
  } & Record<string, unknown>

  await fs.rm(OUT_DIR, { recursive: true, force: true })
  await fs.mkdir(OUT_DIR, { recursive: true })

  const emitted: EmittedCmd[] = []

  const routes: RouteOp[] = []
  for (const [routePath, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op.operationId || !op["x-cli"] || shouldSkipRoute(op["x-cli"])) continue
      routes.push({ routePath, method, op: op as RouteOp["op"] })
    }
  }

  for (const { routePath, method, op, fallback } of groupCommands(routes)) {
    const code = emitCommand({
      operationId: op.operationId,
      method,
      path: routePath,
      summary: op.summary,
      description: op.description,
      xCli: op["x-cli"],
      bodyFields: extractBodyFields(op, spec),
      pathParams: extractPathParams(op),
      queryFields: extractQueryFields(op),
      fallback: fallback && {
        operationId: fallback.op.operationId,
        summary: fallback.op.summary,
        description: fallback.op.description,
        xCli: fallback.op["x-cli"],
        queryFields: extractQueryFields(fallback.op),
      },
    })
    if (code === null) continue

    const parts = op["x-cli"].command.split(/\s+/)
    const relFile = `${parts.join("/")}.ts`
    const filePath = join(OUT_DIR, relFile)
    await fs.mkdir(join(OUT_DIR, ...parts.slice(0, -1)), { recursive: true })
    await fs.writeFile(filePath, code)

    emitted.push({
      commandPath: parts,
      filePath: relFile,
      varName: `${snakeToCamel(op.operationId)}Command`,
    })
  }

  await fs.writeFile(join(OUT_DIR, "index.ts"), emitIndex(emitted))
  console.log(`✓ emitted ${emitted.length} CLI commands -> ${OUT_DIR}`)
}

// Only run when invoked directly (e.g. `tsx tools/cli-codegen/main.ts`).
// Skip when imported as a module — otherwise `main.test.ts` importing
// `shouldSkipRoute` would trigger a full wipe-and-regen of `OUT_DIR` as
// a side effect, which both slows tests and leaves `src/generated/cli/`
// modified in git after every `npm test` run.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
