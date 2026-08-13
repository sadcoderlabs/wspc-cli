import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DateTime } from "luxon"

// Mock the SDK functions before importing the commands. The generated event
// commands import these from "../../sdk/index.js" relative to their own
// location; from this test file (and after vitest module resolution), the
// canonical path is "../src/generated/sdk/index.js".
vi.mock("../../src/generated/sdk/index.js", () => ({
  eventCreate: vi.fn(async () => ({ data: { id: "evt_1" }, response: { ok: true, status: 200 } })),
  eventList: vi.fn(async () => ({ data: { items: [] }, response: { ok: true, status: 200 } })),
  eventIcsDownload: vi.fn(async () => ({ data: "BEGIN:VCALENDAR", response: { ok: true, status: 200 } })),
  eventGet: vi.fn(async () => ({ data: {}, response: { ok: true, status: 200 } })),
  eventUpdate: vi.fn(async () => ({ data: {}, response: { ok: true, status: 200 } })),
  eventDelete: vi.fn(async () => ({ data: {}, response: { ok: true, status: 200 } })),
}))

// Mock loadSdkClient so commands don't try to read config / network.
vi.mock("../../src/handwritten/auth/load-sdk-client.js", () => ({
  loadSdkClient: vi.fn(async () => ({ _rawClient: {} })),
}))

// Mock render so we don't write to stdout during tests.
vi.mock("../../src/handwritten/output/render.js", () => ({
  render: vi.fn(),
}))

const ZONE = "Asia/Taipei"

// Each test re-imports commands via vi.resetModules() to reset Commander option defaults.
async function loadCommands() {
  vi.resetModules()
  const add = await import("../../src/generated/cli/event/add.js")
  const set = await import("../../src/generated/cli/event/set.js")
  const ls = await import("../../src/generated/cli/event/ls.js")
  const ics = await import("../../src/generated/cli/event/ics.js")
  const sdk = await import("../../src/generated/sdk/index.js")
  return {
    eventCreateCommand: add.eventCreateCommand,
    eventUpdateCommand: set.eventUpdateCommand,
    eventListCommand: ls.eventListCommand,
    eventIcsDownloadCommand: ics.eventIcsDownloadCommand,
    eventCreate: sdk.eventCreate as ReturnType<typeof vi.fn>,
    eventUpdate: sdk.eventUpdate as ReturnType<typeof vi.fn>,
    eventList: sdk.eventList as ReturnType<typeof vi.fn>,
    eventIcsDownload: sdk.eventIcsDownload as ReturnType<typeof vi.fn>,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WSPC_TZ = ZONE
  // Fix "now" so chrono's "tomorrow"/"today"/"next week" are deterministic.
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-05-27T03:00:00Z"))
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.WSPC_TZ
})

