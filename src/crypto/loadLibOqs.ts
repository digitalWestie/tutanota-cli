/**
 * Load liboqs WASM for Kyber (ML-KEM-1024) operations used by TutaCrypt.
 * The WASM file is built from the tutanota repo - see docs/liboqs.wasm.md.
 */

import type { LibOQSExports } from "@tutao/tutanota-crypto";
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let liboqsPromise: Promise<LibOQSExports> | null = null;

/**
 * Load and instantiate liboqs.wasm. Cached after first load.
 */
export async function loadLibOqs(): Promise<LibOQSExports> {
  if (liboqsPromise != null) return liboqsPromise;
  liboqsPromise = (async () => {
    const wasmPath = join(__dirname, "..", "lib", "liboqs.wasm");
    const buf = await readFile(wasmPath);
    const { instance } = await WebAssembly.instantiate(buf);
    return instance.exports as unknown as LibOQSExports;
  })();
  return liboqsPromise;
}
