import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeWordConversionsSource } from "../../../../tsonic/test/fixtures/native-word-conversions.mjs";

test("native-word conversions preserve exact values, absence and evaluation count", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_word_conversions" } },
    files: { "index.ts": `${nativeWordConversionsSource}
      export function main(): void { if (!run()) throw new Error("native word conversion"); }
    ` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /checked_integer::<usize>/u);
  assert.match(output, /value as usize/u);
  assert.doesNotMatch(output, /as f64|_to_f64|Box::new/u);
  validateGeneratedProject("native-word-conversions", result.artifacts, { run: true });
});

test("explicit native integer casts reject out-of-range values without floating transport", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "checked_native_integer_casts" } },
    files: { "index.ts": `
      import type { int32, int64, nativeUint, uint16, uint32, uint64 } from "@tsonic/core/types.js";
      function unsigned(value: int32): nativeUint { return value as nativeUint; }
      function narrow(value: uint32): uint16 { return value as uint16; }
      function signed(value: uint64): int64 { return value as int64; }
      function fromNumber(value: number): nativeUint { return value as nativeUint; }
      export function main(): void {
        let caught: int32 = 0;
        try { unsigned(-1); } catch { caught += 1; }
        try { narrow(65536); } catch { caught += 1; }
        try { signed(18446744073709551615n); } catch { caught += 1; }
        try { fromNumber(-1); } catch { caught += 1; }
        try { fromNumber(0.5); } catch { caught += 1; }
        try { fromNumber(Number.NaN); } catch { caught += 1; }
        try { fromNumber(Number.POSITIVE_INFINITY); } catch { caught += 1; }
        const wide: uint64 = 9007199254740993n;
        if (caught !== 7 || signed(wide) !== 9007199254740993n || narrow(65535) !== 65535 || fromNumber(65535) !== 65535) {
          throw new Error("checked integer range");
        }
      }
    ` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /as f64|_to_f64/u);
  validateGeneratedProject("checked-native-integer-casts", result.artifacts, { run: true });
});