describe("event add", () => {
  it("parses --start \"tomorrow 10am\" into ISO 8601 with zone offset, hour 10 in that zone", async () => {
    const { eventCreateCommand, eventCreate } = await loadCommands()
    await eventCreateCommand.parseAsync([
      "node", "add",
      "Meeting",
      "--start", "tomorrow 10am",
    ])
    expect(eventCreate).toHaveBeenCalledTimes(1)
    const call = eventCreate.mock.calls[0]![0]
    const startIso = call.body.start as string
    const dt = DateTime.fromISO(startIso, { setZone: true })
    expect(dt.isValid).toBe(true)
    expect(dt.setZone(ZONE).hour).toBe(10)
    // Offset must match the resolved zone (Asia/Taipei = +08:00, no DST)
    expect(dt.offset).toBe(DateTime.now().setZone(ZONE).offset)
  })

  it("encodes --all-day with inclusive end date as date-only strings (end +1 exclusive)", async () => {
    const { eventCreateCommand, eventCreate } = await loadCommands()
    await eventCreateCommand.parseAsync([
      "node", "add",
      "Trip",
      "--all-day",
      "--start", "2026-05-10",
      "--end", "2026-05-12",
    ])
    const call = eventCreate.mock.calls[0]![0]
    expect(call.body.start).toBe("2026-05-10")
    expect(call.body.end).toBe("2026-05-13")
  })

  it("collects multiple --attendee flags and parses display name / email", async () => {
    const { eventCreateCommand, eventCreate } = await loadCommands()
    await eventCreateCommand.parseAsync([
      "node", "add",
      "Lunch",
      "--start", "2026-05-10T12:00:00+08:00",
      "--attendee", "Alice <a@x>",
      "--attendee", "b@y",
    ])
    const call = eventCreate.mock.calls[0]![0]
    expect(call.body.attendees).toEqual([
      { email: "a@x", display_name: "Alice" },
      { email: "b@y" },
    ])
  })

  it("passes a literal --rrule value as recurrence_rule", async () => {
    const { eventCreateCommand, eventCreate } = await loadCommands()
    await eventCreateCommand.parseAsync([
      "node",
      "add",
      "Office days",
      "--all-day",
      "--start",
      "2026-08-17",
      "--end",
      "2026-08-17",
      "--rrule",
      "FREQ=WEEKLY;BYDAY=MO,WE",
    ])

    expect(eventCreate.mock.calls[0]![0].body).toMatchObject({
      start: "2026-08-17",
      end: "2026-08-18",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,WE",
    })
  })

  it("converts timed recurrence endpoints to UTC", async () => {
    const { eventCreateCommand, eventCreate } = await loadCommands()
    await eventCreateCommand.parseAsync([
      "node",
      "add",
      "Office hours",
      "--start",
      "tomorrow 10am",
      "--end",
      "tomorrow 11am",
      "--rrule",
      "FREQ=WEEKLY;BYDAY=FR",
    ])

    expect(eventCreate.mock.calls[0]![0].body).toMatchObject({
      start: "2026-05-28T02:00:00.000Z",
      end: "2026-05-28T03:00:00.000Z",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=FR",
    })
  })
})

describe("event set", () => {
  it("preserves an empty --rrule value for recurrence clearing", async () => {
    const { eventUpdateCommand, eventUpdate } = await loadCommands()
    await eventUpdateCommand.parseAsync(["node", "set", "evt_1", "--rrule", ""])

    expect(eventUpdate.mock.calls[0]![0]).toMatchObject({
      path: { id: "evt_1" },
      body: { recurrence_rule: "" },
    })
  })
})

describe("event ls", () => {
  it("renames --from / --to to query.start_from / query.start_to and emits ISO strings", async () => {
    const { eventListCommand, eventList } = await loadCommands()
    await eventListCommand.parseAsync([
      "node", "ls",
      "--from", "today",
      "--to", "next week",
    ])
    const call = eventList.mock.calls[0]![0]
    // Field renames: from -> start_from, to -> start_to
    expect(call.query.start_from).toBeDefined()
    expect(call.query.start_to).toBeDefined()
    expect(call.query).not.toHaveProperty("from")
    expect(call.query).not.toHaveProperty("to")
    // Values are ISO 8601 strings parseable by Luxon with explicit offset.
    const from = DateTime.fromISO(call.query.start_from as string, { setZone: true })
    const to = DateTime.fromISO(call.query.start_to as string, { setZone: true })
    expect(from.isValid).toBe(true)
    expect(to.isValid).toBe(true)
    // Frozen "now" = 2026-05-27T03:00:00Z = 2026-05-27T11:00:00+08:00,
    // so "today" in Asia/Taipei is 2026-05-27.
    expect(from.setZone(ZONE).toISODate()).toBe("2026-05-27")
    // "next week" should land roughly 7 days out — guard against chrono regressions.
    expect(to.diff(from, "days").days).toBeGreaterThanOrEqual(6)
  })
})

describe("event ics", () => {
  it("passes id as filename (id + .ics suffix), NOT as bare id", async () => {
    const { eventIcsDownloadCommand, eventIcsDownload } = await loadCommands()
    await eventIcsDownloadCommand.parseAsync([
      "node", "ics",
      "evt_xyz",
    ])
    const call = eventIcsDownload.mock.calls[0]![0]
    expect(call.path.filename).toBe("evt_xyz.ics")
    expect(call.path).not.toHaveProperty("id")
  })
})
