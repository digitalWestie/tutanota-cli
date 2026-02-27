import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildEml, sanitizeEmlFilename } from "./eml.js";

describe("buildEml", () => {
  test("produces headers and body with CRLF", () => {
    const out = buildEml({
      from: "a@b.com",
      subject: "Hello",
      date: "2026-02-27T12:00:00.000Z",
      bodyText: "Body text",
    });
    assert.ok(out.includes("From: a@b.com"));
    assert.ok(out.includes("Subject: Hello"));
    assert.ok(out.includes("Date:"));
    assert.ok(out.includes("MIME-Version: 1.0"));
    assert.ok(out.includes("Content-Type: text/plain"));
    assert.ok(out.includes("\r\n\r\n"));
    assert.ok(out.includes("Body text"));
  });

  test("includes optional To, Cc, Bcc when provided", () => {
    const out = buildEml({
      from: "a@b.com",
      subject: "Hi",
      date: null,
      bodyText: "x",
      to: "b@b.com",
      cc: "c@b.com",
      bcc: "d@b.com",
    });
    assert.ok(out.includes("To: b@b.com"));
    assert.ok(out.includes("Cc: c@b.com"));
    assert.ok(out.includes("Bcc: d@b.com"));
  });

  test("sanitizes newlines in header values", () => {
    const out = buildEml({
      from: "a@b.com\ninjected",
      subject: "Sub\r\nject",
      date: "2026-02-27T12:00:00.000Z",
      bodyText: "Body",
    });
    assert.ok(!out.includes("a@b.com\n"));
    assert.ok(!out.includes("Sub\r\nject"));
  });
});

describe("sanitizeEmlFilename", () => {
  test("produces date and subject slug with .eml extension (no spaces)", () => {
    const name = sanitizeEmlFilename("2026-02-27T14:30:00.000Z", "Test subject");
    assert.ok(name.endsWith(".eml"));
    assert.ok(name.startsWith("2026-02-27-"));
    assert.ok(name.includes("Test_subject"));
    assert.ok(!name.includes(" "));
  });

  test("replaces spaces with underscores (no spaces in filename)", () => {
    const name = sanitizeEmlFilename("2026-02-27T12:00:00.000Z", "Hello  world   subject");
    assert.ok(!name.includes(" "));
    assert.ok(name.includes("Hello_world_subject"));
  });

  test("replaces unsafe filesystem chars in subject", () => {
    const name = sanitizeEmlFilename("2026-02-27T12:00:00.000Z", "a/b*c?.eml");
    assert.ok(!/[\\*?"<>|]/.test(name));
    assert.ok(name.endsWith(".eml"));
  });

  test("handles null date", () => {
    const name = sanitizeEmlFilename(null, "Subject");
    assert.ok(name.startsWith("unknown-date"));
    assert.ok(name.endsWith(".eml"));
  });

  test("truncates long subject", () => {
    const long = "a".repeat(100);
    const name = sanitizeEmlFilename("2026-02-27T12:00:00.000Z", long);
    assert.ok(name.length < 100 + 30);
  });
});
