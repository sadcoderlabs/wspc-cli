export interface XCliDisplay {
  shape?: "list" | "object" | "scalar"
  columns?: string[]
  fields?: string[]
  format?: Record<string, string>
  emptyMessage?: string
}

export interface XCliOption {
  parser?: "datetime" | "attendee"
  array?: boolean
  mapsTo?: string
  allDayFlag?: string
  exclusive?: boolean
}

export interface XCliBody {
  unwrap?: string
}

export interface XCliExitOnField {
  path: string
  failOn: any
}

export interface XCli {
  command: string
  positional?: string[]
  aliases?: Record<string, string>
  examples?: string[]
  hidden?: boolean
  display?: XCliDisplay
  options?: Record<string, XCliOption>
  body?: XCliBody
  exitOnField?: XCliExitOnField
}

export interface BodyField {
  name: string
  type: "string" | "number" | "boolean" | "array" | "object"
  required: boolean
  description?: string
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

function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
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
  const explicitPositional = input.xCli.positional ?? []
  const pathParams = input.pathParams ?? []
  // Required path params must always be exposed as positional arguments — otherwise
  // the command compiles without a `path:` block while the SDK type requires one
  // (silent drop → broken generated code). x-cli.positional already lists them for
  // most commands; auto-append any it omits. event_ics_download is special-cased
  // below (its `filename` path param is surfaced as `id`), so skip it here.
  const autoPathPositional =
    input.operationId === "event_ics_download"
      ? []
      : pathParams.filter((p) => !explicitPositional.includes(p))
  const positional = [...explicitPositional, ...autoPathPositional]
  const aliases = input.xCli.aliases ?? {}
  const queryFields = input.queryFields ?? []
  const xCliOptions = input.xCli.options ?? {}

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

  // Map: API field name (body/query) → x-cli option key that takes over its emission.
  // Built from xCliOptions[key].mapsTo (e.g. attendee → attendees) and from xCliOptions
  // where the option key already matches a field name (e.g. start → start).
  const fieldToOptionKey: Record<string, string> = {}
  for (const [optKey, optDef] of Object.entries(xCliOptions)) {
    const target = optDef.mapsTo ?? optKey
    fieldToOptionKey[target] = optKey
  }

  // Set of x-cli option keys that are "virtual" — i.e. they don't correspond to
  // any body/query field name on their own (they only reach the API via mapsTo).
  // Also collect the set of allDayFlag names so we can emit them as boolean flags.
  const allDayFlags = new Set<string>()
  for (const optDef of Object.values(xCliOptions)) {
    if (optDef.allDayFlag) allDayFlags.add(optDef.allDayFlag)
  }

  // Does this operation need a --tz flag and resolveTimezone() call?
  const hasDatetimeParser = Object.values(xCliOptions).some((o) => o.parser === "datetime")
  const hasAttendeeParser = Object.values(xCliOptions).some((o) => o.parser === "attendee")
  const usesParseDateOnly = Object.values(xCliOptions).some(
    (o) => o.parser === "datetime" && o.allDayFlag,
  )
  const usesInclusiveEndToExclusive = Object.values(xCliOptions).some(
    (o) => o.parser === "datetime" && o.allDayFlag && o.exclusive,
  )

  // All non-positional options: body fields + query fields (excluding path params, which are positional)
  // Path params that are positional are already handled via .argument()
  const positionalSet = new Set(positional)
  const pathParamSet = new Set(pathParams)

  // Special case: event_ics_download takes a positional `id` but the underlying API
  // path param is `filename` (which must be `<id>.ics`). The positional arg name we
  // expose to users is `id`, not `filename`.
  const isIcsDownload = input.operationId === "event_ics_download"

  // A positional name that also appears as an array x-cli option becomes a
  // variadic positional (`<name...>`) bound to the option's body target via
  // `mapsTo`. e.g. `positional: ["id"]` + `options.id.array: true` →
  // `wspc email rm <id...>` writing into `body.ids: string[]`.
  const variadicPositionalSet = new Set(
    positional.filter((p) => xCliOptions[p]?.array === true),
  )

  const args: string[] = positional.map((name) => {
    if (isIcsDownload && name === "id") {
      return `.argument("<id>", "id")`
    }
    if (variadicPositionalSet.has(name)) {
      return `.argument("<${name}...>", "${name}")`
    }
    // Check in pathParams first (always required), then bodyFields
    const isPathParam = pathParamSet.has(name)
    const field = isPathParam ? undefined : input.bodyFields.find((f) => f.name === name)
    const required = isPathParam || (field?.required ?? true)
    return `.argument("${required ? `<${name}>` : `[${name}]`}", "${name}")`
  })

