import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { RustNativeEvidence } from "./evidence.js";

export function validateRustNativeEvidenceInputs(evidence: RustNativeEvidence): void {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (const input of evidence.inputs) {
    const descriptor = openSync(input.path, "r");
    try {
      const status = fstatSync(descriptor);
      if (!status.isFile() || status.size !== input.byteLength) {
        throw new Error(`Native Rust checked input changed: ${input.path}`);
      }
      const hash = createHash("sha256");
      let remaining = input.byteLength;
      while (remaining > 0) {
        const count = readSync(descriptor, buffer, 0, Math.min(remaining, buffer.length), null);
        if (count === 0) throw new Error(`Native Rust checked input was truncated: ${input.path}`);
        hash.update(buffer.subarray(0, count));
        remaining -= count;
      }
      if (readSync(descriptor, buffer, 0, 1, null) !== 0 || hash.digest("hex") !== input.digest) {
        throw new Error(`Native Rust checked input changed: ${input.path}`);
      }
    } finally {
      closeSync(descriptor);
    }
  }
}
