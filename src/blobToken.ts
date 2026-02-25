/**
 * Request a blob read token for an archive (e.g. MailDetailsBlob list).
 * Used to load BlobElement types from the blob server.
 */

import { randomBytes } from "node:crypto";
import * as http from "./http.js";

const BLOB_ACCESS_TOKEN_SERVICE_PATH = "/rest/storage/blobaccesstokenservice";
/** Storage model version for BlobAccessTokenPostIn (TypeModels 77). */
const STORAGE_MODEL_VERSION = "13";

/** BlobAccessTokenPostIn: 78=_format, 180=archiveDataType, 181=read, 80=write. */
const POST_IN_FORMAT = "78";
const POST_IN_ARCHIVE_DATA_TYPE = "180";
const POST_IN_READ = "181";
const POST_IN_WRITE = "80";

/** BlobReadData (181): 176=_id, 177=archiveId, 178=instanceListId, 179=instanceIds. */
const READ_ID = "176";
const READ_ARCHIVE_ID = "177";
const READ_INSTANCE_LIST_ID = "178";
const READ_INSTANCE_IDS = "179";

/** BlobServerAccessInfo (161): 159=blobAccessToken, 160=servers. BlobServerUrl: 156=url. */
const ACCESS_INFO_TOKEN = "159";
const ACCESS_INFO_SERVERS = "160";
const SERVER_URL = "156";

export interface BlobReadTokenResult {
  blobAccessToken: string;
  serverUrl: string;
}

/**
 * Request a read token for the given archive. Token is used as query param when loading blob elements from the blob server.
 */
export async function requestBlobReadTokenArchive(
  baseUrl: string,
  archiveId: string,
  accessToken: string
): Promise<BlobReadTokenResult> {
  const readData: Record<string, unknown> = {
    [READ_ID]: randomBytes(3).toString("hex"),
    [READ_ARCHIVE_ID]: archiveId,
    [READ_INSTANCE_LIST_ID]: null,
    [READ_INSTANCE_IDS]: [],
  };
  const body: Record<string, unknown> = {
    [POST_IN_FORMAT]: "0",
    [POST_IN_ARCHIVE_DATA_TYPE]: null,
    [POST_IN_READ]: [readData],
    [POST_IN_WRITE]: [],
  };
  const res = await http.post<Record<string, unknown>>(
    baseUrl,
    BLOB_ACCESS_TOKEN_SERVICE_PATH,
    body,
    {
      accessToken,
      extraHeaders: { v: STORAGE_MODEL_VERSION },
    }
  );
  const blobAccessInfoRaw = res["161"];
  if (blobAccessInfoRaw == null || typeof blobAccessInfoRaw !== "object") {
    throw new Error("Blob token response missing blobAccessInfo (161).");
  }
  const blobAccessInfo = Array.isArray(blobAccessInfoRaw)
    ? blobAccessInfoRaw[0]
    : blobAccessInfoRaw;
  if (blobAccessInfo == null || typeof blobAccessInfo !== "object") {
    throw new Error("Blob token response missing blobAccessInfo (161).");
  }
  const info = blobAccessInfo as Record<string, unknown>;
  const token = info[ACCESS_INFO_TOKEN];
  if (token == null || typeof token !== "string") {
    throw new Error("Blob token response missing blobAccessToken (159).");
  }
  const servers = info[ACCESS_INFO_SERVERS];
  const serverList = Array.isArray(servers) ? servers : servers != null ? [servers] : [];
  const firstServer = serverList[0];
  if (firstServer == null || typeof firstServer !== "object") {
    throw new Error("Blob token response has no servers (160).");
  }
  const url = (firstServer as Record<string, unknown>)[SERVER_URL];
  if (url == null || typeof url !== "string") {
    throw new Error("Blob server entry missing url (156).");
  }
  return { blobAccessToken: token, serverUrl: url.replace(/\/$/, "") };
}
