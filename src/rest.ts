/**
 * REST entity load and loadRange with type version header.
 * Path format: /rest/{app}/{typename}/{id} or /rest/{app}/{typename}/{listId}?start=&count=&reverse=
 */

import * as http from "./http.js";
import type { TypeModel } from "./crypto/typeModels.js";
import { MAIL_DETAILS_BLOB } from "./crypto/typeModels.js";

function restPath(typeModel: TypeModel): string {
  return `/rest/${typeModel.app}/${typeModel.name.toLowerCase()}`;
}

/** Build v (and optionally dv) headers for entity REST requests. */
function versionHeaders(typeModel: TypeModel): Record<string, string> {
  const headers: Record<string, string> = { v: String(typeModel.version) };
  if (typeModel.dependsOnVersion != null) {
    headers.dv = String(typeModel.dependsOnVersion);
  }
  return headers;
}

export interface LoadEntityOptions {
  accessToken: string;
}

/**
 * Load a single entity by id. Id may be string or [listId, elementId].
 */
export async function loadEntity<T = Record<string, unknown>>(
  baseUrl: string,
  typeModel: TypeModel,
  id: string | [string, string],
  options: LoadEntityOptions
): Promise<T> {
  const path =
    typeof id === "string"
      ? `${restPath(typeModel)}/${id}`
      : `${restPath(typeModel)}/${id[0]}/${id[1]}`;
  return http.get<T>(baseUrl, path, {
    accessToken: options.accessToken,
    extraHeaders: versionHeaders(typeModel),
  });
}

/**
 * Load multiple list elements by listId and element ids (query param ids=id1,id2,...).
 * Use this when the server returns 400 for loadEntity with [listId, elementId] path.
 */
export async function loadMultiple<T = Record<string, unknown>>(
  baseUrl: string,
  typeModel: TypeModel,
  listId: string,
  elementIds: string[],
  options: LoadEntityOptions
): Promise<T[]> {
  const path = `${restPath(typeModel)}/${listId}`;
  const url = new URL(path, baseUrl);
  url.searchParams.set("ids", elementIds.join(","));
  const fullPath = url.pathname + url.search;
  const result = await http.get<T[]>(baseUrl, fullPath, {
    accessToken: options.accessToken,
    extraHeaders: versionHeaders(typeModel),
  });
  return Array.isArray(result) ? result : [result];
}

/** Range request params. */
export interface LoadRangeOptions {
  accessToken: string;
  start: string;
  count: number;
  reverse: boolean;
  /** When true and verbose is on, log response details and raw body (for debugging). */
  verboseResponse?: boolean;
}

/**
 * Load a range of list elements. Returns array of server instances (numeric attribute keys).
 */
export async function loadRange<T = Record<string, unknown>>(
  baseUrl: string,
  typeModel: TypeModel,
  listId: string,
  options: LoadRangeOptions
): Promise<T[]> {
  const path = `${restPath(typeModel)}/${listId}`;
  const url = new URL(path, baseUrl);
  url.searchParams.set("start", options.start);
  url.searchParams.set("count", String(options.count));
  url.searchParams.set("reverse", String(options.reverse));
  const fullPath = url.pathname + url.search;
  return http.get<T[]>(baseUrl, fullPath, {
    accessToken: options.accessToken,
    extraHeaders: versionHeaders(typeModel),
    verboseResponse: options.verboseResponse,
  });
}

/** Min/max generated ids for range queries (same as main app EntityUtils). */
export const GENERATED_MIN_ID = "------------";
export const GENERATED_MAX_ID = "zzzzzzzzzzzz";

/**
 * Load MailDetailsBlob from the blob server using a blob access token.
 * Auth and version are passed as query params (no accessToken in headers).
 * Blob server returns an array of instances when using ids=; we return it as-is.
 */
export async function loadMailDetailsBlobFromBlobServer(
  serverUrl: string,
  listId: string,
  elementId: string,
  blobAccessToken: string,
  accessToken: string
): Promise<Record<string, unknown> | Record<string, unknown>[]> {
  const path = `/rest/tutanota/maildetailsblob/${listId}`;
  const url = new URL(path, serverUrl);
  url.searchParams.set("accessToken", accessToken);
  url.searchParams.set("v", String(MAIL_DETAILS_BLOB.version));
  url.searchParams.set("ids", elementId);
  url.searchParams.set("blobAccessToken", blobAccessToken);
  url.searchParams.set("cv", http.CLIENT_VERSION);
  const fullPath = url.pathname + url.search;
  return http.get<Record<string, unknown> | Record<string, unknown>[]>(serverUrl, fullPath, {
    extraHeaders: { v: String(MAIL_DETAILS_BLOB.version) },
  });
}
