import { describe, it, expect } from "vitest"
import { WspcClient } from "../src/index.js"

describe("WspcClient", () => {
  it("constructs with apiKey", () => {
    const c = new WspcClient({ apiKey: "wspc_test" })
    expect(c.todos).toBeDefined()
    expect(c.todoProjects).toBeDefined()
    expect(c.todoTypes).toBeDefined()
    expect(c.todoRules).toBeDefined()
  })

  it("does not expose other-domain wrappers in v0", () => {
    const c = new WspcClient({ apiKey: "wspc_test" }) as unknown as Record<string, unknown>
    expect(c.events).toBeUndefined()
    expect(c.emails).toBeUndefined()
  })
})