  function emitFieldOption(f: BodyField): string {
    const optKey = fieldToOptionKey[f.name]
    if (optKey !== undefined) {
      // Field is owned by an x-cli option; emit under that option key (and its array shape).
      const optDef = xCliOptions[optKey]!
      const { longFlag, short } = resolveAlias(optKey)
      const flagSpec = short ? `-${short}, --${longFlag} <value>` : `--${longFlag} <value>`
      const optLabel = JSON.stringify(f.description ?? optKey)
      if (optDef.array) {
        return `.option("${flagSpec}", ${optLabel}, (val: string, memo: string[]) => { memo.push(val); return memo }, [] as string[])`
      }
      return `.option("${flagSpec}", ${optLabel})`
    }
    const { longFlag, short } = resolveAlias(f.name)
    const flagSpec = short ? `-${short}, --${longFlag} <value>` : `--${longFlag} <value>`
    // Prefer the field's OpenAPI description so `--help` carries real guidance;
    // fall back to the field name. JSON.stringify keeps quotes/newlines safe.
    return `.option("${flagSpec}", ${JSON.stringify(f.description ?? f.name)})`
  }

  // Skip body fields whose x-cli option key has been promoted to a variadic
  // positional — those values come in via .argument(<name...>), not a flag.
  function bodyFieldOwnedByVariadicPositional(f: BodyField): boolean {
    const optKey = fieldToOptionKey[f.name]
    return optKey !== undefined && variadicPositionalSet.has(optKey)
  }

  // Options from body fields (skip positional and path params)
  const bodyOptions = input.bodyFields
    .filter(
      (f) =>
        !positionalSet.has(f.name) &&
        !pathParamSet.has(f.name) &&
        !bodyFieldOwnedByVariadicPositional(f),
    )
    .map(emitFieldOption)

  // Options from query fields (skip positional and path params)
  const queryOptions = queryFields
    .filter((f) => !positionalSet.has(f.name) && !pathParamSet.has(f.name))
    .map(emitFieldOption)

  // Virtual x-cli options: option keys that map to no existing body/query field
  // (e.g. `attendee` mapping to `attendees` is NOT virtual; `all_day` mapping
  // to itself, with no `all_day` field on the schema, IS virtual).
  const bodyFieldNames = new Set(input.bodyFields.map((f) => f.name))
  const queryFieldNames = new Set(queryFields.map((f) => f.name))
  const virtualOptions: string[] = []
  for (const [optKey, optDef] of Object.entries(xCliOptions)) {
    const target = optDef.mapsTo ?? optKey
    if (bodyFieldNames.has(target) || queryFieldNames.has(target)) continue
    // Skip allDayFlag — emitted separately as a boolean flag below.
    if (allDayFlags.has(optKey)) continue
    const { longFlag, short } = resolveAlias(optKey)
    if (optDef.array) {
      const flagSpec = short ? `-${short}, --${longFlag} <value>` : `--${longFlag} <value>`
      virtualOptions.push(
        `.option("${flagSpec}", "${optKey}", (val: string, memo: string[]) => { memo.push(val); return memo }, [] as string[])`,
      )
    } else {
      const flagSpec = short ? `-${short}, --${longFlag} <value>` : `--${longFlag} <value>`
      virtualOptions.push(`.option("${flagSpec}", "${optKey}")`)
    }
  }

  // Boolean all-day style flags. Guard against an existing body/query field
  // with the same name (would otherwise emit a duplicate `--<flag>` option).
  const allDayFlagOptions: string[] = []
  for (const flagName of allDayFlags) {
    if (bodyFieldNames.has(flagName) || queryFieldNames.has(flagName)) continue
    const flagKebab = kebab(flagName)
    allDayFlagOptions.push(`.option("--${flagKebab}", "${flagName}")`)
  }

  // Implicit --tz flag when any datetime parser is present.
  const tzOption = hasDatetimeParser ? [`.option("--tz <zone>", "IANA timezone for relative time parsing")`] : []

  const options = [...bodyOptions, ...queryOptions, ...virtualOptions, ...allDayFlagOptions, ...tzOption]

  // Build action parameter list: positional args + "opts"
  const argNames = positional

  // Build path block (path params that are positional)
  const pathPositionals = positional.filter((p) => pathParamSet.has(p))
  let pathBlock: string[] = []
  if (isIcsDownload) {
    // Special-case: filename = `${id}.ics`
    pathBlock = [`      path: {`, `        filename: \`\${id}.ics\`,`, `      },`]
  } else if (pathPositionals.length > 0) {
    pathBlock = [`      path: {`, ...pathPositionals.map((p) => `        ${p},`), `      },`]
  }

