/**
 * Export one message to an EML file. Shared by message export and folder export.
 */

import * as fs from "fs";
import * as path from "path";
import type { KeyChain } from "../crypto/keyChain.js";
import {
  resolveSessionKey,
  decryptParsedInstance,
  type ServerInstance,
} from "../crypto/decryptInstance.js";
import { MAIL } from "../crypto/typeModels.js";
import { loadEntity } from "../rest.js";
import { unwrapSingleElementArray } from "../utils/bytes.js";
import { loadMailBody } from "./loadMailBody.js";
import { runAttachmentDownload } from "./loadAttachments.js";
import { buildEml, sanitizeEmlFilename } from "./eml.js";

function parseMailId(mailId: string): [string, string] {
  const trimmed = mailId.trim();
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) return [parts[0].trim(), parts[1].trim()];
  }
  throw new Error(`Invalid mail-id: "${mailId}". Use format listId/elementId (e.g. from 'envelope list --format json').`);
}

function getSenderFromMail(decryptedMail: ServerInstance): string {
  const senderAgg = decryptedMail["111"];
  const sender = unwrapSingleElementArray(senderAgg);
  if (sender != null && typeof sender === "object" && "95" in sender) {
    return String((sender as Record<string, unknown>)["95"] ?? "");
  }
  return "";
}

function toDateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  return String(v);
}

export interface ExportOneMessageOptions {
  mailId: string;
  /** Explicit output file path. If set, outputDir is ignored. */
  outputPath?: string;
  /** When set (and outputPath not set), output file is outputDir + sanitizeEmlFilename(date, subject). */
  outputDir?: string;
  context: {
    baseUrl: string;
    accessToken: string;
    keyChain: KeyChain;
  };
  includeAttachments?: boolean;
  /** If true and output file already exists, skip writing and return existing path. */
  skipIfExists?: boolean;
  verbose?: boolean;
}

export interface ExportOneMessageResult {
  path: string;
  /** Paths to attachment files if includeAttachments was true. */
  attachmentPaths?: string[];
}

/**
 * Load one message, build EML, and write to outputPath. Optionally download attachments to a sibling directory.
 */
export async function exportOneMessageToPath(
  options: ExportOneMessageOptions
): Promise<ExportOneMessageResult> {
  const { mailId, context, includeAttachments = false, skipIfExists = false, verbose = false } = options;
  const [listId, elementId] = parseMailId(mailId);

  const mailRaw = await loadEntity<ServerInstance>(context.baseUrl, MAIL, [listId, elementId], {
    accessToken: context.accessToken,
  });
  const safeMail =
    "__proto__" in mailRaw
      ? (Object.fromEntries(Object.entries(mailRaw).filter(([k]) => k !== "__proto__")) as ServerInstance)
      : mailRaw;

  const mailSk = resolveSessionKey(context.keyChain, safeMail, MAIL);
  const decryptedMail = decryptParsedInstance(MAIL, safeMail, mailSk ?? null) as ServerInstance;

  const { bodyText } = await loadMailBody({
    baseUrl: context.baseUrl,
    accessToken: context.accessToken,
    decryptedMail,
    keyChain: context.keyChain,
  });

  const from = getSenderFromMail(decryptedMail);
  const subject = String(decryptedMail["105"] ?? "");
  const date = toDateStr(decryptedMail["107"]);

  const resolvedPath =
    options.outputPath != null && options.outputPath !== ""
      ? options.outputPath
      : path.join(
          options.outputDir != null && options.outputDir !== "" ? options.outputDir : process.cwd(),
          sanitizeEmlFilename(date, subject)
        );

  if (skipIfExists && fs.existsSync(resolvedPath)) {
    return { path: resolvedPath };
  }

  const eml = buildEml({
    from,
    subject,
    date,
    bodyText,
  });

  const dir = path.dirname(resolvedPath);
  if (dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolvedPath, eml, "utf8");

  let attachmentPaths: string[] | undefined;
  if (includeAttachments) {
    const baseName = path.basename(resolvedPath, path.extname(resolvedPath));
    const attachmentDir = path.join(dir, `${baseName}-attachments`);
    const saved = await runAttachmentDownload(
      mailId,
      {
        outputDir: attachmentDir,
        verbose,
      },
      context
    );
    attachmentPaths = saved.map((s) => s.path);
  }

  return { path: resolvedPath, attachmentPaths };
}

export { sanitizeEmlFilename };
