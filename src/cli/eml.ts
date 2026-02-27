// SHOULD WE BE USING A LIBRARY FOR THIS?

/**
 * Build RFC 5322-style EML content and safe filenames for exported messages.
 */

export interface EmlPayload {
  from: string;
  subject: string;
  date: string | null;
  bodyText: string;
  to?: string;
  cc?: string;
  bcc?: string;
}

/** Fold long header lines at 78 chars (RFC 5322 style) using CRLF and leading space. */
function foldHeaderLine(line: string, maxLen = 78): string {
  if (line.length <= maxLen) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > maxLen) {
    parts.push(rest.slice(0, maxLen));
    rest = rest.slice(maxLen);
  }
  if (rest.length > 0) parts.push(rest);
  return parts.join("\r\n ");
}

/** Sanitize a header value: strip CR/LF to avoid header injection. */
function sanitizeHeaderValue(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Build an EML string from headers and body (plain text only for v1).
 * Produces RFC 5322-style output: headers, blank line, body.
 */
export function buildEml(payload: EmlPayload): string {
  const from = sanitizeHeaderValue(payload.from);
  const subject = sanitizeHeaderValue(payload.subject);
  const date = payload.date != null ? formatDateRfc5322(payload.date) : new Date().toUTCString();
  const to = payload.to != null ? sanitizeHeaderValue(payload.to) : "";
  const cc = payload.cc != null ? sanitizeHeaderValue(payload.cc) : "";
  const bcc = payload.bcc != null ? sanitizeHeaderValue(payload.bcc) : "";

  const lines: string[] = [];
  lines.push(`From: ${foldHeaderLine(from)}`);
  if (to) lines.push(`To: ${foldHeaderLine(to)}`);
  if (cc) lines.push(`Cc: ${foldHeaderLine(cc)}`);
  if (bcc) lines.push(`Bcc: ${foldHeaderLine(bcc)}`);
  lines.push(`Subject: ${foldHeaderLine(subject)}`);
  lines.push(`Date: ${date}`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("");
  lines.push(payload.bodyText.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));

  return lines.join("\r\n");
}

/** Format ISO or timestamp date for RFC 5322 Date header (e.g. "Fri, 27 Feb 2026 12:00:00 +0000"). */
function formatDateRfc5322(isoOrTimestamp: string | number): string {
  const d =
    typeof isoOrTimestamp === "number"
      ? new Date(isoOrTimestamp)
      : /^\d+$/.test(String(isoOrTimestamp))
        ? new Date(Number(isoOrTimestamp))
        : new Date(isoOrTimestamp);
  if (Number.isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString().replace(" GMT", " +0000");
}

/** Max length for subject slug in filename. */
const EML_FILENAME_SUBJECT_MAX = 64;

/**
 * Produce a safe filename for an EML file from date and subject.
 * Format: YYYY-MM-DD-HHmm-subject-slug.eml (subject truncated and sanitized).
 */
export function sanitizeEmlFilename(date: string | null, subject: string): string {
  let datePart = "unknown-date";
  if (date != null && date !== "") {
    const d =
      typeof date === "number"
        ? new Date(date)
        : /^\d+$/.test(String(date))
          ? new Date(Number(date))
          : new Date(date);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      datePart = `${y}-${mo}-${day}-${h}${min}`;
    }
  }
  const slug = subject
    .replace(/[\0/\\:*?"<>|\r\n\t]/g, "_")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, EML_FILENAME_SUBJECT_MAX);
  const subjectPart = slug.length > 0 ? slug : "no-subject";
  return `${datePart}-${subjectPart}.eml`;
}
