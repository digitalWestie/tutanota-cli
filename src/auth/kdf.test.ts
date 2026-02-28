import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { saltToUint8Array, deriveUserPassphraseKey, buildAuthVerifier } from "./kdf.js";
import { uint8ArrayToKey } from "@tutao/tutanota-crypto";

describe("kdf", () => {
  describe("saltToUint8Array", () => {
    test("decodes base64 string", () => {
      const salt = Buffer.from([1, 2, 3, 4]).toString("base64");
      const result = saltToUint8Array(salt);
      assert.equal(result.length, 4);
      assert.deepEqual(Array.from(result), [1, 2, 3, 4]);
    });

    test("converts array of numbers", () => {
      const result = saltToUint8Array([10, 20, 30]);
      assert.equal(result.length, 3);
      assert.deepEqual(Array.from(result), [10, 20, 30]);
    });

    test("returns Uint8Array unchanged", () => {
      const input = new Uint8Array([5, 6, 7]);
      const result = saltToUint8Array(input);
      assert.equal(result, input);
      assert.deepEqual(Array.from(result), [5, 6, 7]);
    });
  });

  describe("deriveUserPassphraseKey", () => {
    test("returns key for bcrypt (kdf 0)", async () => {
      const salt = new Uint8Array(16).fill(1);
      const key = await deriveUserPassphraseKey("testpassword", salt, "0");
      assert.ok(key != null);
      assert.equal(typeof key, "object");
    });

    test("returns key for argon2 (kdf 1)", async () => {
      const salt = new Uint8Array(16).fill(2);
      const key = await deriveUserPassphraseKey("testpassword", salt, "1");
      assert.ok(key != null);
      assert.equal(typeof key, "object");
    });
  });

  describe("buildAuthVerifier", () => {
    test("returns base64url string", () => {
      const key = uint8ArrayToKey(new Uint8Array(16).fill(42));
      const result = buildAuthVerifier(key);
      assert.equal(typeof result, "string");
      assert.ok(result.length > 0);
      assert.ok(!result.includes("+"));
      assert.ok(!result.includes("/"));
      assert.ok(!/[^A-Za-z0-9_-]/.test(result));
    });
  });
});
