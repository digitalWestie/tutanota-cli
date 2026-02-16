/**
 * Shared helpers for converting server/API values to bytes and unwrapping server response shapes.
 */

/**
 * Convert an unknown value to Uint8Array for use with tutanota-crypto.
 * Handles null, Uint8Array, base64 string, and array of numbers (server format).
 */
export function toUint8Array(value: unknown): Uint8Array {
  if (value == null) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new Uint8Array(Buffer.from(value, "base64"));
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  return new Uint8Array(0);
}

/**
 * Unwrap a value that the server may send as a single-element array.
 * Returns the element when value is an array of length 1; otherwise returns value unchanged.
 * For null/undefined returns null.
 */
export function unwrapSingleElementArray<T>(
  value: T | T[] | null | undefined
): T | T[] | null {
  if (value == null) return null;
  if (Array.isArray(value) && value.length === 1) return value[0];
  return value;
}
