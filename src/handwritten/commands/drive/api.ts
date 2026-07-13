import { loadSdkClientWithAuthedFetch } from "../../auth/load-sdk-client.js"
import {
  driveFileDelete,
  driveLibraryGet,
  driveManifestGet,
} from "../../../generated/sdk/index.js"
import type { DeleteDriveFileResponse, DriveLibrary, DriveManifestResponse, UploadDriveFileResponse } from "../../../generated/sdk/index.js"
import type { ConfigStore } from "../../config/index.js"

export interface DriveApiOptions {
  store?: ConfigStore
  fetchImpl?: typeof fetch
  // Watch session client id; lets the server tag events for echo suppression.
  clientId?: string
}

type JsonResult<T> = {
  data?: T
  error?: unknown
  response?: Response
}

function asError(result: JsonResult<unknown>): Error {
  const message = JSON.stringify(result.error ?? "request failed")
  return new Error(`HTTP ${result.response?.status ?? "?"}: ${message}`)
}

async function expectJsonResult<T>(result: JsonResult<T>): Promise<T> {
  if (result.error || !result.response?.ok) throw asError(result)
  if (result.data == null) throw new Error("empty response")
  return result.data
}

// Lets the server attribute drive file operations to the sync loop instead
// of generic API traffic (drive_file_operation actor: "sync" vs "api").
function syncClientHeaders(clientId?: string): { "x-wspc-client": string } {
  return { "x-wspc-client": clientId === undefined ? "drive-sync" : `drive-sync/${clientId}` }
}

function driveContentUrl(baseUrl: string, id: string): URL {
  const baseWithTrailingSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  return new URL(`drive/libraries/${encodeURIComponent(id)}/files/content`, baseWithTrailingSlash)
}

export async function createDriveApi(opts: DriveApiOptions = {}) {
  const client = await loadSdkClientWithAuthedFetch(opts)
  const rawClient = client._rawClient as never
  const clientHeaders = syncClientHeaders(opts.clientId)

  return {
    async getLibrary(id: string): Promise<DriveLibrary> {
      const result = await driveLibraryGet({
        client: rawClient,
        path: { id },
      })
      return expectJsonResult(result)
    },
    async getManifest(id: string, cursor?: string): Promise<DriveManifestResponse> {
      const result = await driveManifestGet({
        client: rawClient,
        path: { id },
        ...(cursor ? { query: { cursor } } : {}),
      })
      return expectJsonResult(result)
    },
    async deleteFile(id: string, path: string, expectedEntryVersion: number) {
      const result = await driveFileDelete({
        client: rawClient,
        path: { id },
        headers: clientHeaders,
        body: {
          path,
          expected_entry_version: expectedEntryVersion,
        },
      })
      return expectJsonResult<DeleteDriveFileResponse>(result)
    },
    async uploadFile(
      id: string,
      path: string,
      body: BodyInit,
      sha256: string,
      expectedEntryVersion?: number,
    ): Promise<UploadDriveFileResponse> {
      const url = driveContentUrl(client.baseUrl, id)
      url.searchParams.set("path", path)
      if (expectedEntryVersion !== undefined) {
        url.searchParams.set("expected_entry_version", String(expectedEntryVersion))
      }

      const res = await client.fetch(url, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "x-drive-content-sha256": sha256,
          ...clientHeaders,
        },
        body,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const payload = await res.json()
      if (payload === undefined || payload === null) {
        throw new Error("empty response")
      }
      return payload as UploadDriveFileResponse
    },
    async downloadFile(id: string, path: string, versionId?: string): Promise<Response> {
      const url = driveContentUrl(client.baseUrl, id)
      url.searchParams.set("path", path)
      if (versionId !== undefined) {
        url.searchParams.set("version_id", versionId)
      }
      const res = await client.fetch(url, { method: "GET" })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      return res
    },
  }
}
