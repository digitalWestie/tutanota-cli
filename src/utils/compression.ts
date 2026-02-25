/**
 * lz4 compression/decompression routines adopted from the node-lz4 library
 * https://github.com/pierrec/node-lz4
 * (which is a port of the original LZ4 library http://www.lz4.org).
 *
 * node-lz4 does a lot of things we don't need and drags Node Buffer and
 * whatnot with it and subsequently weights 103KB.
 *
 * Modified to include auto-resizing of the buffer and slicing of the data.
 */

/*
Copyright (c) 2012 Pierre Curto

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
 */


/**
 * LZ4 block decompression (decode only). Used for MailDetailsBlob body compressedText.
 * Logic from tutanota src/common/api/worker/Compression.ts (uncompress).
 */

import { utf8Uint8ArrayToString } from "@tutao/tutanota-utils";

export function uncompress(input: Uint8Array): Uint8Array {
  const endIndex = input.length;
  let output = new Uint8Array(input.length * 6);
  let j = 0;

  for (let i = 0, n = endIndex; i < n; ) {
    let token = input[i++];
    let literals_length = token >> 4;

    if (literals_length > 0) {
      let l = literals_length + 240;
      while (l === 255) {
        l = input[i++];
        literals_length += l;
      }
      let end = i + literals_length;
      const sizeNeeded = j + (end - i);
      if (output.length < sizeNeeded) {
        const newOutput = new Uint8Array(Math.max(output.length * 2, sizeNeeded));
        newOutput.set(output);
        output = newOutput;
      }
      while (i < end) output[j++] = input[i++];
      if (i === n) break;
    }

    let offset = input[i++] | (input[i++] << 8);
    if (offset === 0 || offset > j) {
      throw new Error(`Invalid LZ4 offset`);
    }
    let match_length = token & 0xf;
    let l = match_length + 240;
    while (l === 255) {
      l = input[i++];
      match_length += l;
    }
    let pos = j - offset;
    let end = j + match_length + 4;
    if (output.length < end) {
      const newOutput = new Uint8Array(Math.max(output.length * 2, end));
      newOutput.set(output);
      output = newOutput;
    }
    while (j < end) output[j++] = output[pos++];
  }
  return output.slice(0, j);
}

export function decompressString(compressed: Uint8Array): string {
  if (compressed.length === 0) return "";
  return utf8Uint8ArrayToString(uncompress(compressed));
}
