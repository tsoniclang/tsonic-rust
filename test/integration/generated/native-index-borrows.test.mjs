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
function mutateIndex(values: string[]): number { values[1] = "tail"; return 1; }
export function effectful(values: string[]): boolean { return values[mutateIndex(values)]! === "tail"; }
function replaceArray(values: string[][], calls: number[]): number {
  calls[0] = calls[0]! + 1;
  values[0] = ["after", "tail"];
  return 0;
}
export function reallocated(values: string[][], calls: number[]): boolean {
  return values[0]![replaceArray(values, calls)]! === "before";
}
function consumeOwned(value: string): string { let output = value; output += "!"; return output; }
export function consuming(value: string): boolean { return value === consumeOwned(value); }
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
fn index_computation_mutates_before_the_final_element_borrow() {
    let mut generated_values = vec![String::from("head"), String::from("before")];
    let mut native_values = vec![String::from("head"), String::from("before")];
    let (generated, generated_cost) = measure(|| index::effectful(&mut generated_values).unwrap());
    let (native, native_cost) = measure(|| {
        native_values[1] = String::from("tail");
        native_values[1].as_str() == "tail"
    });
    assert!(generated);
    assert_eq!(generated, native);
    assert_eq!(generated_values, native_values);
    assert_eq!(generated_values.len(), 2);
    assert_eq!(generated_cost, native_cost);
}

#[test]
fn replacing_the_inner_allocation_preserves_receiver_evaluation_and_first_value() {
    let mut generated_values = vec![vec![String::from("before")]];
    let mut native_values = vec![vec![String::from("before")]];
    let mut generated_calls = vec![0.0];
    let mut native_calls = vec![0.0];
    let (generated, generated_cost) =
        measure(|| index::reallocated(&mut generated_values, &mut generated_calls).unwrap());
    let (native, native_cost) = measure(|| {
        let receiver = native_values[0].clone();
        native_calls[0] += 1.0;
        native_values[0] = vec![String::from("after"), String::from("tail")];
        receiver[0].as_str() == "before"
    });
    assert!(generated);
    assert_eq!(generated, native);
    assert_eq!(generated_values, native_values);
    assert_eq!(generated_values[0], ["after", "tail"]);
    assert_eq!(generated_calls, native_calls);
    assert_eq!(generated_calls, [1.0]);
    assert_eq!(generated_cost, native_cost);
}

#[test]
fn a_real_owning_call_preserves_its_first_value_and_native_snapshot_cost() {
    let generated_value = String::from("before");
    let native_value = String::from("before");
    let (generated, generated_cost) = measure(|| index::consuming(generated_value).unwrap());
    let (native, native_cost) = measure(|| {
        let before = native_value.clone();
        let mut output = native_value;
        output.push_str("!");
        before == output
    });
    assert!(!generated);
    assert_eq!(generated, native);
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
