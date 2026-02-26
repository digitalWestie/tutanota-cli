/**
 * Load binary blobs from the storage BlobService (used for mail attachments).
 * Request/response format aligned with main app BlobFacade.
 */

import { base64ToBase64Ext, base64ToBase64Url, uint8ArrayToBase64 } from "@tutao/tutanota-utils";
import { randomBytes } from "node:crypto";
import * as http from "./http.js";

const BLOB_SERVICE_REST_PATH = "/rest/storage/blobservice";
/** BlobGetIn type model version (storage type 50). */
const BLOB_GET_IN_VERSION = "13";

/** Generate a CustomId for BlobId._id (145), same as main app ModelMapper for aggregated _id. */
function generateBlobIdCustomId(): string {
  return base64ToBase64Url(uint8ArrayToBase64(new Uint8Array(randomBytes(4))));
}

/** BlobGetIn wire format: 51=_format (NumberString), 52=archiveId, 110=blobId, 193=blobIds (array of { 145: _id, 146: blobId }). */
function buildBlobGetInBody(archiveId: string, blobIds: string[]): Record<string, unknown> {
  return {
    "51": "0",
    "52": archiveId,
    "110": null,
    "193": blobIds.map((blobId) => ({ "145": generateBlobIdCustomId(), "146": blobId })),
  };
}

/**
 * Parse concatenated binary response from BlobService GET.
 * Format: 4 bytes blob count (int32), then per blob: 9 bytes blobId, 6 bytes padding, 4 bytes size (int32), then blob data.
 * @return Map from blobId (base64ext string) to encrypted blob bytes.
 */
export function parseMultipleBlobsResponse(concatBinaryData: Uint8Array): Map<string, Uint8Array> {
  const dataView = new DataView(concatBinaryData.buffer, concatBinaryData.byteOffset, concatBinaryData.byteLength);
  const result = new Map<string, Uint8Array>();
  const blobCount = dataView.getInt32(0);
  if (blobCount <= 0) {
    return result;
  }
  let offset = 4;
  while (offset < concatBinaryData.length) {
    const blobIdBytes = concatBinaryData.slice(offset, offset + 9);
    const blobId = base64ToBase64Ext(uint8ArrayToBase64(blobIdBytes));
    const blobSize = dataView.getInt32(offset + 15);
    const dataStartOffset = offset + 19;
    if (blobSize < 0 || dataStartOffset + blobSize > concatBinaryData.length) {
      throw new Error(`Invalid blob size: ${blobSize}. Remaining length: ${concatBinaryData.length - dataStartOffset}`);
    }
    const contents = concatBinaryData.slice(dataStartOffset, dataStartOffset + blobSize);
    result.set(blobId, contents);
    offset = dataStartOffset + blobSize;
  }
  if (result.size !== blobCount) {
    throw new Error(`Parsed wrong number of blobs: ${result.size}. Expected: ${blobCount}`);
  }
  return result;
}

/**
 * Load encrypted blob bytes from the storage BlobService for the given archive and blob ids.
 * Returns a map from blobId to encrypted Uint8Array.
 */
export async function loadBlobsFromStorageBlobServer(
  serverUrl: string,
  archiveId: string,
  blobIds: string[],
  blobAccessToken: string,
  accessToken: string
): Promise<Map<string, Uint8Array>> {
  if (blobIds.length === 0) {
    return new Map();
  }
  const body = buildBlobGetInBody(archiveId, blobIds);
  const url = new URL(BLOB_SERVICE_REST_PATH, serverUrl);
  url.searchParams.set("blobAccessToken", blobAccessToken);
  url.searchParams.set("v", BLOB_GET_IN_VERSION);
  url.searchParams.set("accessToken", accessToken);
  url.searchParams.set("_body", JSON.stringify(body));
  url.searchParams.set("cv", http.CLIENT_VERSION);
  const pathWithQuery = url.pathname + url.search;
  const binary = await http.getBinary(serverUrl, pathWithQuery, {
    accessToken,
    extraHeaders: { Accept: "application/octet-stream" },
  });
  return parseMultipleBlobsResponse(binary);
}
