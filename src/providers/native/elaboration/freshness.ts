import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import type { RustNativeSemanticEvidence } from "./evidence.js";
import type { RustNativeSourceFile } from "./input.js";

export function validateRustNativeEvidenceInputs(evidence: RustNativeSemanticEvidence, sources: readonly RustNativeSourceFile[]): void {
  const files = new Map(sources.map(source => [source.path, source.text]));
  if (files.size !== sources.length) throw new Error("Native Rust source input has a duplicate filename.");
  for (const probe of evidence.probes) {
    if ((files.has(probe.path) || existsSync(probe.path)) !== probe.exists) {
      throw new Error(`Native Rust checked source lookup changed: ${probe.path}`);
    }
  }
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (const input of evidence.inputs) {
    const source = files.get(input.path);
    if (source !== undefined) {
      if (Buffer.byteLength(source, "utf8") !== input.byteLength || createHash("sha256").update(source).digest("hex") !== input.digest) {
        throw new Error(`Native Rust checked input changed: ${input.path}`);
      }
      continue;
    }
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
