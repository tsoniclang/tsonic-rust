import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { nativePropertyProjectionSource, nativePropertyProjectionCostSource } from "../../../../tsonic/test/fixtures/native-property-projections.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("native property projections preserve selected generic inherited getters and exact failure identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "property_projections" } },
    files: { "index.ts": nativePropertyProjectionSource + `
      export function main(): void {
        if (!run()) throw new Error("native selected property projection");
      }
    ` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.equal(result.artifacts.length > 0, true, "complete native artifacts are required");
  validateGeneratedProject("property-projections", result.artifacts, { run: true });
});

test("selected native property reads add no allocation beyond handwritten required API values", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "lib", crateName: "property_projection_cost" } },
    files: { "index.ts": nativePropertyProjectionCostSource },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const root = writeGeneratedProject("property-projection-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/cost.rs"), nativeOwnershipCostSupport + `
use property_projection_cost::index;
use tsonic_rust_js::abi as js;

fn handwritten(options: index::Options) -> String {
    js::integer_to_locale_string_with_options(9007199254740993_i64, "en",
        &js::js_value_from_optional_pairs(vec![Some(("useGrouping",
            js::JsValue::from(options.dispatch.read_options_use_grouping())))])).unwrap()
}

#[test]
fn selected_reads_match_handwritten_owned_values() {
    let options = index::Options::new();
    assert_eq!(index::format(options.clone()).unwrap(), "9007199254740993");
    assert_eq!(handwritten(options.clone()), "9007199254740993");
    let generated = measure(|| {
        let mut total = 0;
        for _iteration in 0..1000 {
            total += index::format(std::hint::black_box(options.clone())).unwrap().len();
        }
        total
    });
    let native = measure(|| {
        let mut total = 0;
        for _iteration in 0..1000 {
            total += handwritten(std::hint::black_box(options.clone())).len();
        }
        total
    });
    assert_eq!(generated.0, 16000);
    assert_eq!(generated, native);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "cost"]);
});
