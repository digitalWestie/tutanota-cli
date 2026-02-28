/**
 * Load attachments from a message: load Mail, File entities, fetch blobs from storage BlobService, decrypt, write to disk.
 */

import * as fs from "fs";
import * as path from "path";
import { aesDecrypt } from "@tutao/tutanota-crypto";
import type { KeyChain } from "../crypto/keyChain.js";
import {
  resolveSessionKey,
  decryptParsedInstance,
  sanitizeServerInstance,
  type ServerInstance,
} from "../crypto/decryptInstance.js";
import {
  MAIL,
  FILE,
  MAIL_ATTR_ATTACHMENTS,
  FILE_ATTR_NAME,
  FILE_ATTR_SIZE,
  FILE_ATTR_MIME_TYPE,
  FILE_ATTR_BLOBS,
  BLOB_ATTR_ARCHIVE_ID,
  BLOB_ATTR_BLOB_ID,
} from "../crypto/typeModels.js";
import { loadEntity, loadMultiple } from "../rest.js";
import { requestBlobReadTokenArchive } from "../blobToken.js";
import { loadBlobsFromStorageBlobServer } from "../storageBlob.js";
import { parseMailId } from "./mailId.js";

export interface AttachmentDownloadOptions {
  outputDir: string;
  /** 1-based index to download only one attachment; omit to download all. */
  index?: number;
  verbose?: boolean;
}

export interface AttachmentDownloadResult {
  name: string;
  path: string;
  size: number;
}

/** Normalize Mail.attachments (115) to array of [listId, elementId]. */
export function parseAttachmentRefs(attachmentsRaw: unknown): [string, string][] {
  if (attachmentsRaw == null) return [];
  const arr = Array.isArray(attachmentsRaw) ? attachmentsRaw : [attachmentsRaw];
  const refs: [string, string][] = [];
  for (const item of arr) {
    if (Array.isArray(item) && item.length >= 2) {
      const listId = String(item[0] ?? "").trim();
      const elementId = String(item[1] ?? "").trim();
      if (listId && elementId) refs.push([listId, elementId]);
    }
  }
  return refs;
}

/**
 * Load attachment File entities for a mail and return decrypted filenames joined by ", ".
 * safeMail must be the sanitized Mail instance (attribute 115 = attachment refs).
 */
export async function getAttachmentNamesForMail(
  safeMail: ServerInstance,
  ctx: { baseUrl: string; accessToken: string; keyChain: KeyChain }
): Promise<string> {
  const refs = parseAttachmentRefs(safeMail[MAIL_ATTR_ATTACHMENTS]);
  if (refs.length === 0) return "";
  const byListId = new Map<string, string[]>();
  for (const [lid, eid] of refs) {
    const list = byListId.get(lid) ?? [];
    list.push(eid);
    byListId.set(lid, list);
  }
  const refOrder = refs.map(([l, e]) => `${l}/${e}`);
  const fileByRef = new Map<string, ServerInstance>();
  for (const [lid, eids] of byListId) {
    const files = await loadMultiple<ServerInstance>(ctx.baseUrl, FILE, lid, eids, {
      accessToken: ctx.accessToken,
    });
    for (let j = 0; j < eids.length; j++) {
      const ref = `${lid}/${eids[j]}`;
      if (files[j] != null) fileByRef.set(ref, sanitizeServerInstance(files[j] as ServerInstance));
    }
  }
  const names: string[] = [];
  for (const ref of refOrder) {
    const fileRaw = fileByRef.get(ref);
    if (fileRaw == null) continue;
    const fileSk = resolveSessionKey(ctx.keyChain, fileRaw, FILE);
    const decryptedFile = decryptParsedInstance(FILE, fileRaw, fileSk ?? null) as ServerInstance;
    const name = String(decryptedFile[FILE_ATTR_NAME] ?? "").trim();
    names.push(name || "(no name)");
  }
  return names.join(", ");
}

