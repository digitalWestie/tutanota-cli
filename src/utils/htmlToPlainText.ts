/**
 * Strip HTML tags and normalize whitespace for terminal display.
 * Used when displaying mail body in message read.
 */
export function htmlToPlainText(html: string): string {
  if (html.trim() === "") return "";
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/ {8,}/g, "\n");
  const lines = withBreaks.split("\n").map((line) => line.trim());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
