# liboqs.wasm

The `lib/liboqs.wasm` file provides Kyber (ML-KEM-1024) post-quantum cryptography used by TutaCrypt for decrypting unprocessed mail with `pubEncBucketKey`.

## How it was built

The WASM file is built from the [tutanota](https://github.com/tutao/tutanota) repository using Emscripten.

### Prerequisites

- **Emscripten 3.1.59** (or compatible). Install via [emsdk](https://github.com/emscripten-core/emsdk):

  ```bash
  git clone https://github.com/emscripten-core/emsdk.git
  cd emsdk
  ./emsdk install 3.1.59
  ./emsdk activate 3.1.59
  source ./emsdk_env.sh
  ```

### Build steps

From the tutanota repository root:

1. Initialize the liboqs submodule:
   ```bash
   git submodule update --init libs/webassembly/liboqs
   ```

2. Build liboqs.wasm:
   ```bash
   cd libs/webassembly
   make -f Makefile_liboqs build WASM=liboqs.wasm
   ```

3. Copy the built file into tutanota-cli:
   ```bash
   cp liboqs.wasm /path/to/tutanota-cli/lib/liboqs.wasm
   ```

### Associated versions

| Component | Version |
|-----------|---------|
| Emscripten | 3.1.59 |
| liboqs (submodule) | f4b96220e4bd208895172acc4fedb5a191d9f5b1 |
| tutanota-crypto | 327.260210.0 |
| Algorithm | ML-KEM-1024 (Kyber) |

The liboqs submodule in tutanota pins a specific commit. The build uses `libs/webassembly/Makefile_liboqs` and compiles the Kyber ML-KEM-1024 reference implementation plus tutanota-specific shims (`tuta_kem.c`).

### Compatibility

The built `liboqs.wasm` must match the `@tutao/tutanota-crypto` package version. If you upgrade tutanota-crypto, rebuild liboqs.wasm from the same tutanota release/commit.
