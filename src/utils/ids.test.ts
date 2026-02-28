import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  elementIdFromIdRaw,
  elementIdFromEntry,
  mailIdFromMailSetEntry,
} from "./ids.js";

describe("ids", () => {
  describe("elementIdFromIdRaw", () => {
    test("returns undefined for null and undefined", () => {
      assert.equal(elementIdFromIdRaw(null), undefined);
      assert.equal(elementIdFromIdRaw(undefined), undefined);
    });

    test("extracts last element from array of length >= 2", () => {
      assert.equal(elementIdFromIdRaw(["listId", "elementId"]), "elementId");
      assert.equal(elementIdFromIdRaw(["a", "b", "c"]), "c");
    });

    test("extracts single element from array of length 1", () => {
      assert.equal(elementIdFromIdRaw(["only"]), "only");
    });

    test("returns string as-is when not empty", () => {
      assert.equal(elementIdFromIdRaw("elem123"), "elem123");
    });

    test("returns undefined for empty string", () => {
      assert.equal(elementIdFromIdRaw(""), undefined);
    });
  });

  describe("elementIdFromEntry", () => {
    test("uses 1452 when present", () => {
      const entry = { "1452": "id-from-1452", "431": "other", _id: "fallback" };
      assert.equal(elementIdFromEntry(entry), "id-from-1452");
    });

    test("falls back to 431 when 1452 missing", () => {
      const entry = { "431": ["listId", "elem431"], _id: "fallback" };
      assert.equal(elementIdFromEntry(entry), "elem431");
    });

    test("falls back to _id when 1452 and 431 missing", () => {
      const entry = { _id: "fallback-id" };
      assert.equal(elementIdFromEntry(entry), "fallback-id");
    });

    test("returns undefined when all missing", () => {
      const entry = {};
      assert.equal(elementIdFromEntry(entry), undefined);
    });
  });

  describe("mailIdFromMailSetEntry", () => {
    test("builds listId/elementId from array ref in 1456", () => {
      const entry = { "1456": ["listId", "elementId"] };
      assert.equal(mailIdFromMailSetEntry(entry), "listId/elementId");
    });

    test("unwraps single-element array for 1456", () => {
      const entry = { "1456": [["listId", "elementId"]] };
      assert.equal(mailIdFromMailSetEntry(entry), "listId/elementId");
    });

    test("handles single-element ref as listId/", () => {
      const entry = { "1456": [["listId"]] };
      assert.equal(mailIdFromMailSetEntry(entry), "listId/");
    });

    test("returns empty string when 1456 missing", () => {
      const entry = {};
      assert.equal(mailIdFromMailSetEntry(entry), "");
    });

    test("returns empty string when 1456 is null", () => {
      const entry = { "1456": null };
      assert.equal(mailIdFromMailSetEntry(entry), "");
    });
  });
});
