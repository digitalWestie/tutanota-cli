/**
 * Shared mail-id parsing. Use format listId/elementId (e.g. from 'envelope list --format json').
 */

/** Parse mail-id string into [listId, elementId]. */
export function parseMailId(mailId: string): [string, string] {
  const trimmed = mailId.trim();
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) return [parts[0].trim(), parts[1].trim()];
  }
  throw new Error(`Invalid mail-id: "${mailId}". Use format listId/elementId (e.g. from 'envelope list --format json').`);
}
