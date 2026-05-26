import { promises as fs } from "node:fs"
import { join } from "node:path"
import { emitCommand, type XCli, type BodyField } from "./emit.js"

const SPEC_PATH = "spec/openapi.json"
const OUT_DIR = "src/generated/cli"

interface SchemaLike {
  type?: string
  properties?: Record<string, SchemaLike>
  required?: string[]
  $ref?: string
}

interface ParameterLike {
  name: string
  in: "path" | "query" | "header" | "cookie"
  required?: boolean
  schema?: SchemaLike
}

interface OperationLike {
  operationId?: string
  summary?: string
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

function camelize(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
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
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties).map(([name, def]) => ({
    name,
    type: (def.type as BodyField["type"]) ?? "string",
    required: required.has(name),
  }))
}

function extractPathParams(op: OperationLike): string[] {
  return (op.parameters ?? [])
    .filter((p) => p.in === "path")
    .map((p) => p.name)
}

function extractQueryFields(op: OperationLike): BodyField[] {
  return (op.parameters ?? [])
    .filter((p) => p.in === "query")
    .map((p) => ({
      name: p.name,
      type: (p.schema?.type as BodyField["type"]) ?? "string",
      required: p.required ?? false,
    }))
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

  for (const [routePath, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op.operationId || !op["x-cli"] || op["x-cli"].hidden) continue
      const bodyFields = extractBodyFields(op, spec)
      const pathParams = extractPathParams(op)
      const queryFields = extractQueryFields(op)
      const code = emitCommand({
        operationId: op.operationId,
        method,
        path: routePath,
        summary: op.summary,
        xCli: op["x-cli"],
        bodyFields,
        pathParams,
        queryFields,
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
        varName: `${camelize(op.operationId)}Command`,
      })
    }
  }

  await fs.writeFile(join(OUT_DIR, "index.ts"), emitIndex(emitted))
  console.log(`✓ emitted ${emitted.length} CLI commands -> ${OUT_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
