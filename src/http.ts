import * as logger from "./logger.js";

const SYS_MODEL_VERSION = "143";
/** Client version sent in cv header; should match @tutao package version. */
const CLIENT_VERSION = "327.260210.0";
/** Client platform: 5 = WEB (see ClientPlatform in main app). */
const CLIENT_PLATFORM = "5";
const USER_AGENT = "Tutanota-CLI/1.0";

export interface RequestOptions {
  body?: object;
  accessToken?: string;
}

export async function get<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, baseUrl);
  if (options.body != null) {
    url.searchParams.set("_body", JSON.stringify(options.body));
  }

  const urlString = url.toString();
  logger.log(`GET ${url.origin}${url.pathname}${url.search ? " [query present]" : ""}`);

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

  let res: Response;
  try {
    res = await fetch(urlString, {
      method: "GET",
      headers,
    });
  } catch (err) {
    // Always log something useful when fetch fails (message is often just "fetch failed")
    const cause = err instanceof Error ? err.cause : null;
    console.error("Request failed: GET", url.origin + url.pathname);
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
