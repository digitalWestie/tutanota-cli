/**
 * Shared helpers for extracting IDs from server/API response shapes.
 */

import { unwrapSingleElementArray } from "./bytes.js";

/** Extract element id from idRaw (array [listId, elementId], single element, or string). */
export function elementIdFromIdRaw(idRaw: unknown): string | undefined {
  if (idRaw == null) return undefined;
  if (Array.isArray(idRaw) && idRaw.length >= 2) return String(idRaw[idRaw.length - 1] ?? "");
  if (Array.isArray(idRaw) && idRaw.length === 1) return String(idRaw[0] ?? "");
  const s = String(idRaw);
  return s === "" ? undefined : s;
}

/** Extract element id from last entry in a list (MailSetEntry). Tries 1452, 431, _id. */
export function elementIdFromEntry(entry: Record<string, unknown>): string | undefined {
  return elementIdFromIdRaw(entry["1452"]) ?? elementIdFromIdRaw(entry["431"]) ?? elementIdFromIdRaw(entry["_id"]);
}

/** Build mail-id string (listId/elementId) from MailSetEntry. Uses attribute 1456 (mail ref). */
export function mailIdFromMailSetEntry(entry: Record<string, unknown>): string {
  const mailRefRaw = entry["1456"];
  const mailRef = unwrapSingleElementArray(mailRefRaw);
  if (Array.isArray(mailRef) && mailRef.length >= 2) {
    return String(mailRef[0]) + "/" + String(mailRef[1]);
  }
  if (Array.isArray(mailRef) && mailRef.length === 1) {
    return String(mailRef[0]) + "/";
  }
  return String(mailRef ?? "");
}
