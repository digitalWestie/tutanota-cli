/**
 * Shared mail formatting utilities. Used by message read, export, and envelope list.
 */

import type { ServerInstance } from "../crypto/decryptInstance.js";
import { unwrapSingleElementArray } from "../utils/bytes.js";

/** Extract sender address from decrypted Mail (attr 111 → 95). */
export function getSenderFromMail(decryptedMail: ServerInstance): string {
  const senderAgg = decryptedMail["111"];
  const sender = unwrapSingleElementArray(senderAgg);
  if (sender != null && typeof sender === "object" && "95" in sender) {
    return String((sender as Record<string, unknown>)["95"] ?? "");
  }
  return "";
}

/** Convert date value to ISO string or null. Handles Date, number, numeric string, and other strings. */
export function toDateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  const s = String(v);
  if (/^\d+$/.test(s)) return new Date(Number(s)).toISOString();
  return s;
}

/** Format date for pretty table: "YYYY-MM-DD HH:mm" in local time. */
export function formatDateForPretty(isoOrNull: string | number | null): string {
  if (isoOrNull == null || isoOrNull === "") return "";
  const parsed = parseDate(isoOrNull);
  if (parsed == null) return String(isoOrNull);
  const y = parsed.getFullYear();
  const mo = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const h = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${min}`;
}

function parseDate(isoOrNull: string | number | null): Date | null {
  if (isoOrNull == null || isoOrNull === "") return null;
  const parsed =
    typeof isoOrNull === "number"
      ? new Date(isoOrNull)
      : /^\d+$/.test(String(isoOrNull))
        ? new Date(Number(isoOrNull))
        : new Date(isoOrNull);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Format date for message read pretty: "YYYY-MM-DD HH:mm" in local time plus timezone offset (e.g. " +01:00" or " UTC"). */
export function formatDateWithTimezone(isoOrNull: string | number | null): string {
  const parsed = parseDate(isoOrNull);
  if (parsed == null) return "";
  const y = parsed.getFullYear();
  const mo = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const h = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  const offsetMin = -parsed.getTimezoneOffset();
  const tzStr =
    offsetMin === 0
      ? " UTC"
      : ` ${offsetMin > 0 ? "+" : "-"}${String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, "0")}:${String(Math.abs(offsetMin) % 60).padStart(2, "0")}`;
  return `${y}-${mo}-${day} ${h}:${min}${tzStr}`;
}
