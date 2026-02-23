import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { toUint8Array, unwrapSingleElementArray } from "./bytes.js";

describe("bytes", () => {
  describe("toUint8Array", () => {
    test("returns empty Uint8Array for null and undefined", () => {
      assert.deepEqual(toUint8Array(null), new Uint8Array(0));
      assert.deepEqual(toUint8Array(undefined), new Uint8Array(0));
    });

    test("returns same Uint8Array when given Uint8Array", () => {
      const arr = new Uint8Array([1, 2, 3]);
      const result = toUint8Array(arr);
      assert.strictEqual(result, arr);
      assert.deepEqual(result, new Uint8Array([1, 2, 3]));
    });

    test("decodes base64 string to Uint8Array", () => {
      // "AAAA" decodes to three zero bytes in standard base64
      const result = toUint8Array("AAAA");
      assert.deepEqual(result, new Uint8Array(Buffer.from("AAAA", "base64")));
      assert.equal(result.length, 3);
      assert.deepEqual(result, new Uint8Array([0, 0, 0]));
    });

    test("decodes empty base64 string to empty Uint8Array", () => {
      const result = toUint8Array("");
      assert.deepEqual(result, new Uint8Array(0));
    });

    test("converts array of numbers to Uint8Array", () => {
      const result = toUint8Array([10, 20, 255]);
      assert.deepEqual(result, new Uint8Array([10, 20, 255]));
    });

    test("converts empty array to empty Uint8Array", () => {
      const result = toUint8Array([]);
      assert.deepEqual(result, new Uint8Array(0));
    });

    test("returns empty Uint8Array for other types (e.g. object, number)", () => {
      assert.deepEqual(toUint8Array({}), new Uint8Array(0));
      assert.deepEqual(toUint8Array(42), new Uint8Array(0));
      assert.deepEqual(toUint8Array(true), new Uint8Array(0));
    });
  });

  describe("unwrapSingleElementArray", () => {
    test("returns null for null and undefined", () => {
      assert.strictEqual(unwrapSingleElementArray(null), null);
      assert.strictEqual(unwrapSingleElementArray(undefined), null);
    });

    test("returns element when value is array of length 1", () => {
      assert.strictEqual(unwrapSingleElementArray([99]), 99);
      assert.deepEqual(unwrapSingleElementArray([{ a: 1 }]), { a: 1 });
      assert.strictEqual(unwrapSingleElementArray(["x"]), "x");
    });

    test("returns value unchanged when array length is not 1", () => {
      assert.deepEqual(unwrapSingleElementArray([]), []);
      assert.deepEqual(unwrapSingleElementArray([1, 2]), [1, 2]);
      assert.deepEqual(unwrapSingleElementArray([1, 2, 3]), [1, 2, 3]);
    });

    test("returns value unchanged when not an array", () => {
      assert.strictEqual(unwrapSingleElementArray("hello"), "hello");
      assert.strictEqual(unwrapSingleElementArray(42), 42);
      assert.deepEqual(unwrapSingleElementArray({ k: "v" }), { k: "v" });
    });
  });
});