  // Determine option variable identifier in the action body for a given x-cli
  // option key. For datetime parsers we emit a `<camel>Value` local var; for
  // attendee array parsers we emit `<camel(target)>` local var; otherwise it
  // is just `opts.<camel>`.
  function valueExprForOption(optKey: string): string {
    const optDef = xCliOptions[optKey]!
    const camelKey = camelize(kebab(optKey))
    if (optDef.parser === "datetime") {
      return `${camelKey}Value`
    }
    if (optDef.parser === "attendee") {
      const target = optDef.mapsTo ?? optKey
      return snakeToCamel(target)
    }
    if (optDef.array && !optDef.parser) {
      const target = optDef.mapsTo ?? optKey
      return snakeToCamel(target)
    }
    return `opts.${camelKey}`
  }

  // Build body block (body fields, positional non-path + options).
  // For event_ics_download, the positional `id` is consumed by the path block
  // (as `filename`), so it must not also leak into a body.
  const bodyPositionals = isIcsDownload
    ? []
    : positional.filter(
        // Variadic positionals are handled via the x-cli option / conversion
        // block (they need a `mapsTo` rename + array cast). Plain positionals
        // map 1:1 to body field names and are emitted with shorthand below.
        (p) => !pathParamSet.has(p) && !variadicPositionalSet.has(p),
      )
  const bodyOptLines = input.bodyFields
    .filter((f) => !positionalSet.has(f.name) && !pathParamSet.has(f.name))
    .map((f) => {
      const optKey = fieldToOptionKey[f.name]
      if (optKey !== undefined) {
        const expr = valueExprForOption(optKey)
        // If the API field is required, the SDK type rejects undefined; the
        // parser-produced local var is typed `string | undefined` because the
        // user might omit the flag (commander has no way to mark required
        // options for us). Cast to satisfy the SDK type — runtime validation
        // server-side surfaces the missing-field error.
        const optDef = xCliOptions[optKey]!
        const castType = optDef.array ? "string[]" : "string"
        const suffix = f.required ? ` as ${castType}` : ""
        return `        ${f.name}: ${expr}${suffix},`
      }
      const { longFlag } = resolveAlias(f.name)
      return `        ${f.name}: opts.${camelize(longFlag)},`
    })
  const bodyHasContent = bodyPositionals.length > 0 || bodyOptLines.length > 0
  const unwrapKey = input.xCli.body?.unwrap
  let bodyBlock: string[] = []
  if (bodyHasContent) {
    if (unwrapKey) {
      bodyBlock = [
        `      body: {`,
        `        ${unwrapKey}: {`,
        ...bodyPositionals.map((p) => `          ${p},`),
        ...bodyOptLines.map((line) => `  ${line}`),
        `        },`,
        `      },`,
      ]
    } else {
      bodyBlock = [
        `      body: {`,
        ...bodyPositionals.map((p) => `        ${p},`),
        ...bodyOptLines,
        `      },`,
      ]
    }
  }

  // Build query block (query fields)
  const queryOptLines = queryFields
    .filter((f) => !positionalSet.has(f.name) && !pathParamSet.has(f.name))
    .map((f) => {
      const optKey = fieldToOptionKey[f.name]
      if (optKey !== undefined) {
        return `        ${f.name}: ${valueExprForOption(optKey)},`
      }
      const { longFlag } = resolveAlias(f.name)
      return `        ${f.name}: opts.${camelize(longFlag)},`
    })
  const queryBlock =
    queryOptLines.length > 0 ? [`      query: {`, ...queryOptLines, `      },`] : []

  // `kind` is the renderer registry key. We use the operationId verbatim so
  // every operation has a unique, stable identifier — handwritten renderers
  // register under the same string. Embedding `display` inline keeps the
  // generated file self-contained (no JSON-file reads at startup).
  const kind = input.operationId
  const displayLiteral = input.xCli.display
    ? JSON.stringify(input.xCli.display)
    : "undefined"

