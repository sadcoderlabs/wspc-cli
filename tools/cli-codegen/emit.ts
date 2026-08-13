export interface XCliDisplay {
  shape?: "list" | "object" | "scalar"
  columns?: string[]
  fields?: string[]
  format?: Record<string, string>
  emptyMessage?: string
}

export interface XCliOption {
  parser?: "datetime" | "occurrence-boundary" | "attendee" | "series-time-zone"
  required?: boolean
  array?: boolean
  mapsTo?: string
  allDayFlag?: string
  exclusive?: boolean
  utcWhenPresent?: string
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
  fixedQuery?: Record<string, string>
  booleanFlags?: string[]
}

export interface BodyField {
  name: string
  type: "string" | "integer" | "number" | "boolean" | "array" | "object"
  required: boolean
  description?: string
  boolFlag?: boolean
}

export interface EmitInput {
  operationId: string
  method: string
  path: string
  summary?: string
  description?: string
  xCli: XCli
  bodyFields: BodyField[]
  pathParams?: string[]
  queryFields?: BodyField[]
  /** Number of directory segments in the output file path (e.g. "todo/add.ts" → depth 2) */
  depth?: number
}

function leafCommand(cmd: string): string {
  const parts = cmd.split(/\s+/)
  return parts[parts.length - 1]!
}

export function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function kebab(s: string): string {
  return s.replace(/_/g, "-")
}

