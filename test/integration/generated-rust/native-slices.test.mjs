import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { writeGeneratedProject, runCargo } from "../../helpers/cargo-projects.mjs";

test("explicit slices retain native references, indexing and backing mutation on both source surfaces", { timeout: 300_000 }, () => {
  for (const surfaces of [[], ["js"]]) {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "lib", crateName: "native_slices" } },
      files: { "index.ts": `
import type { int32, nativeUint } from "@tsonic/core/types.js";
import type { Life, Ref, Mut, Slice } from "@tsonic/rust/types.js";
type Elements = Slice<int32>;
export function read<L extends Life>(values: Ref<Elements, L>, index: nativeUint): int32 {
  return values[index];
}
export function write<L extends Life>(values: Mut<Elements, L>, index: nativeUint, value: int32): void {
  values[index] = value;
}
export function narrow(values: Ref<Slice<int32>>, index: int32): int32 {
  return values[index];
}
` } });
    assert.deepEqual(result.diagnostics, []);
    const output = artifactText(result, "src/index.rs");
    assert.match(output, /index: usize/u);
    assert.match(output, /values\[index\]/u);
    assert.doesNotMatch(output, /JsArray|Location|RefCell|f64|u64_to_f64/u);
    const root = writeGeneratedProject(`native-slices-${surfaces.length}`, result.artifacts);
    mkdirSync(join(root, "tests"), { recursive: true });
    writeFileSync(join(root, "tests/slices.rs"), `
use native_slices::index::{narrow, read, write};
#[test]
fn native_storage_is_borrowed_not_copied() {
    let mut values = [3, 4, 5];
    assert_eq!(read(&values, 1), 4);
    write(&mut values, 1, 7);
    assert_eq!(values, [3, 7, 5]);
    assert_eq!(narrow(&values, 2), 5);
}
#[test]
#[should_panic]
fn negative_index_is_rejected() { narrow(&[1], -1); }
#[test]
#[should_panic]
fn out_of_bounds_is_rejected() { read(&[1], 1); }
`);
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["test", "--locked", "--offline"]);
  }
});
