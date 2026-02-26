import * as logger from "./logger.js";

const SYS_MODEL_VERSION = "143";
/** Client version sent in cv header; should match @tutao package version. */
export const CLIENT_VERSION = "327.260210.0";
/** Client platform: 5 = WEB (see ClientPlatform in main app). */
const CLIENT_PLATFORM = "5";
const USER_AGENT = "Tutanota-CLI/0.1.0";

export interface RequestOptions {
  body?: object;
  accessToken?: string;
  /** Merged into request headers (e.g. v for entity type version). */
  extraHeaders?: Record<string, string>;
  /** When true and verbose mode is on, log response status/size and raw body. */
  verboseResponse?: boolean;
}

export async function get<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, baseUrl);
  if (options.body != null) {
    url.searchParams.set("_body", JSON.stringify(options.body));
  }

  const urlString = url.toString();
  logger.log(`GET ${url.origin}${url.pathname}${url.search || ""}`);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    Accept: "application/json",
    v: SYS_MODEL_VERSION,
    cv: CLIENT_VERSION,
    cp: CLIENT_PLATFORM,
  };
  if (options.accessToken) {
    headers.accessToken = options.accessToken;
  }
  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders);
  }

  let res: Response;
  try {
    res = await fetch(urlString, {
      method: "GET",
      headers,
    });
  } catch (err) {
    if (logger.isVerbose()) {
      const cause = err instanceof Error ? err.cause : null;
      console.error("Request failed: GET", url.origin + url.pathname);
      console.error("Error:", err);
      if (cause) console.error("Cause:", cause);
      if (err instanceof Error && err.stack) {
        console.error("[verbose] stack:", err.stack);
      }
    }
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    if (logger.isVerbose() && text) console.error("[verbose] response body:", text);
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  if (options.verboseResponse && logger.isVerbose()) {
    const text = await res.text();
    const sizeBytes = Buffer.byteLength(text, "utf8");
    const sizeKb = (sizeBytes / 1024).toFixed(2);
    console.error("[verbose] Response:", res.status, sizeKb + " kB");
    return JSON.parse(text) as T;
  }

  return res.json() as Promise<T>;
}

/** Options for getBinary (body is string; RequestOptions.body is object). */
export interface GetBinaryOptions {
  body?: string;
  accessToken?: string;
  extraHeaders?: Record<string, string>;
}

/**
 * GET request with optional body and binary response. Used for storage BlobService.
 */
export async function getBinary(
  baseUrl: string,
  path: string,
  options: GetBinaryOptions = {}
): Promise<Uint8Array> {
  const url = new URL(path, baseUrl);
  logger.log(`GET ${url.origin}${url.pathname} (binary)`);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    cv: CLIENT_VERSION,
    cp: CLIENT_PLATFORM,
  };
  if (options.accessToken) {
    headers.accessToken = options.accessToken;
  }
  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders);
  }

  const init: RequestInit = { method: "GET", headers };
  if (options.body != null) {
    (init as RequestInit & { body?: string }).body = options.body;
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), init);
  } catch (err) {
    if (logger.isVerbose()) {
      console.error("Request failed: GET", url.origin + url.pathname);
      console.error("Error:", err);
    }
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    if (logger.isVerbose() && text) console.error("[verbose] response body:", text);
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * POST request with body and binary response. Used for storage BlobService (Node fetch disallows GET with body).
 */
export async function postBinary(
  baseUrl: string,
  path: string,
  body: string,
  options: Omit<GetBinaryOptions, "body"> = {}
): Promise<Uint8Array> {
  const url = new URL(path, baseUrl);
  logger.log(`POST ${url.origin}${url.pathname} (binary)`);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    cv: CLIENT_VERSION,
    cp: CLIENT_PLATFORM,
  };
  if (options.accessToken) {
    headers.accessToken = options.accessToken;
  }
  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers,
      body,
    });
  } catch (err) {
    if (logger.isVerbose()) {
      console.error("Request failed: POST", url.origin + url.pathname);
      console.error("Error:", err);
    }
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    if (logger.isVerbose() && text) console.error("[verbose] response body:", text);
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function post<T>(baseUrl: string, path: string, body: object, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, baseUrl);
  logger.log(`POST ${url.origin}${url.pathname}`);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    Accept: "application/json",
    v: SYS_MODEL_VERSION,
    cv: CLIENT_VERSION,
    cp: CLIENT_PLATFORM,
  };
  if (options.accessToken) {
    headers.accessToken = options.accessToken;
  }
  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.cause : null;
    console.error("Request failed: POST", url.origin + url.pathname);
    console.error("Error:", err);
    if (cause) console.error("Cause:", cause);
    if (logger.isVerbose() && err instanceof Error && err.stack) {
      console.error("[verbose] stack:", err.stack);
    }
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    if (logger.isVerbose() && text) console.error("[verbose] response body:", text);
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  return res.json() as Promise<T>;
}
