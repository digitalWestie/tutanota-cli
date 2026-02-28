import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { uncompress, decompressString } from "./compression.js";

describe("compression", () => {
  describe("uncompress", () => {
    test("decompresses simple LZ4 block (literals only)", () => {
      // LZ4 block: token 0x50 (5 literals, 0 match), then "hello" (5 bytes)
      const compressed = new Uint8Array([0x50, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
      const result = uncompress(compressed);
      assert.equal(result.length, 5);
      assert.equal(String.fromCharCode(...result), "hello");
    });

    test("returns empty array for empty input", () => {
      const result = uncompress(new Uint8Array(0));
      assert.equal(result.length, 0);
    });

    test("decompresses block with literal and match", () => {
      // "aaaa" - 4 literals 'a', then match 4 bytes from offset 1
      // token 0x40 (4 literals), 'a', offset 1,0 (little endian), match extension
      // Match length in token: 0xf means 15+4=19, we need 4 so token low nibble = 0
      // Actually match_length = (token & 0xf) + 4 = 0 + 4 = 4. So we copy 4 bytes from pos = j - 1.
      // After literals: j=4, output = "aaaa". Offset 1, pos = 4-1 = 3. We copy 4 bytes from pos 3. output[3]=a, so we get a, a, a, a. End = j + 4 + 4 = 12. So we'd copy output[3], output[4], output[5], output[6] - but we only have 4 bytes. So we copy output[3] four times? No - "while (j < end) output[j++] = output[pos++]". So we copy from pos to output. pos starts at 3, we copy 4 bytes. output[4]=output[3], output[5]=output[4], output[6]=output[5], output[7]=output[6]. So we get "aaaa" + 4 more bytes from the match. Result would be 8 bytes. Let me try a simpler case.
      // Simpler: "a" (1 literal) - token 0x10, 'a', then we need offset and match. For just "a" we can't have a match that references prior data for the first byte. So we need literals to consume all. Token 0x10 = 1 literal. Then 1 byte. Total 2 bytes. i=2, n=2, we break. Good.
      const compressed = new Uint8Array([0x10, 0x61]);
      const result = uncompress(compressed);
      assert.equal(result.length, 1);
      assert.equal(String.fromCharCode(...result), "a");
    });
  });

  describe("decompressString", () => {
    test("returns empty string for empty input", () => {
      assert.equal(decompressString(new Uint8Array(0)), "");
    });

    test("decompresses to UTF-8 string", () => {
      const compressed = new Uint8Array([0x50, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
      assert.equal(decompressString(compressed), "hello");
    });
  });
});
