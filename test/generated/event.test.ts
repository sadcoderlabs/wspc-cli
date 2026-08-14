import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DateTime } from "luxon"

// Mock the SDK functions before importing the commands. The generated event
// commands import these from "../../sdk/index.js" relative to their own
// location; from this test file (and after vitest module resolution), the
// canonical path is "../src/generated/sdk/index.js".
vi.mock("../../src/generated/sdk/index.js", () => ({
  eventCreate: vi.fn(async () => ({
    data: { id: "evt_1" },
    response: { ok: true, status: 200 },
  })),
  eventList: vi.fn(async () => ({
    data: { items: [] },
    response: { ok: true, status: 200 },
  })),
  eventOccurrences: vi.fn(async () => ({
    data: { occurrences: [] },
    response: { ok: true, status: 200 },
  })),
  eventAgenda: vi.fn(async () => ({
    data: { items: [], view_time_zone: "UTC" },
    response: { ok: true, status: 200 },
  })),
  eventIcsDownload: vi.fn(async () => ({
    data: "BEGIN:VCALENDAR",
    response: { ok: true, status: 200 },
  })),
  eventGet: vi.fn(async () => ({
    data: {},
    response: { ok: true, status: 200 },
  })),
  eventUpdate: vi.fn(async () => ({
    data: {},
    response: { ok: true, status: 200 },
  })),
  eventDelete: vi.fn(async () => ({
    data: {},
    response: { ok: true, status: 200 },
  })),
  eventOccurrenceSet: vi.fn(async () => ({
    data: {},
    response: { ok: true, status: 200 },
  })),
  eventOccurrenceCancel: vi.fn(async () => ({
    data: {},
    response: { ok: true, status: 200 },
  })),
  eventOccurrenceRestore: vi.fn(async () => ({
    data: {},
    response: { ok: true, status: 200 },
  })),
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
  const occurrences = await import("../../src/generated/cli/event/occurrences.js")
  const agenda = await import("../../src/generated/cli/event/agenda.js")
  const occurrenceSet = await import("../../src/generated/cli/event/occurrence/set.js")
  const occurrenceCancel = await import("../../src/generated/cli/event/occurrence/cancel.js")
  const occurrenceRestore = await import("../../src/generated/cli/event/occurrence/restore.js")
  const sdk = await import("../../src/generated/sdk/index.js")
  return {
    eventCreateCommand: add.eventCreateCommand,
    eventUpdateCommand: set.eventUpdateCommand,
    eventListCommand: ls.eventListCommand,
    eventIcsDownloadCommand: ics.eventIcsDownloadCommand,
    eventOccurrencesCommand: occurrences.eventOccurrencesCommand,
    eventAgendaCommand: agenda.eventAgendaCommand,
    eventOccurrenceSetCommand: occurrenceSet.eventOccurrenceSetCommand,
    eventOccurrenceCancelCommand: occurrenceCancel.eventOccurrenceCancelCommand,
    eventOccurrenceRestoreCommand: occurrenceRestore.eventOccurrenceRestoreCommand,
    eventCreate: sdk.eventCreate as ReturnType<typeof vi.fn>,
    eventUpdate: sdk.eventUpdate as ReturnType<typeof vi.fn>,
    eventGet: sdk.eventGet as ReturnType<typeof vi.fn>,
    eventList: sdk.eventList as ReturnType<typeof vi.fn>,
    eventIcsDownload: sdk.eventIcsDownload as ReturnType<typeof vi.fn>,
    eventOccurrences: sdk.eventOccurrences as ReturnType<typeof vi.fn>,
    eventAgenda: sdk.eventAgenda as ReturnType<typeof vi.fn>,
    eventOccurrenceSet: sdk.eventOccurrenceSet as ReturnType<typeof vi.fn>,
    eventOccurrenceCancel: sdk.eventOccurrenceCancel as ReturnType<typeof vi.fn>,
    eventOccurrenceRestore: sdk.eventOccurrenceRestore as ReturnType<typeof vi.fn>,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WSPC_TZ = ZONE
  // Fix "now" so chrono's "tomorrow"/"today"/"next week" are deterministic.
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-05-27T03:00:00Z"))
})

describe("event occurrences", () => {
  it("preserves date-only boundaries and forwards pagination", async () => {
    const { eventOccurrencesCommand, eventOccurrences } = await loadCommands()
    await eventOccurrencesCommand.parseAsync([
      "node",
      "occurrences",
      "evt_1",
      "--from",
      "2026-06-01",
      "--to",
      "2026-07-01",
      "--limit",
      "25",
      "--cursor",
      "next-page",
      "--tz",
      "America/New_York",
    ])

    expect(eventOccurrences).toHaveBeenCalledWith({
      client: expect.anything(),
      path: { id: "evt_1" },
      query: {
        start: "2026-06-01",
        end: "2026-07-01",
        limit: 25,
        cursor: "next-page",
        include_cancelled: undefined,
      },
    })
  })

  it("requires both window boundaries before making a request", async () => {
    const { eventOccurrencesCommand, eventOccurrences } = await loadCommands()
    eventOccurrencesCommand.exitOverride()

    await expect(
      eventOccurrencesCommand.parseAsync(["node", "occurrences", "evt_1", "--from", "2026-06-01"]),
    ).rejects.toMatchObject({ code: "commander.missingMandatoryOptionValue" })
    expect(eventOccurrences).not.toHaveBeenCalled()
  })

  it("uses --tz only to parse timed boundaries", async () => {
    const { eventOccurrencesCommand, eventOccurrences } = await loadCommands()
    await eventOccurrencesCommand.parseAsync([
      "node",
      "occurrences",
      "evt_1",
      "--from",
      "2026-11-01 9am",
      "--to",
      "2026-11-08 9am",
      "--tz",
      "America/New_York",
    ])
    expect(eventOccurrences.mock.calls[0]![0].query).toMatchObject({
      start: "2026-11-01T09:00:00.000-05:00",
      end: "2026-11-08T09:00:00.000-05:00",
    })
    expect(eventOccurrences.mock.calls[0]![0].query.time_zone).toBeUndefined()
  })

  it("forwards --include-cancelled", async () => {
    const { eventOccurrencesCommand, eventOccurrences } = await loadCommands()
    await eventOccurrencesCommand.parseAsync([
      "node",
      "occurrences",
      "evt_1",
      "--from",
      "2026-06-01",
      "--to",
      "2026-07-01",
      "--include-cancelled",
    ])
    expect(eventOccurrences.mock.calls[0]![0].query.include_cancelled).toBe(true)
  })
})

describe("event occurrence mutations", () => {
  it("requires both reschedule boundaries before reading the series master", async () => {
    const { eventOccurrenceSetCommand, eventOccurrenceSet, eventGet } = await loadCommands()
    eventOccurrenceSetCommand.exitOverride()

    await expect(
      eventOccurrenceSetCommand.parseAsync([
        "node",
        "set",
        "evt_1",
        "2026-06-01",
        "--start",
        "2026-06-02",
      ]),
    ).rejects.toMatchObject({ code: "commander.missingMandatoryOptionValue" })
    expect(eventGet).not.toHaveBeenCalled()
    expect(eventOccurrenceSet).not.toHaveBeenCalled()
  })

  it("sends all-day occurrence boundaries as unchanged Exclusive End dates", async () => {
    const { eventOccurrenceSetCommand, eventOccurrenceSet, eventGet } = await loadCommands()
    eventGet.mockResolvedValueOnce({
      data: { all_day: true },
      response: { ok: true, status: 200 },
    })

    await eventOccurrenceSetCommand.parseAsync([
      "node",
      "set",
      "evt_1",
      "2026-06-01",
      "--start",
      "2026-06-02",
      "--end",
      "2026-06-03",
      "--expected-version",
      "2",
    ])

    expect(eventOccurrenceSet).toHaveBeenCalledWith({
      client: expect.anything(),
      path: { series_id: "evt_1", recurrence_id: "2026-06-01" },
      body: {
        start: "2026-06-02",
        end: "2026-06-03",
        expected_version: 2,
      },
    })
  })

  it("requires start/end and parses UTC times after reading the series master", async () => {
    const { eventOccurrenceSetCommand, eventOccurrenceSet, eventGet } = await loadCommands()
    eventGet.mockResolvedValueOnce({
      data: { all_day: false, time_zone: "UTC" },
      response: { ok: true, status: 200 },
    })
    await eventOccurrenceSetCommand.parseAsync([
      "node",
      "set",
      "evt_1",
      "2026-06-01T09:00:00Z",
      "--start",
      "tomorrow 10am",
      "--end",
      "tomorrow 11am",
      "--expected-version",
      "2",
    ])
    expect(eventGet).toHaveBeenCalledWith(expect.objectContaining({ path: { id: "evt_1" } }))
    expect(eventOccurrenceSet).toHaveBeenCalledWith({
      client: expect.anything(),
      path: { series_id: "evt_1", recurrence_id: "2026-06-01T09:00:00Z" },
      body: {
        start: "2026-05-28T10:00:00.000Z",
        end: "2026-05-28T11:00:00.000Z",
        expected_version: 2,
      },
    })
  })

  it("keeps local wall-clock offsets and rejects a mismatched --tz", async () => {
    const { eventOccurrenceSetCommand, eventOccurrenceSet, eventGet } = await loadCommands()
    eventGet.mockResolvedValue({
      data: { all_day: false, time_zone: "America/New_York" },
      response: { ok: true, status: 200 },
    })
    await eventOccurrenceSetCommand.parseAsync([
      "node",
      "set",
      "evt_1",
      "2026-11-02T09:00:00-05:00",
      "--start",
      "2026-11-03 9am",
      "--end",
      "2026-11-03 10am",
      "--tz",
      "America/New_York",
    ])
    expect(eventOccurrenceSet.mock.calls[0]![0].body).toMatchObject({
      start: "2026-11-03T09:00:00.000-05:00",
      end: "2026-11-03T10:00:00.000-05:00",
    })

    await expect(
      eventOccurrenceSetCommand.parseAsync([
        "node",
        "set",
        "evt_1",
        "2026-11-02T09:00:00-05:00",
        "--start",
        "2026-11-03 9am",
        "--end",
        "2026-11-03 10am",
        "--tz",
        "Asia/Taipei",
      ]),
    ).rejects.toThrow("--tz must match the series time zone")
  })

  it("round-trips expected versions for cancel and restore", async () => {
    const {
      eventOccurrenceCancelCommand,
      eventOccurrenceRestoreCommand,
      eventOccurrenceCancel,
      eventOccurrenceRestore,
    } = await loadCommands()
    const args = ["evt_1", "2026-06-01T09:00:00Z", "--expected-version", "3"]
    await eventOccurrenceCancelCommand.parseAsync(["node", "cancel", ...args])
    await eventOccurrenceRestoreCommand.parseAsync(["node", "restore", ...args])
    expect(eventOccurrenceCancel.mock.calls[0]![0].body.expected_version).toBe(3)
    expect(eventOccurrenceRestore.mock.calls[0]![0].body.expected_version).toBe(3)
  })
})

describe("event agenda", () => {
  it("requires both boundaries and sends the resolved view zone", async () => {
    const { eventAgendaCommand, eventAgenda } = await loadCommands()
    await eventAgendaCommand.parseAsync([
      "node",
      "agenda",
      "--from",
      "2026-11-01 9am",
      "--to",
      "2026-11-08 9am",
      "--tz",
      "America/New_York",
      "--include-cancelled",
      "--limit",
      "25",
      "--cursor",
      "next-page",
    ])

    expect(eventAgenda).toHaveBeenCalledWith({
      client: expect.anything(),
      query: {
        start: "2026-11-01T09:00:00.000-05:00",
        end: "2026-11-08T09:00:00.000-05:00",
        view_time_zone: "America/New_York",
        include_cancelled: true,
        limit: 25,
        cursor: "next-page",
      },
    })
  })

  it("uses WSPC_TZ when --tz is omitted", async () => {
    const { eventAgendaCommand, eventAgenda } = await loadCommands()
    process.env.WSPC_TZ = "Asia/Taipei"
    await eventAgendaCommand.parseAsync(["node", "agenda", "--from", "2026-08-14 9am", "--to", "2026-08-15 9am"])

    expect(eventAgenda.mock.calls[0]![0].query).toMatchObject({
      start: "2026-08-14T09:00:00.000+08:00",
      end: "2026-08-15T09:00:00.000+08:00",
      view_time_zone: "Asia/Taipei",
    })
  })

  it("blocks a request when a required boundary is missing", async () => {
    const { eventAgendaCommand, eventAgenda } = await loadCommands()
    eventAgendaCommand.exitOverride()

    await expect(eventAgendaCommand.parseAsync(["node", "agenda", "--from", "2026-08-14 9am"])).rejects.toMatchObject({
      code: "commander.missingMandatoryOptionValue",
    })
    expect(eventAgenda).not.toHaveBeenCalled()
  })
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.WSPC_TZ
})

describe("event add", () => {
  it('parses --start "tomorrow 10am" into ISO 8601 with zone offset, hour 10 in that zone', async () => {
    const { eventCreateCommand, eventCreate } = await loadCommands()
    await eventCreateCommand.parseAsync(["node", "add", "Meeting", "--start", "tomorrow 10am"])
    expect(eventCreate).toHaveBeenCalledTimes(1)
    const call = eventCreate.mock.calls[0]![0]
    const startIso = call.body.start as string
    const dt = DateTime.fromISO(startIso, { setZone: true })
    expect(dt.isValid).toBe(true)
    expect(dt.setZone(ZONE).hour).toBe(10)
    // Offset must match the resolved zone (Asia/Taipei = +08:00, no DST)
    expect(dt.offset).toBe(DateTime.now().setZone(ZONE).offset)
  })

  it("sends all-day boundaries as unchanged Exclusive End dates", async () => {
    const { eventCreateCommand, eventCreate } = await loadCommands()
    await eventCreateCommand.parseAsync([
      "node",
      "add",
      "Trip",
      "--all-day",
      "--start",
      "2026-05-10",
      "--end",
      "2026-05-13",
    ])
    const call = eventCreate.mock.calls[0]![0]
    expect(call.body.start).toBe("2026-05-10")
    expect(call.body.end).toBe("2026-05-13")
  })

  it.each([
    ["2026-05-31", "2026-06-01"],
    ["2028-02-29", "2028-03-01"],
  ])("does not perform date math for all-day boundaries %s to %s", async (start, end) => {
    const { eventCreateCommand, eventCreate } = await loadCommands()
    await eventCreateCommand.parseAsync(["node", "add", "Boundary", "--all-day", "--start", start, "--end", end])

    expect(eventCreate.mock.calls[0]![0].body.start).toBe(start)
    expect(eventCreate.mock.calls[0]![0].body.end).toBe(end)
  })

  it("collects multiple --attendee flags and parses display name / email", async () => {
    const { eventCreateCommand, eventCreate } = await loadCommands()
    await eventCreateCommand.parseAsync([
      "node",
      "add",
      "Lunch",
      "--start",
      "2026-05-10T12:00:00+08:00",
      "--attendee",
      "Alice <a@x>",
      "--attendee",
      "b@y",
    ])
    const call = eventCreate.mock.calls[0]![0]
    expect(call.body.attendees).toEqual([{ email: "a@x", display_name: "Alice" }, { email: "b@y" }])
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
      "2026-08-18",
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

  it("persists an explicit --tz and keeps recurring timestamps in that offset", async () => {
    const { eventCreateCommand, eventCreate } = await loadCommands()
    await eventCreateCommand.parseAsync([
      "node",
      "add",
      "New York office hours",
      "--start",
      "2026-03-02 9am",
      "--end",
      "2026-03-02 10am",
      "--rrule",
      "FREQ=WEEKLY;BYDAY=MO",
      "--tz",
      "America/New_York",
    ])

    expect(eventCreate.mock.calls[0]![0].body).toMatchObject({
      start: "2026-03-02T09:00:00.000-05:00",
      end: "2026-03-02T10:00:00.000-05:00",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO",
      time_zone: "America/New_York",
    })
  })
})

describe("event set", () => {
  it("sends both all-day boundaries unchanged", async () => {
    const { eventUpdateCommand, eventUpdate } = await loadCommands()
    await eventUpdateCommand.parseAsync([
      "node",
      "set",
      "evt_1",
      "--all-day",
      "--start",
      "2026-05-10",
      "--end",
      "2026-05-13",
    ])

    expect(eventUpdate.mock.calls[0]![0].body.start).toBe("2026-05-10")
    expect(eventUpdate.mock.calls[0]![0].body.end).toBe("2026-05-13")
  })

  it("keeps an omitted all-day end out of a partial update", async () => {
    const { eventUpdateCommand, eventUpdate } = await loadCommands()
    await eventUpdateCommand.parseAsync([
      "node",
      "set",
      "evt_1",
      "--all-day",
      "--start",
      "2026-05-10",
    ])

    expect(eventUpdate.mock.calls[0]![0].body.start).toBe("2026-05-10")
    expect(eventUpdate.mock.calls[0]![0].body.end).toBeUndefined()
  })

  it("keeps an omitted all-day start out of a partial update", async () => {
    const { eventUpdateCommand, eventUpdate } = await loadCommands()
    await eventUpdateCommand.parseAsync([
      "node",
      "set",
      "evt_1",
      "--all-day",
      "--end",
      "2026-05-13",
    ])

    expect(eventUpdate.mock.calls[0]![0].body.start).toBeUndefined()
    expect(eventUpdate.mock.calls[0]![0].body.end).toBe("2026-05-13")
  })

  it("preserves an empty --rrule value for recurrence clearing", async () => {
    const { eventUpdateCommand, eventUpdate } = await loadCommands()
    await eventUpdateCommand.parseAsync(["node", "set", "evt_1", "--rrule", ""])

    expect(eventUpdate.mock.calls[0]![0]).toMatchObject({
      path: { id: "evt_1" },
      body: { recurrence_rule: "" },
    })
  })

  it("sends --tz empty as the time-zone clear semantic", async () => {
    const { eventUpdateCommand, eventUpdate, eventGet } = await loadCommands()
    await eventUpdateCommand.parseAsync(["node", "set", "evt_1", "--tz", ""])

    expect(eventGet).not.toHaveBeenCalled()
    expect(eventUpdate.mock.calls[0]![0].body.time_zone).toBe("")
  })

  it("prefetches a series before persisting explicit --tz without --rrule", async () => {
    const { eventUpdateCommand, eventUpdate, eventGet } = await loadCommands()
    eventGet.mockResolvedValueOnce({
      data: { recurrence_rule: "FREQ=WEEKLY;BYDAY=MO" },
      response: { ok: true, status: 200 },
    })

    await eventUpdateCommand.parseAsync([
      "node",
      "set",
      "evt_1",
      "--start",
      "2026-11-02 9am",
      "--end",
      "2026-11-02 10am",
      "--tz",
      "America/New_York",
    ])

    expect(eventGet).toHaveBeenCalledWith(expect.objectContaining({ path: { id: "evt_1" } }))
    expect(eventUpdate.mock.calls[0]![0].body).toMatchObject({
      start: "2026-11-02T09:00:00.000-05:00",
      end: "2026-11-02T10:00:00.000-05:00",
      time_zone: "America/New_York",
    })
  })

  it("uses explicit --tz only for parsing when the prefetched event is single", async () => {
    const { eventUpdateCommand, eventUpdate, eventGet } = await loadCommands()
    eventGet.mockResolvedValueOnce({
      data: {},
      response: { ok: true, status: 200 },
    })

    await eventUpdateCommand.parseAsync(["node", "set", "evt_1", "--start", "2026-08-17 9am", "--tz", "Asia/Taipei"])

    expect(eventUpdate.mock.calls[0]![0].body.start).toBe("2026-08-17T09:00:00.000+08:00")
    expect(eventUpdate.mock.calls[0]![0].body.time_zone).toBeUndefined()
  })
})

describe("event ls", () => {
  it("renames --from / --to to query.start_from / query.start_to and emits ISO strings", async () => {
    const { eventListCommand, eventList } = await loadCommands()
    await eventListCommand.parseAsync(["node", "ls", "--from", "today", "--to", "next week"])
    const call = eventList.mock.calls[0]![0]
    // Field renames: from -> start_from, to -> start_to
    expect(call.query.start_from).toBeDefined()
    expect(call.query.start_to).toBeDefined()
    expect(call.query).not.toHaveProperty("from")
    expect(call.query).not.toHaveProperty("to")
    // Values are ISO 8601 strings parseable by Luxon with explicit offset.
    const from = DateTime.fromISO(call.query.start_from as string, {
      setZone: true,
    })
    const to = DateTime.fromISO(call.query.start_to as string, {
      setZone: true,
    })
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
    await eventIcsDownloadCommand.parseAsync(["node", "ics", "evt_xyz"])
    const call = eventIcsDownload.mock.calls[0]![0]
    expect(call.path.filename).toBe("evt_xyz.ics")
    expect(call.path).not.toHaveProperty("id")
  })
})
