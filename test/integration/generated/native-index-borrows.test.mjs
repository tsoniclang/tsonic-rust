import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("native indexed String comparisons borrow without allocation and retain mutation snapshots", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: {
    outputType: "lib", crateName: "native_index_borrow_cost",
  } }, files: { "index.ts": `
export function observe(values: readonly string[], index: number, expected: string): boolean {
  return values[index]! === expected;
}
function replace(values: string[], index: number): string { values[index] = "after"; return "before"; }
export function snapshot(values: string[], left: number, right: number): boolean {
  return values[left]! === replace(values, right);
}
function append(values: string[]): number { values.push("tail"); return 1; }
export function effectful(values: string[]): boolean { return values[append(values)]! === "tail"; }
function callbackIndex(values: readonly string[], select: () => number): boolean { return values[select()]! === "tail"; }
export function verify_callback(): boolean {
  const values = ["head", "tail"];
  let calls = 0;
  const result = callbackIndex(values, (): number => { calls = calls + 1; return 1; });
  return result && calls === 1;
}
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const generated = artifactText(result, "src/index.rs");
  const observation = generated.split("pub fn observe(")[1]?.split(/\n(?:pub(?:\([^)]*\))? )?fn /u)[0];
  assert.equal(observation !== undefined, true, "the actual selected native observation function is emitted");
  assert.doesNotMatch(observation, /\.clone\(|to_owned\(|to_string\(|Box::|JsValue/u,
    "native collection and comparison recipes introduce no copy, allocation or dynamic carrier");
  assert.match(generated, /pub fn snapshot\([\s\S]*?\.clone\(/u,
    "the mutating RHS retains its exact first-value String snapshot");
  const root = writeGeneratedProject("native-index-borrow-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), `${nativeOwnershipCostSupport(root)}
use native_index_borrow_cost::index;

#[test]
fn shared_native_index_matches_direct_native_allocation_cost() {
    let values = vec![String::from("before")];
    let expected = String::from("before");
    for _ in 0..32 {
        let (generated, generated_cost) = measure(|| index::observe(&values, 0.0, &expected).unwrap());
        let (native, native_cost) = measure(|| values[0].as_str() == expected.as_str());
        assert_eq!(generated, native);
        assert!(generated);
        assert_eq!(generated_cost, Cost::default());
        assert_eq!(generated_cost, native_cost);
    }
}

#[test]
fn actual_aliasing_indices_compare_the_value_before_rhs_mutation() {
    let mut values = vec![String::from("before")];
    assert!(index::snapshot(&mut values, 0.0, 0.0).unwrap());
    assert_eq!(values[0], "after");
}

#[test]
fn index_computation_can_reallocate_before_the_final_element_borrow() {
    let mut generated_values = Vec::with_capacity(1);
    generated_values.push(String::from("head"));
    let mut native_values = Vec::with_capacity(1);
    native_values.push(String::from("head"));
    let (generated, generated_cost) = measure(|| index::effectful(&mut generated_values).unwrap());
    let (native, native_cost) = measure(|| {
        native_values.push(String::from("tail"));
        native_values[1].as_str() == "tail"
    });
    assert!(generated);
    assert_eq!(generated, native);
    assert_eq!(generated_values, native_values);
    assert_eq!(generated_values.len(), 2);
    assert_eq!(generated_cost, native_cost);
}

#[test]
fn an_unknown_index_callback_is_invoked_exactly_once() {
    assert!(index::verify_callback().unwrap());
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});
