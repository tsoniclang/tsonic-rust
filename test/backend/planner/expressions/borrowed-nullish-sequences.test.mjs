import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust, artifactText } from "../../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../../helpers/native-ownership-cost.mjs";
import { borrowedNullishSequencesSource, incompatibleBorrowedSequenceSource, mutableBorrowedHeaderSource } from "../../../../../tsonic/test/fixtures/borrowed-nullish-sequences.mjs";
import { createTsonicPlugin } from "../../../../../rust-nodejs/dist/index.js";

for (const surfaces of [[], ["js"]]) {
  test(`native nullish sequences retain backing until the authored snapshot (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, capabilities: [createTsonicPlugin()],
      target: { id: "rust", options: { outputType: "lib", crateName: "borrowed_nullish_sequences" } },
      files: { "index.ts": borrowedNullishSequencesSource } });
    assert.deepEqual(result.diagnostics, []);
    const output = artifactText(result, "src/index.rs");
    assert.doesNotMatch(output, /\.to_vec\(|\.collect\(|Box<dyn|Vec\s*<\s*Vec\s*<|option_coalesce/u);
    assert.match(output, /if let Some\(sequence_\d+\) = headers\.get_values\(&key\)\?\.as_ref\(\)/u);
    assert.match(output, /array\.extend_from_slice\(sequence_\d+\)/u);
    const joined = output.slice(output.indexOf("pub fn joinFromHeaders"), output.indexOf("pub fn chooseLazy"));
    assert.match(joined, /for value in [\s\S]*\.iter\(\)/u);
    assert.match(joined, /result\.push_str\(value\.as_str\(\)\)/u);
    assert.doesNotMatch(joined, /iter_cloned|String::from\(value|clone\(/u);
    const root = writeGeneratedProject(`borrowed-nullish-sequences-${surfaces[0] ?? "native"}`, result.artifacts);
    mkdirSync(join(root, "tests"), { recursive: true });
    const authored = surfaces.length === 0 ? "Vec<String>" : "JsArray<String>";
    const values = surfaces.length === 0 ? 'vec!["authored".to_owned(), "second".to_owned()]' : 'JsArray::from_dense(vec!["authored".to_owned(), "second".to_owned()])';
    const check = surfaces.length === 0 ? 'assert_eq!(result, ["authored", "second"]); result[0] = "changed".to_owned(); assert_eq!(authored[0], "authored");'
      : 'assert_eq!(result.get(0), Some("authored".to_owned())); result.set(0, "changed".to_owned()); assert_eq!(authored.get(0), Some("authored".to_owned()));';
    const nativeCheck = surfaces.length === 0 ? 'assert_eq!(result, ["native", "tail"]);'
      : 'assert_eq!(result.get(0), Some("native".to_owned()));';
    const nativeValues = surfaces.length === 0 ? 'vec!["native".to_owned(), "tail".to_owned()]'
      : 'JsArray::from_dense(vec!["native".to_owned(), "tail".to_owned()])';
    const hand = surfaces.length === 0
      ? "let mut result = Vec::new(); if let Some(source) = authored.as_ref() { result.extend_from_slice(source); } else if let Some(source) = native.as_ref() { result.extend_from_slice(source); } result"
      : "let mut result = Vec::new(); if let Some(source) = authored.as_ref() { source.with_values(|values| result.extend_from_slice(values)); } else if let Some(source) = native.as_ref() { source.with_values(|values| result.extend_from_slice(values)); } JsArray::from_dense(result)";
    const snapshotCall = surfaces.length === 0 ? "index::snapshot(&backing)" : "index::snapshot(native.clone())";
    const snapshotHand = surfaces.length === 0 ? "{ let mut result = Vec::new(); result.extend_from_slice(&backing); result }"
      : "{ let mut result = Vec::new(); native.with_values(|values| result.extend_from_slice(values)); JsArray::from_dense(result) }";
    const fallbackValues = surfaces.length === 0 ? 'vec!["fallback".to_owned()]' : 'JsArray::from_dense(vec!["fallback".to_owned()])';
    const mixedValues = surfaces.length === 0 ? 'assert_eq!(mixed, ["before", "fallback", "after"]);'
      : 'assert_eq!(mixed.get(0), Some("before".to_owned())); assert_eq!(mixed.get(1), Some("fallback".to_owned())); assert_eq!(mixed.get(2), Some("after".to_owned()));';
    writeFileSync(join(root, "tests/selection.rs"), `${nativeOwnershipCostSupport}
use borrowed_nullish_sequences::index;
${surfaces.length === 0 ? "" : "use tsonic_rust_js::JsArray;"}

fn handwritten(authored: Option<${authored}>, native: Option<${authored}>) -> ${authored} { ${hand} }

#[test]
fn native_selection_aliasing_and_cost() {
    let authored = ${values};
    let native = ${nativeValues};
    let ${surfaces.length === 0 ? "mut " : ""}result = index::choose(Some(authored.clone()), Some(native.clone()));
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
    let backing = ${surfaces.length === 0 ? 'vec!["native".to_owned(), "tail".to_owned()]' : '["native".to_owned(), "tail".to_owned()]'};
    for _ in 0..1000 {
        let (generated, generated_cost) = measure(|| ${snapshotCall});
        let (handwritten, handwritten_cost) = measure(|| ${snapshotHand});
        assert_eq!(generated.len(), handwritten.len());
        assert_eq!(generated_cost, handwritten_cost);
    }
    assert_eq!(backing[0], "native");
    let headers = tsonic_rust_node::http::IncomingHttpHeaders::default();
    assert_eq!(index::chooseFromHeaders(None, headers.clone(), "missing".to_owned()).unwrap().len(), 0);
    assert_eq!(index::snapshotFromHeaders(headers.clone(), "missing".to_owned()).unwrap().len(), 0);
    assert_eq!(index::firstFromHeaders(headers.clone(), "missing".to_owned()).unwrap(), None);
    assert_eq!(index::joinFromHeaders(headers, "missing".to_owned()).unwrap(), "");
    let eager = tsonic_rust_runtime::Callable::new(|()| panic!("Eager fallback."));
    assert_eq!(index::chooseLazy(Some(authored), Some(native), eager).unwrap().len(), 4);
    let calls = std::rc::Rc::new(std::cell::Cell::new(0));
    let called = calls.clone();
    let lazy = tsonic_rust_runtime::Callable::new(move |()| {
        called.set(called.get() + 1);
        Ok(${fallbackValues})
    });
    let mixed = index::chooseLazy(None, None, lazy).unwrap();
    ${mixedValues}
    assert_eq!(calls.get(), 1);
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

test("borrowed native header values cannot promise a mutable source alias", () => {
  assert.throws(() => compileRust({ surfaces: ["js"], capabilities: [createTsonicPlugin()],
    files: { "index.ts": mutableBorrowedHeaderSource } }), /TypeScript diagnostics:/u);
});
