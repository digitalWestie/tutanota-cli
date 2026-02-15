/**
 * REST entity load and loadRange with type version header.
 * Path format: /rest/{app}/{typename}/{id} or /rest/{app}/{typename}/{listId}?start=&count=&reverse=
 */

import * as http from "./http.js";
import type { TypeModel } from "./crypto/typeModels.js";

function restPath(typeModel: TypeModel): string {
  return `/rest/${typeModel.app}/${typeModel.name.toLowerCase()}`;
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
    extraHeaders: { v: String(typeModel.version) },
  });
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
    extraHeaders: { v: String(typeModel.version) },
    verboseResponse: options.verboseResponse,
  });
}

/** Min/max generated ids for range queries (same as main app EntityUtils). */
export const GENERATED_MIN_ID = "------------";
export const GENERATED_MAX_ID = "zzzzzzzzzzzz";