function kebabToCamel(kebabStr: string): string {
  return kebabStr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function timedConversionLines(
  valueVar: string,
  camelKey: string,
  utcWhenPresent: string | undefined,
  indent: string,
  explicitSeriesTimeZone?: string,
): string[] {
  const parseExpression = `parseTimeInput(opts.${camelKey} as string, zone)`
  if (!utcWhenPresent) {
    return [`${indent}${valueVar} = ${parseExpression}.toISO() ?? undefined`]
  }

  const dateTimeVar = `${camelKey}DateTime`
  const camelCondition = kebabToCamel(kebab(utcWhenPresent))
  const condition = explicitSeriesTimeZone
    ? `opts.${camelCondition} !== undefined && !${explicitSeriesTimeZone}`
    : `opts.${camelCondition} !== undefined`
  return [
    `${indent}const ${dateTimeVar} = ${parseExpression}`,
    `${indent}${valueVar} = (${condition} ? ${dateTimeVar}.toUTC() : ${dateTimeVar}).toISO() ?? undefined`,
  ]
}

export function emitCommand(input: EmitInput): string | null {
  if (input.xCli.hidden) return null
  const fnName = snakeToCamel(input.operationId)
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
    input.operationId === "event_ics_download" ? [] : pathParams.filter((p) => !explicitPositional.includes(p))
  const positional = [...explicitPositional, ...autoPathPositional]
  const aliases = input.xCli.aliases ?? {}
  const queryFields = input.queryFields ?? []
  const xCliOptions = input.xCli.options ?? {}
  const seriesTimeZoneEntry = Object.entries(xCliOptions).find(([, option]) => option.parser === "series-time-zone")
  const seriesTimeZoneOptionKey = seriesTimeZoneEntry?.[0]
  const recurrenceOptionKey = Object.entries(xCliOptions).find(
    ([key, option]) => (option.mapsTo ?? key) === "recurrence_rule",
  )?.[0]
  const hasSeriesTimeZoneParser = seriesTimeZoneOptionKey !== undefined

  // Find the alias entry for a field: alias key can be exact field name, its kebab,
  // or a prefix segment (e.g. alias key "project" covers field "project_id").
  function resolveAlias(fieldName: string): {
    longFlag: string
    short?: string
  } {
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
  const hasDatetimeParser = Object.values(xCliOptions).some(
    (o) => o.parser === "datetime" || o.parser === "occurrence-boundary",
  )
  const usesParseTimeInput = Object.values(xCliOptions).some((o) => o.parser === "datetime")
  const hasOccurrenceBoundaryParser = Object.values(xCliOptions).some((o) => o.parser === "occurrence-boundary")
  const hasAttendeeParser = Object.values(xCliOptions).some((o) => o.parser === "attendee")
  const usesParseDateOnly = Object.values(xCliOptions).some((o) => o.parser === "datetime" && o.allDayFlag)
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
  const variadicPositionalSet = new Set(positional.filter((p) => xCliOptions[p]?.array === true))

  function scalarParserName(
    field: BodyField,
  ): "parseIntegerField" | "parseNumberField" | "parseBooleanField" | undefined {
    if (field.boolFlag) return undefined
    const optKey = fieldToOptionKey[field.name]
    const optDef = optKey === undefined ? undefined : xCliOptions[optKey]
    if (optDef?.array || optDef?.parser) return undefined
    if (field.type === "integer") return "parseIntegerField"
    if (field.type === "number") return "parseNumberField"
    if (field.type === "boolean") return "parseBooleanField"
    return undefined
  }

  function scalarParserArgument(field: BodyField, longFlag: string): string {
    const parserName = scalarParserName(field)
    if (parserName === undefined) return ""
    return `, (value: string) => ${parserName}(value, ${JSON.stringify(longFlag)})`
  }

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

  function emitFieldOption(f: BodyField, enforceRequired = false): string {
    if (f.boolFlag) {
      const { longFlag, short } = resolveAlias(f.name)
      const flagSpec = short ? `-${short}, --${longFlag}` : `--${longFlag}`
      return `.option("${flagSpec}", ${JSON.stringify(f.description ?? f.name)})`
    }
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
      const method = enforceRequired && optDef.required ? "requiredOption" : "option"
      return `.${method}("${flagSpec}", ${optLabel}${scalarParserArgument(f, longFlag)})`
    }
    const { longFlag, short } = resolveAlias(f.name)
    const flagSpec = short ? `-${short}, --${longFlag} <value>` : `--${longFlag} <value>`
    // Prefer the field's OpenAPI description so `--help` carries real guidance;
    // fall back to the field name. JSON.stringify keeps quotes/newlines safe.
    const method = "option"
    return `.${method}("${flagSpec}", ${JSON.stringify(f.description ?? f.name)}${scalarParserArgument(f, longFlag)})`
  }

  // Skip body fields whose x-cli option key has been promoted to a variadic
  // positional — those values come in via .argument(<name...>), not a flag.
  function bodyFieldOwnedByVariadicPositional(f: BodyField): boolean {
    const optKey = fieldToOptionKey[f.name]
    return optKey !== undefined && variadicPositionalSet.has(optKey)
  }

  // Options from body fields (skip positional and path params)
  const bodyOptionFields = input.bodyFields.filter(
    (f) => !positionalSet.has(f.name) && !pathParamSet.has(f.name) && !bodyFieldOwnedByVariadicPositional(f),
  )
  const bodyOptions = bodyOptionFields.map((field) => emitFieldOption(field))

  // fixedQuery keys win over same-named query fields — suppress the dynamic field
  // from both the options list and the query block to avoid duplicate object keys.
  const fixedQueryKeys = new Set(Object.keys(input.xCli.fixedQuery ?? {}))

  // Options from query fields (skip positional, path params, and fixedQuery-shadowed fields)
  const queryOptionFields = queryFields.filter(
    (f) => !positionalSet.has(f.name) && !pathParamSet.has(f.name) && !fixedQueryKeys.has(f.name),
  )
  const queryOptions = queryOptionFields.map((field) => emitFieldOption(field, true))

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
  const tzOption =
    hasDatetimeParser && !hasSeriesTimeZoneParser
      ? [`.option("--tz <zone>", "IANA timezone for relative time parsing")`]
      : []

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
    const camelKey = kebabToCamel(kebab(optKey))
    if (optDef.parser === "datetime" || optDef.parser === "occurrence-boundary") {
      return `${camelKey}Value`
    }
    if (optDef.parser === "attendee") {
      const target = optDef.mapsTo ?? optKey
      return snakeToCamel(target)
    }
    if (optDef.parser === "series-time-zone") {
      return "seriesTimeZoneValue"
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
        const castType = optDef.array
          ? "string[]"
          : f.type === "integer" || f.type === "number"
            ? "number"
            : f.type === "boolean"
              ? "boolean"
              : "string"
        const suffix = f.required ? ` as ${castType}` : ""
        return `        ${f.name}: ${expr}${suffix},`
      }
      const { longFlag } = resolveAlias(f.name)
      // Object/array body fields arrive from commander as raw strings; JSON.parse
      // them so the SDK receives a record/array rather than a string (otherwise
      // the server rejects with e.g. "expected record, received string").
      if (f.type === "object" || f.type === "array") {
        return `        ${f.name}: parseJsonField(opts.${kebabToCamel(longFlag)}, ${JSON.stringify(longFlag)}),`
      }
      return `        ${f.name}: opts.${kebabToCamel(longFlag)},`
    })
  const usesJsonField = input.bodyFields.some(
    (f) =>
      !positionalSet.has(f.name) &&
      !pathParamSet.has(f.name) &&
      fieldToOptionKey[f.name] === undefined &&
      (f.type === "object" || f.type === "array"),
  )
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
      bodyBlock = [`      body: {`, ...bodyPositionals.map((p) => `        ${p},`), ...bodyOptLines, `      },`]
    }
  }

  // Build query block (dynamic query fields + constant fixedQuery).
  const queryOptLines = queryFields
    .filter((f) => !positionalSet.has(f.name) && !pathParamSet.has(f.name) && !fixedQueryKeys.has(f.name))
    .map((f) => {
      const optKey = fieldToOptionKey[f.name]
      if (optKey !== undefined) {
        return `        ${f.name}: ${valueExprForOption(optKey)},`
      }
      const { longFlag } = resolveAlias(f.name)
      return `        ${f.name}: opts.${kebabToCamel(longFlag)},`
    })
  const fixedQueryLines = Object.entries(input.xCli.fixedQuery ?? {}).map(
    ([k, v]) => `        ${k}: ${JSON.stringify(v)},`,
  )
  const allQueryLines = [...queryOptLines, ...fixedQueryLines]
  const queryBlock = allQueryLines.length > 0 ? [`      query: {`, ...allQueryLines, `      },`] : []

  // `kind` is the renderer registry key. We use the operationId verbatim so
  // every operation has a unique, stable identifier — handwritten renderers
  // register under the same string. Embedding `display` inline keeps the
  // generated file self-contained (no JSON-file reads at startup).
  const kind = input.operationId
  const displayLiteral = input.xCli.display ? JSON.stringify(input.xCli.display) : "undefined"

  // Emit parser conversion block at top of action body.
  const conversionLines: string[] = []
  if (hasSeriesTimeZoneParser && seriesTimeZoneOptionKey && recurrenceOptionKey) {
    const timeZoneCamel = kebabToCamel(kebab(seriesTimeZoneOptionKey))
    const recurrenceCamel = kebabToCamel(kebab(recurrenceOptionKey))
    if (input.operationId === "event_update") {
      conversionLines.push(
        `    let existingRecurringSeries = false`,
        `    if (opts.${timeZoneCamel} !== undefined && opts.${timeZoneCamel} !== "" && opts.${recurrenceCamel} === undefined) {`,
        `      const existingEvent = await runSdkCommand({`,
        `        operation: eventGet,`,
        `        input: { path: { id } },`,
        `        context: { kind: "event_get", display: undefined },`,
        `        renderResult: false,`,
        `      })`,
        `      if (existingEvent === undefined) return`,
        `      existingRecurringSeries = existingEvent.recurrence_rule !== undefined`,
        `    }`,
        `    const recurringWithTimeZone = opts.${recurrenceCamel} !== undefined ? opts.${recurrenceCamel} !== "" : existingRecurringSeries`,
      )
    } else {
      conversionLines.push(
        `    const recurringWithTimeZone = opts.${recurrenceCamel} !== undefined && opts.${recurrenceCamel} !== ""`,
      )
    }
    conversionLines.push(
      `    const explicitSeriesTimeZone = opts.${timeZoneCamel} !== undefined && opts.${timeZoneCamel} !== "" && recurringWithTimeZone`,
      input.operationId === "event_update"
        ? `    const seriesTimeZoneValue = opts.${timeZoneCamel} === "" ? "" : explicitSeriesTimeZone ? opts.${timeZoneCamel} : undefined`
        : `    const seriesTimeZoneValue = explicitSeriesTimeZone ? opts.${timeZoneCamel} : undefined`,
    )
  }
  if (hasDatetimeParser) {
    conversionLines.push(
      hasSeriesTimeZoneParser
        ? `    const zone = resolveTimezone(opts.tz === "" ? undefined : (opts.tz as string | undefined))`
        : `    const zone = resolveTimezone(opts.tz as string | undefined)`,
    )
  }
  for (const [optKey, optDef] of Object.entries(xCliOptions)) {
    if (optDef.parser === "occurrence-boundary") {
      const camelKey = kebabToCamel(kebab(optKey))
      const valueVar = `${camelKey}Value`
      const target = optDef.mapsTo ?? optKey
      const required = optDef.required === true
      if (required) {
        conversionLines.push(
          `    const ${valueVar} = parseOccurrenceBoundary(opts.${camelKey} as string, zone)`,
        )
      } else {
        conversionLines.push(`    let ${valueVar}: string | undefined`)
        conversionLines.push(`    if (opts.${camelKey} !== undefined) {`)
        conversionLines.push(`      ${valueVar} = parseOccurrenceBoundary(opts.${camelKey} as string, zone)`)
        conversionLines.push(`    }`)
      }
    } else if (optDef.parser === "datetime") {
      const camelKey = kebabToCamel(kebab(optKey))
      const valueVar = `${camelKey}Value`
      conversionLines.push(`    let ${valueVar}: string | undefined`)
      conversionLines.push(`    if (opts.${camelKey} !== undefined) {`)
      if (optDef.allDayFlag) {
        const camelAllDay = kebabToCamel(kebab(optDef.allDayFlag))
        conversionLines.push(`      if (opts.${camelAllDay}) {`)
        if (optDef.exclusive) {
          conversionLines.push(`        ${valueVar} = inclusiveEndToExclusive(opts.${camelKey} as string)`)
        } else {
          conversionLines.push(`        ${valueVar} = parseDateOnly(opts.${camelKey} as string)`)
        }
        conversionLines.push(`      } else {`)
        conversionLines.push(
          ...timedConversionLines(
            valueVar,
            camelKey,
            optDef.utcWhenPresent,
            "        ",
            hasSeriesTimeZoneParser ? "explicitSeriesTimeZone" : undefined,
          ),
        )
        conversionLines.push(`      }`)
      } else {
        conversionLines.push(
          ...timedConversionLines(
            valueVar,
            camelKey,
            optDef.utcWhenPresent,
            "      ",
            hasSeriesTimeZoneParser ? "explicitSeriesTimeZone" : undefined,
          ),
        )
      }
      conversionLines.push(`    }`)
    } else if (optDef.parser === "attendee") {
      const camelKey = kebabToCamel(kebab(optKey))
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
      const camelKey = kebabToCamel(kebab(optKey))
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
    const accessExpr = pathParts.length > 0 ? `data?.${pathParts.join("?.")}` : `data`
    exitLines.push(
      `    if (${accessExpr} === ${JSON.stringify(exitOnField.failOn)}) {`,
      `      process.exitCode = 1`,
      `    }`,
    )
  }

  // Build import list — only include helpers actually used.
  const imports: string[] = [
    `import { Command } from "commander"`,
    `import { ${[fnName, ...(input.operationId === "event_update" && hasSeriesTimeZoneParser ? ["eventGet"] : [])].join(", ")} } from "${sdkRelPrefix}sdk/index.js"`,
    `import { runSdkCommand } from "${handwrittenRelPrefix}handwritten/commands/run-sdk-command.js"`,
  ]
  if (hasDatetimeParser) {
    imports.push(
      `import { ${[...(usesParseTimeInput ? ["parseTimeInput"] : []), "resolveTimezone", ...(hasOccurrenceBoundaryParser ? ["parseOccurrenceBoundary"] : [])].join(", ")} } from "${handwrittenRelPrefix}handwritten/utils/parse-time.js"`,
    )
  }
  const dateImports: string[] = []
  if (usesParseDateOnly) dateImports.push("parseDateOnly")
  if (usesInclusiveEndToExclusive) dateImports.push("inclusiveEndToExclusive")
  if (dateImports.length > 0) {
    imports.push(`import { ${dateImports.join(", ")} } from "${handwrittenRelPrefix}handwritten/utils/parse-date.js"`)
  }
  if (hasAttendeeParser) {
    imports.push(`import { parseAttendee } from "${handwrittenRelPrefix}handwritten/utils/parse-attendee.js"`)
  }
  if (usesJsonField) {
    imports.push(`import { parseJsonField } from "${handwrittenRelPrefix}handwritten/utils/parse-json-field.js"`)
  }
  const scalarParserImports = ["parseIntegerField", "parseNumberField", "parseBooleanField"].filter((parserName) =>
    [...bodyOptionFields, ...queryOptionFields].some((field) => scalarParserName(field) === parserName),
  )
  if (scalarParserImports.length > 0) {
    imports.push(
      `import { ${scalarParserImports.join(", ")} } from "${handwrittenRelPrefix}handwritten/utils/parse-scalar-field.js"`,
    )
  }

  let helpTextCall = ""
  const helpParts: string[] = []
  if (input.description) {
    helpParts.push(input.description)
  }
  if (input.xCli.examples && input.xCli.examples.length > 0) {
    helpParts.push("Examples:\n" + input.xCli.examples.map((ex) => `  $ ${ex}`).join("\n"))
  }
  if (helpParts.length > 0) {
    helpTextCall = `\n  .addHelpText("after", ${JSON.stringify("\n" + helpParts.join("\n\n") + "\n")})`
  }

  return [
    `// AUTO-GENERATED — DO NOT EDIT (source: ${input.operationId})`,
    ...imports,
    ``,
    `export const ${fnName}Command = new Command(${JSON.stringify(cmdLeaf)})`,
    `  .description(${JSON.stringify(input.summary ?? input.xCli.command)})${helpTextCall}`,
    ...args.map((a) => `  ${a}`),
    ...options.map((o) => `  ${o}`),
    `  .action(async (${[...argNames, "opts"].join(", ")}) => {`,
    ...conversionLines,
    `    ${exitOnField ? "const data = " : ""}await runSdkCommand({`,
    `      operation: ${fnName},`,
    `      input: {`,
    ...[...pathBlock, ...bodyBlock, ...queryBlock].map((line) => `  ${line}`),
    `      },`,
    `      context: { kind: ${JSON.stringify(kind)}, display: ${displayLiteral} },`,
    `    })`,
    ...exitLines,
    `  })`,
    ``,
  ].join("\n")
}