/** Sanitize filename for filesystem: strip path, replace unsafe chars. */
export function sanitizeAttachmentFilename(name: string, index: number): string {
  const base = path.basename(name).replace(/[\0/\\:*?"<>|]/g, "_").trim();
  if (base.length > 0) return base;
  return `attachment-${index}.bin`;
}

/** Resolve blob list from decrypted File (1225 = blobs aggregation). */
function getBlobRefs(decryptedFile: ServerInstance): { archiveId: string; blobId: string }[] {
  const raw = decryptedFile[FILE_ATTR_BLOBS];
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const refs: { archiveId: string; blobId: string }[] = [];
  for (const el of list) {
    if (el != null && typeof el === "object") {
      const archiveId = (el as Record<string, unknown>)[BLOB_ATTR_ARCHIVE_ID];
      const blobId = (el as Record<string, unknown>)[BLOB_ATTR_BLOB_ID];
      if (typeof archiveId === "string" && typeof blobId === "string") {
        refs.push({ archiveId, blobId });
      }
    }
  }
  return refs;
}

/** Look up encrypted bytes for a blobId; map keys from response are base64ext. */
function getBlobBytes(
  blobMap: Map<string, Uint8Array>,
  blobId: string
): Uint8Array | undefined {
  return blobMap.get(blobId) ?? undefined;
}

/**
 * Download attachments for the given mail-id. Returns list of saved files; empty if no attachments.
 * Throws on auth/network errors.
 */
export async function runAttachmentDownload(
  mailId: string,
  options: AttachmentDownloadOptions,
  context: {
    baseUrl: string;
    accessToken: string;
    keyChain: KeyChain;
  }
): Promise<AttachmentDownloadResult[]> {
  const { outputDir, index: indexOpt, verbose } = options;
  const [listId, elementId] = parseMailId(mailId);

  const mailRaw = await loadEntity<ServerInstance>(context.baseUrl, MAIL, [listId, elementId], {
    accessToken: context.accessToken,
  });
  const safeMail = sanitizeServerInstance(mailRaw);

  const attachmentRefs = parseAttachmentRefs(safeMail[MAIL_ATTR_ATTACHMENTS]);
  if (attachmentRefs.length === 0) {
    return [];
  }

  const refsToLoad =
    indexOpt != null
      ? indexOpt >= 1 && indexOpt <= attachmentRefs.length
        ? [attachmentRefs[indexOpt - 1]]
        : []
      : attachmentRefs;
  if (refsToLoad.length === 0) {
    return [];
  }

  // Group by listId and load File entities
  const byListId = new Map<string, string[]>();
  for (const [lid, eid] of refsToLoad) {
    const list = byListId.get(lid) ?? [];
    list.push(eid);
    byListId.set(lid, list);
  }

  const results: AttachmentDownloadResult[] = [];
  const refOrder = refsToLoad.map(([l, e]) => `${l}/${e}`);
  const fileByRef = new Map<string, ServerInstance>();
  for (const [lid, eids] of byListId) {
    const files = await loadMultiple<ServerInstance>(context.baseUrl, FILE, lid, eids, {
      accessToken: context.accessToken,
    });
    for (let j = 0; j < eids.length; j++) {
      const ref = `${lid}/${eids[j]}`;
      if (files[j] != null) fileByRef.set(ref, files[j]);
    }
  }

  for (let i = 0; i < refOrder.length; i++) {
    const ref = refOrder[i];
    const fileRaw = fileByRef.get(ref);
    if (fileRaw == null) continue;
    const fileSk = resolveSessionKey(context.keyChain, fileRaw, FILE);
    const decryptedFile = decryptParsedInstance(FILE, fileRaw, fileSk ?? null) as ServerInstance;
    const name = String(decryptedFile[FILE_ATTR_NAME] ?? "").trim();
    const size = Number(decryptedFile[FILE_ATTR_SIZE] ?? 0);
    const blobRefs = getBlobRefs(decryptedFile);
    if (blobRefs.length === 0) continue;

    const archiveIds = [...new Set(blobRefs.map((r) => r.archiveId))];
    const blobMapAll = new Map<string, Uint8Array>();
    for (const aid of archiveIds) {
      const { blobAccessToken, serverUrl } = await requestBlobReadTokenArchive(
        context.baseUrl,
        aid,
        context.accessToken
      );
      const blobIds = blobRefs.filter((r) => r.archiveId === aid).map((r) => r.blobId);
      const map = await loadBlobsFromStorageBlobServer(
        serverUrl,
        aid,
        blobIds,
        blobAccessToken,
        context.accessToken
      );
      for (const [k, v] of map) blobMapAll.set(k, v);
    }

    const chunks: Uint8Array[] = [];
    for (const ref of blobRefs) {
      const enc = getBlobBytes(blobMapAll, ref.blobId);
      if (enc == null) continue;
      if (fileSk == null) continue;
      const dec = aesDecrypt(fileSk, enc);
      chunks.push(dec);
    }
    const totalLength = chunks.reduce((s, c) => s + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.length;
    }

    const filename = sanitizeAttachmentFilename(name, i + 1);
    let outPath = path.join(outputDir, filename);
    if (fs.existsSync(outPath)) {
      let n = 1;
      const ext = path.extname(filename);
      const base = path.basename(filename, ext) || filename;
      while (fs.existsSync(outPath)) {
        outPath = path.join(outputDir, `${base} (${n})${ext}`);
        n++;
      }
    }
    fs.writeFileSync(outPath, combined, { mode: 0o600 });
    results.push({ name: filename, path: outPath, size: combined.length });
    if (verbose) {
      console.error("[verbose] Saved attachment:", outPath, combined.length, "bytes");
    }
  }

  return results;
}
