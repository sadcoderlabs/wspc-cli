import { createClient, createConfig } from "./generated/sdk/client/index.js"
import type { Client } from "./generated/sdk/client/index.js"
import {
  todoCreate,
  todoList,
  todoGet,
  todoUpdate,
  todoDelete,
  projectCreate,
  projectList,
  todoTypeList,
  recurrenceRuleList,
} from "./generated/sdk/sdk.gen.js"
import type {
  TodoCreateData,
  TodoListData,
  TodoUpdateData,
  ProjectCreateData,
} from "./generated/sdk/types.gen.js"
import { API_BASE, VERSION, SPEC_SHA, SPEC_FETCHED_AT } from "./version.js"

export { VERSION, SPEC_SHA, SPEC_FETCHED_AT, API_BASE }

export type WspcClientOptions =
  | { apiKey: string; baseUrl?: string }
  | {
      accessToken: string
      refreshToken: string
      onTokenRefresh?: (next: { accessToken: string; refreshToken: string; expiresAt: number }) => void | Promise<void>
      baseUrl?: string
    }

export class WspcAuthExpiredError extends Error {
  readonly code = "WSPC_AUTH_EXPIRED" as const
  constructor(message = "wspc credentials expired; re-authenticate via `wspc login`") {
    super(message)
    this.name = "WspcAuthExpiredError"
  }
}

export class WspcClient {
  readonly todos: TodosResource
  readonly todoProjects: TodoProjectsResource
  readonly todoTypes: TodoTypesResource
  readonly todoRules: TodoRulesResource

  constructor(opts: WspcClientOptions) {
    const client = createClient(
      createConfig({
        baseUrl: "baseUrl" in opts ? (opts.baseUrl ?? API_BASE) : API_BASE,
        // Auth interceptor wires in Task 17; v0 placeholder.
        ...buildAuthOptions(opts),
      }),
    )
    this.todos = new TodosResource(client)
    this.todoProjects = new TodoProjectsResource(client)
    this.todoTypes = new TodoTypesResource(client)
    this.todoRules = new TodoRulesResource(client)
  }
}

// Placeholder; Task 17 replaces with real auth interceptor logic.
function buildAuthOptions(_opts: WspcClientOptions): object {
  return {}
}

class TodosResource {
  constructor(private client: Client) {}
  async create(body: TodoCreateData["body"]) {
    const res = await todoCreate({ client: this.client, body })
    return res.data
  }
  async list(query?: TodoListData["query"]) {
    const res = await todoList({ client: this.client, query })
    return res.data
  }
  async get(id: string) {
    const res = await todoGet({ client: this.client, path: { id } })
    return res.data
  }
  async update(id: string, body: TodoUpdateData["body"]) {
    const res = await todoUpdate({ client: this.client, path: { id }, body })
    return res.data
  }
  async delete(id: string) {
    await todoDelete({ client: this.client, path: { id } })
  }
}

class TodoProjectsResource {
  constructor(private client: Client) {}
  async create(body: ProjectCreateData["body"]) {
    const res = await projectCreate({ client: this.client, body })
    return res.data
  }
  async list() {
    const res = await projectList({ client: this.client })
    return res.data
  }
}

class TodoTypesResource {
  constructor(private client: Client) {}
  async list() {
    const res = await todoTypeList({ client: this.client })
    return res.data
  }
}

class TodoRulesResource {
  constructor(private client: Client) {}
  async list() {
    const res = await recurrenceRuleList({ client: this.client })
    return res.data
  }
}
