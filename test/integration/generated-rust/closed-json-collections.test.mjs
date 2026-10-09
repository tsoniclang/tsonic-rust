import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closedJsonCollectionSource } from "../../../../tsonic/test/fixtures/closed-json-collections.mjs";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("closed JSON collections preserve exact values across broad parameters without backing adapters", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": closedJsonCollectionSource },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5)
    .map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
  const generated = rustSourceText(result);
  assert.match(generated, /JsValue::object\(js_abi::JsObject::from_pairs\(\s*\[/u);
  assert.doesNotMatch(generated, /ObjectHandle::new/u);
  assert.equal(validateGeneratedProject("closed-json-collections", result.artifacts, { run: true }).status, 0);
});

test("fresh broad records have exactly the allocation cost of their handwritten native backing", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "lib", crateName: "closed_record_cost" } },
    files: { "index.ts": `
import type { int64 } from "@tsonic/core/types.js";
export function create(count: int64): unknown { return { count }; }
` },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5)
    .map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
  const root = writeGeneratedProject("closed-record-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), nativeOwnershipCostSupport + `
use closed_record_cost::index;
use tsonic_rust_js::{JsObject, JsValue, json};

fn handwritten(count: i64) -> JsValue {
    JsValue::object(JsObject::from_pairs([("count", JsValue::from(count))]))
}

#[test]
fn closed_record_has_no_intermediate_allocation_or_copy() {
    for _iteration in 0..100 {
        let (actual, actual_cost) = measure(|| index::create(std::hint::black_box(9_007_199_254_740_993)));
        let (expected, expected_cost) = measure(|| handwritten(std::hint::black_box(9_007_199_254_740_993)));
        assert_eq!(actual_cost, expected_cost);
        assert_eq!(json::stringify(&actual).unwrap(), json::stringify(&expected).unwrap());
        let (alias, alias_cost) = measure(|| actual.clone());
        assert_eq!(alias_cost, Cost::default());
        assert_eq!(actual.reference_identity_key(), alias.reference_identity_key());
        drop(alias);
        assert_eq!(measure(|| drop(actual)).1, measure(|| drop(expected)).1);
    }
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "ownership"]);
});