  // Emit parser conversion block at top of action body.
  const conversionLines: string[] = []
  if (hasDatetimeParser) {
    conversionLines.push(`    const zone = resolveTimezone(opts.tz as string | undefined)`)
  }
  for (const [optKey, optDef] of Object.entries(xCliOptions)) {
    if (optDef.parser === "datetime") {
      const camelKey = camelize(kebab(optKey))
      const valueVar = `${camelKey}Value`
      conversionLines.push(`    let ${valueVar}: string | undefined`)
      conversionLines.push(`    if (opts.${camelKey} !== undefined) {`)
      if (optDef.allDayFlag) {
        const camelAllDay = camelize(kebab(optDef.allDayFlag))
        conversionLines.push(`      if (opts.${camelAllDay}) {`)
        if (optDef.exclusive) {
          conversionLines.push(`        ${valueVar} = inclusiveEndToExclusive(opts.${camelKey} as string)`)
        } else {
          conversionLines.push(`        ${valueVar} = parseDateOnly(opts.${camelKey} as string)`)
        }
        conversionLines.push(`      } else {`)
        conversionLines.push(`        ${valueVar} = parseTimeInput(opts.${camelKey} as string, zone).toISO() ?? undefined`)
        conversionLines.push(`      }`)
      } else {
        conversionLines.push(`      ${valueVar} = parseTimeInput(opts.${camelKey} as string, zone).toISO() ?? undefined`)
      }
      conversionLines.push(`    }`)
    } else if (optDef.parser === "attendee") {
      const camelKey = camelize(kebab(optKey))
      const target = optDef.mapsTo ?? optKey
      const targetVar = snakeToCamel(target)
      // Array accumulator default is [], so the value is always a string[];
      // no ?.length guard needed.
      const rawVar = `${camelKey}Raw`
      conversionLines.push(
        `    const ${rawVar} = opts.${camelKey} as string[]`,
        `    const ${targetVar} = ${rawVar}.length > 0 ? ${rawVar}.map(parseAttendee) : undefined`,
      )
    } else if (optDef.array && !optDef.parser) {
      const camelKey = camelize(kebab(optKey))
      const target = optDef.mapsTo ?? optKey
      const targetVar = snakeToCamel(target)
      const rawVar = `${camelKey}Raw`
      // Variadic positional: commander hands us `string[]` directly in the
      // action's argument. Flag accumulator: read off `opts.<key>`.
      const source = variadicPositionalSet.has(optKey) ? camelKey : `opts.${camelKey}`
      conversionLines.push(
        `    const ${rawVar} = ${source} as string[]`,
        `    const ${targetVar} = ${rawVar}.length > 0 ? ${rawVar} : undefined`,
      )
    }
  }

  const exitOnField = input.xCli.exitOnField
  const exitLines: string[] = []
  if (exitOnField) {
    const pathParts = (exitOnField.path || "").split(".").filter((p) => p.trim() !== "")
    const accessExpr = pathParts.length > 0 ? `result.data?.${pathParts.join("?.")}` : `result.data`
    exitLines.push(
      `    if (${accessExpr} === ${JSON.stringify(exitOnField.failOn)}) {`,
      `      process.exit(1)`,
      `    }`,
    )
  }

  // Build import list — only include helpers actually used.
  const imports: string[] = [
    `import { Command } from "commander"`,
    `import { ${fnName} } from "${sdkRelPrefix}sdk/index.js"`,
    `import { loadSdkClient } from "${handwrittenRelPrefix}handwritten/auth/load-sdk-client.js"`,
    `import { render } from "${handwrittenRelPrefix}handwritten/output/render.js"`,
  ]
  if (hasDatetimeParser) {
    imports.push(
      `import { parseTimeInput, resolveTimezone } from "${handwrittenRelPrefix}handwritten/utils/parse-time.js"`,
    )
  }
  const dateImports: string[] = []
  if (usesParseDateOnly) dateImports.push("parseDateOnly")
  if (usesInclusiveEndToExclusive) dateImports.push("inclusiveEndToExclusive")
  if (dateImports.length > 0) {
    imports.push(
      `import { ${dateImports.join(", ")} } from "${handwrittenRelPrefix}handwritten/utils/parse-date.js"`,
    )
  }
  if (hasAttendeeParser) {
    imports.push(
      `import { parseAttendee } from "${handwrittenRelPrefix}handwritten/utils/parse-attendee.js"`,
    )
  }

  return [
    `// AUTO-GENERATED — DO NOT EDIT (source: ${input.operationId})`,
    ...imports,
    ``,
    `export const ${fnName}Command = new Command(${JSON.stringify(cmdLeaf)})`,
    `  .description(${JSON.stringify(input.summary ?? input.xCli.command)})`,
    ...args.map((a) => `  ${a}`),
    ...options.map((o) => `  ${o}`),
    `  .action(async (${[...argNames, "opts"].join(", ")}) => {`,
    ...conversionLines,
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
    `    render({ kind: ${JSON.stringify(kind)}, display: ${displayLiteral} }, result.data)`,
    ...exitLines,
    `  })`,
    ``,
  ].join("\n")
}
