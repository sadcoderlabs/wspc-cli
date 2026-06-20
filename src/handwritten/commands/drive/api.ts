import { loadAuthedFetch, loadSdkClient } from "../../auth/load-sdk-client.js"
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

export async function createDriveApi(opts: DriveApiOptions = {}) {
  const sdkClient = await loadSdkClient(opts)
  const authedFetch = await loadAuthedFetch(opts)

  return {
    async getLibrary(id: string): Promise<DriveLibrary> {
      const result = await driveLibraryGet({
        client: (sdkClient as { _rawClient: never })._rawClient,
        path: { id },
      })
      return expectJsonResult(result)
    },
    async getManifest(id: string, cursor?: string): Promise<DriveManifestResponse> {
      const result = await driveManifestGet({
        client: (sdkClient as { _rawClient: never })._rawClient,
        path: { id },
        ...(cursor ? { query: { cursor } } : {}),
      })
      return expectJsonResult(result)
    },
    async deleteFile(id: string, path: string, expectedEntryVersion: number) {
      const result = await driveFileDelete({
        client: (sdkClient as { _rawClient: never })._rawClient,
        path: { id },
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
      expectedEntryVersion: number,
      body: BodyInit,
      sha256: string,
    ): Promise<UploadDriveFileResponse> {
      const url = new URL(`/drive/libraries/${id}/files/content`, authedFetch.baseUrl)
      url.searchParams.set("path", path)
      url.searchParams.set("expected_entry_version", String(expectedEntryVersion))

      const res = await authedFetch.fetch(url, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "x-drive-content-sha256": sha256,
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
    async downloadFile(id: string, path: string): Promise<Response> {
      const url = new URL(`/drive/libraries/${id}/files/content`, authedFetch.baseUrl)
      url.searchParams.set("path", path)
      const res = await authedFetch.fetch(url, { method: "GET" })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      return res
    },
  }
}
