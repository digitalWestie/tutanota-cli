import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getSenderFromMail, toDateStr, formatDateForPretty } from "./mailUtils.js";

describe("mailUtils", () => {
  describe("getSenderFromMail", () => {
    test("extracts sender from attr 111 -> 95", () => {
      const mail = { "111": { "95": "alice@example.com" } };
      assert.equal(getSenderFromMail(mail), "alice@example.com");
    });

    test("unwraps single-element array for sender agg", () => {
      const mail = { "111": [{ "95": "bob@test.com" }] };
      assert.equal(getSenderFromMail(mail), "bob@test.com");
    });

    test("returns empty string when 111 missing", () => {
      const mail = {};
      assert.equal(getSenderFromMail(mail), "");
    });

    test("returns empty string when 95 missing in sender", () => {
      const mail = { "111": { "94": "Alice" } };
      assert.equal(getSenderFromMail(mail), "");
    });

    test("returns empty string when sender is null", () => {
      const mail = { "111": null };
      assert.equal(getSenderFromMail(mail), "");
    });
  });

  describe("toDateStr", () => {
    test("returns null for null and undefined", () => {
      assert.equal(toDateStr(null), null);
      assert.equal(toDateStr(undefined), null);
    });

    test("converts Date to ISO string", () => {
      const d = new Date("2026-02-27T12:00:00.000Z");
      assert.equal(toDateStr(d), "2026-02-27T12:00:00.000Z");
    });

    test("converts number timestamp to ISO string", () => {
      const ts = new Date("2026-02-27T12:00:00.000Z").getTime();
      assert.equal(toDateStr(ts), "2026-02-27T12:00:00.000Z");
    });

    test("converts numeric string to ISO string", () => {
      const ts = new Date("2026-02-27T12:00:00.000Z").getTime();
      assert.equal(toDateStr(String(ts)), "2026-02-27T12:00:00.000Z");
    });

    test("returns ISO string as-is when already ISO format", () => {
      const iso = "2026-02-27T12:00:00.000Z";
      assert.equal(toDateStr(iso), iso);
    });
  });

  describe("formatDateForPretty", () => {
    test("returns empty string for null and empty", () => {
      assert.equal(formatDateForPretty(null), "");
      assert.equal(formatDateForPretty(""), "");
    });

    test("formats number timestamp as YYYY-MM-DD HH:mm", () => {
      const ts = new Date("2026-02-27T14:30:00.000Z").getTime();
      const result = formatDateForPretty(ts);
      assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      assert.ok(result.includes("2026"));
      assert.ok(result.includes("02"));
      assert.ok(result.includes("27"));
    });

    test("formats numeric string timestamp", () => {
      const ts = new Date("2026-02-27T14:30:00.000Z").getTime();
      const result = formatDateForPretty(String(ts));
      assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    test("formats ISO string", () => {
      const result = formatDateForPretty("2026-02-27T14:30:00.000Z");
      assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    test("returns string as-is for invalid date", () => {
      assert.equal(formatDateForPretty("not-a-date"), "not-a-date");
    });
  });
});
