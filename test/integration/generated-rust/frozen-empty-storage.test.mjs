import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { frozenEmptyStorageSources, frozenEmptyStorageOpenSources, frozenEmptyStorageCrossFileSources } from "../../../../tsonic/test/fixtures/frozen-empty-storage.mjs";

function compile(source) {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.slice(0, 4).map(diagnostic => `${diagnostic.code}: ${diagnostic.message.slice(0, 256)}`).join("\n"));
  const text = artifactText(result, "src/index.rs");
  assert.equal(typeof text === "string" && text.length > 0, true, "actual generated source");
  assert.doesNotMatch(text, /FrozenObject|ConditionalWeakTable|transmute|unsafe\s*\{/u);
  const run = text.match(/^pub fn run\b[\s\S]*?^\}/mu)?.[0];
  assert.equal(run !== undefined, true, "the actual authored freeze-operation body is present");
  assert.doesNotMatch(run, /downcast/u);
  return { result, text };
}

function nativeInitialization(result) {
  return artifactText(result, "src/lib.rs").includes("pub fn initialize()") ? "crate::initialize();" : "";
}

const positiveSources = frozenEmptyStorageSources;

for (const [name, source] of positiveSources) {
  test(`broad empty freeze preserves native identity through ${name}`, { timeout: 300_000 }, () => {
    const { result, text } = compile(source);
    assert.match(text, /JsValue::(?:freeze_object_state|object_state_is_frozen)/u);
    const root = writeGeneratedProject(`frozen-empty-${name}`, result.artifacts);
    const index = join(root, "src/index.rs");
    writeFileSync(index, `${readFileSync(index, "utf8")}\n#[test]\nfn original_authored_identity_and_state() { ${nativeInitialization(result)} assert!(run()); }\n`);
    runCargo(root, ["test", "--offline", "--", "--test-threads=1"]);
  });
}

test("cross-file object signatures retain exact closed EmptyObject origins", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], files: frozenEmptyStorageCrossFileSources });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.slice(0, 4).map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
  const root = writeGeneratedProject("frozen-empty-cross-file", result.artifacts);
  const index = join(root, "src/index.rs");
  writeFileSync(index, `${readFileSync(index, "utf8")}\n#[test]\nfn cross_file_identity() { ${nativeInitialization(result)} assert!(run()); }\n`);
  runCargo(root, ["test", "--offline", "--", "--test-threads=1"]);
});

test("repeated broad freeze has exactly the handwritten native allocation and bytes", { timeout: 300_000 }, () => {
  const { result } = compile(`
    function retain(value: object): object { return value; }
    export function aliases(): boolean {
      const first: object = {};
      const alias = retain(first);
      const frozen = Object.freeze(first);
      return frozen === alias && first === alias && Object.isFrozen(first) && Object.isFrozen(alias);
    }
    export function run(): boolean {
      const value: object = {};
      let frozen = false;
      for (let iteration = 0; iteration < 20000; iteration += 1) {
        Object.freeze(value);
        frozen = Object.isFrozen(value);
      }
      return frozen;
    }
  `);
  const root = writeGeneratedProject("frozen-empty-allocation", result.artifacts);
  const index = join(root, "src/index.rs");
  writeFileSync(index, `${readFileSync(index, "utf8")}
#[cfg(test)]
mod freeze_costs {
    use super::*;
    use tsonic_rust_runtime as rt;
    ${nativeOwnershipCostSupport}
    fn handwritten() -> bool {
        let value = rt::EmptyObject::new();
        let mut frozen = false;
        for _iteration in 0..20000 {
            rt::freeze_object(&value);
            frozen = rt::object_is_frozen(&value);
        }
        frozen
    }
    fn handwritten_aliases() -> bool {
        let first = rt::EmptyObject::new();
        let alias = first.clone();
        let frozen = rt::freeze_object(&first);
        frozen == alias && first == alias && rt::object_is_frozen(&first) && rt::object_is_frozen(&alias)
    }
    #[test]
    fn original_broad_carrier_adds_no_allocation_or_bytes() {
        ${nativeInitialization(result)}
        let (generated, generated_cost) = measure(run);
        let (native, native_cost) = measure(handwritten);
        assert!(generated);
        assert!(native);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 1);
        assert_eq!(generated_cost.reallocations, 0);
        assert_eq!(std::mem::size_of::<rt::TsValue>(), 32);
        assert_eq!(std::mem::size_of::<tsonic_rust_js::JsValue>(), 40);
    }
    #[test]
    fn original_retain_aliases_match_native_identity_and_lifetime_cost() {
        ${nativeInitialization(result)}
        let (generated, generated_cost) = measure(aliases);
        let (native, native_cost) = measure(handwritten_aliases);
        assert!(generated);
        assert!(native);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 1);
        assert_eq!(generated_cost.reallocations, 0);
        assert_eq!(generated_cost.deallocations, 1);
    }
}
`);
  runCargo(root, ["test", "--offline", "--", "--test-threads=1"]);
});

const openSources = frozenEmptyStorageOpenSources;

for (const [name, source] of openSources) {
  test(`open empty freeze domain rejects ${name} before publication`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_SELECTED_OPERATION_UNSUPPORTED"), true,
      `exact operation owner rejection: ${result.diagnostics.slice(0, 3).map(diagnostic => diagnostic.code).join(",")}`);
    assert.equal(result.artifacts.length, 0, "rejected source publishes no artifacts");
  });
}

test("unrefined absence does not bypass checked non-absent source input", () => {
  assert.throws(() => compileRust({ surfaces: ["js"], files: { "index.ts":
    `export function run(value: object | null): object | null { return Object.freeze(value); }` } }),
    /TypeScript diagnostics:[\s\S]*TS2345[\s\S]*null/u);
});
