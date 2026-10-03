import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust, artifactText } from "../../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../../helpers/native-ownership-cost.mjs";
import { borrowedNullishSequencesSource, incompatibleBorrowedSequenceSource } from "../../../../../tsonic/test/fixtures/borrowed-nullish-sequences.mjs";
import { createTsonicPlugin } from "../../../../../rust-nodejs/nodejs/dist/index.js";

for (const surfaces of [[], ["js"]]) {
  test(`native nullish sequences retain backing until the authored snapshot (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, capabilities: [createTsonicPlugin()],
      target: { id: "rust", options: { outputType: "lib", crateName: "borrowed_nullish_sequences" } },
      files: { "index.ts": borrowedNullishSequencesSource } });
    assert.deepEqual(result.diagnostics, []);
    const output = artifactText(result, "src/index.rs");
    assert.doesNotMatch(output, /\.to_vec\(|\.collect\(|Box<dyn|Vec<.*Vec</u);
    const root = writeGeneratedProject(`borrowed-nullish-sequences-${surfaces[0] ?? "native"}`, result.artifacts);
    mkdirSync(join(root, "tests"), { recursive: true });
    const authored = surfaces.length === 0 ? "Vec<String>" : "JsArray<String>";
    const values = surfaces.length === 0 ? 'vec!["authored".to_owned(), "second".to_owned()]' : 'JsArray::from_dense(vec!["authored".to_owned(), "second".to_owned()])';
    const check = surfaces.length === 0 ? 'assert_eq!(result, ["authored", "second"]); result[0] = "changed".to_owned(); assert_eq!(authored[0], "authored");'
      : 'assert_eq!(result.get(0), Some("authored".to_owned())); result.set(0, "changed".to_owned()); assert_eq!(authored.get(0), Some("authored".to_owned()));';
    const nativeCheck = surfaces.length === 0 ? 'assert_eq!(result, ["native", "tail"]);'
      : 'assert_eq!(result.get(0), Some("native".to_owned()));';
    const hand = surfaces.length === 0
      ? "let mut result = Vec::new(); if let Some(source) = authored { result.extend_from_slice(&source); } else if let Some(source) = native { source.with_values(|values| result.extend_from_slice(values)); } result"
      : "let selected = authored.or(native).unwrap_or_default(); let mut result = Vec::new(); selected.with_values(|values| result.extend_from_slice(values)); JsArray::from_dense(result)";
    writeFileSync(join(root, "tests/selection.rs"), `${nativeOwnershipCostSupport}
use borrowed_nullish_sequences::index;
use tsonic_rust_js::JsArray;

fn handwritten(authored: Option<${authored}>, native: Option<JsArray<String>>) -> ${authored} { ${hand} }

#[test]
fn native_selection_aliasing_and_cost() {
    let authored = ${values};
    let native = JsArray::from_dense(vec!["native".to_owned(), "tail".to_owned()]);
    let mut result = index::choose(Some(authored.clone()), Some(native.clone()));
    ${check}
    let result = index::choose(None, Some(native.clone()));
    ${nativeCheck}
    assert_eq!(index::choose(None, None).len(), 0);
    for selected in [Some(authored.clone()), None] {
        for _ in 0..1000 {
            let (generated, generated_cost) = measure(|| index::choose(selected.clone(), Some(native.clone())));
            let (handwritten, handwritten_cost) = measure(|| handwritten(selected.clone(), Some(native.clone())));
            assert_eq!(generated.len(), handwritten.len());
            assert_eq!(generated_cost, handwritten_cost);
        }
    }
}
`);
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["fmt", "--all"]);
    runCargo(root, ["fmt", "--all", "--check"]);
    runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(root, ["test", "--release", "--locked", "--offline"]);
  });
}

test("native sequence selection cannot admit incompatible element storage", () => {
  assert.throws(() => compileRust({ surfaces: ["js"], capabilities: [createTsonicPlugin()],
    files: { "index.ts": incompatibleBorrowedSequenceSource } }), /TypeScript diagnostics:/u);
});
