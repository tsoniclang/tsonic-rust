import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { providerEvaluationOrderSource } from "../../../../tsonic/test/fixtures/provider-evaluation-order.mjs";
import { acmeTestingPackage, analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { createRustProviderPackage } from "../../../dist/public/provider.js";

function receiverEvaluationPackage() {
  const flag = { kind: "target-named", id: "r14.Flag" };
  const nativeBool = { kind: "source-primitive", name: "bool" };
  const reference = { kind: "provider-ref", moduleSpecifier: "@r14/evaluation", exportName: "Flag" };
  const fresh = { form: "call", path: "String::from", trailingArguments: [{ kind: "string", value: "r14-evaluation" }] };
  return createRustProviderPackage({ id: "r14-evaluation", displayName: "Receiver evaluation", version: "1.0.0",
    modules: [{ moduleSpecifier: "@r14/evaluation", providerModuleId: "r14.evaluation", exports: [
      { id: "Flag", name: "Flag", kind: "interface", members: [
        { id: "Flag.fresh", name: "fresh", kind: "property", readonly: true, type: reference },
        { id: "Flag.empty", name: "empty", kind: "property", readonly: true, type: { kind: "boolean" } },
        { id: "Flag.value", name: "value", kind: "property", type: reference },
        { id: "Flag.make", name: "make", kind: "method", signatures: [{ id: "Flag.make(Flag)",
          parameters: [{ name: "value", type: reference }], returnType: reference }] },
      ] },
      { id: "Static", name: "Static", kind: "class", members: [
        { id: "Static.fresh", name: "fresh", kind: "property", static: true, readonly: true, type: reference },
        { id: "Static.make", name: "make", kind: "method", static: true, signatures: [{ id: "Static.make(Flag)",
          parameters: [{ name: "value", type: reference }], returnType: reference }] },
      ] },
      { id: "open", name: "open", kind: "function", signatures: [{ id: "open()", parameters: [], returnType: reference }] },
    ] }], types: [{ exportId: "Flag", targetCarrier: flag },
      { exportId: "Static", targetCarrier: { kind: "target-named", id: "r14.Static" } }],
    carrierPaths: { "r14.Flag": "String", "r14.Static": "String" }, crates: [], operations: [
      { exportId: "open", operationKind: "method", target: fresh, resultCarrier: flag },
      { exportId: "Flag", memberId: "Flag.fresh", operationKind: "property", target: fresh, resultCarrier: flag, evaluation: "pure" },
      { exportId: "Flag", memberId: "Flag.empty", operationKind: "property",
        target: { form: "method", name: "is_empty" }, resultCarrier: nativeBool },
      { exportId: "Flag", memberId: "Flag.value", operationKind: "property", target: fresh, resultCarrier: flag },
      { exportId: "Flag", memberId: "Flag.value", operationKind: "property-set",
        target: { form: "call", path: "core::mem::drop", argModes: ["value"] },
        parameterCarriers: [flag], resultCarrier: { kind: "tuple", elements: [] } },
      { exportId: "Flag", memberId: "Flag.make", operationKind: "method",
        target: { form: "call", path: "std::hint::black_box", argModes: ["value"] },
        parameterCarriers: [flag], resultCarrier: flag },
      { exportId: "Static", memberId: "Static.fresh", operationKind: "property", target: fresh, resultCarrier: flag },
      { exportId: "Static", memberId: "Static.make", operationKind: "method",
        target: { form: "call", path: "std::hint::black_box", argModes: ["value"] },
        parameterCarriers: [flag], resultCarrier: flag },
    ] });
}

test("checked read, call and setter receivers separate source evaluation from native target consumption", () => {
  const { program } = analyzeRust({ surfaces: [], packages: [receiverEvaluationPackage()], files: { "index.ts": `
import { open, Static, type Flag } from "@r14/evaluation";
export function selected(receiver: Flag, value: Flag): boolean {
  const read = receiver.fresh;
  const called = receiver.make(value);
  const qualified = Static.fresh;
  return !read.empty && !called.empty && !qualified.empty;
}
export function setter(receiver: Flag, value: Flag): void { receiver.value = value; }
export function staticCall(value: Flag): Flag { return Static.make(value); }
` } });
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "provider-operation" || fact?.kind === "runtime-set") operations.push({ node, fact });
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  const writes = operations.filter(({ fact }) => fact.kind === "runtime-set");
  assert.equal(writes.length, 1, "one actual selected setter is analyzed");
  assert.equal(writes[0].fact.abi.sourceReceiver.disposition, "evaluation-only");
  assert.equal(writes[0].fact.abi.targetReceiver.kind, "none");
  assert.deepEqual(writes[0].fact.abi.targetArguments.map(input => input.source), [{ kind: "argument", sourceIndex: 0 }]);
  assert.equal(operations.some(({ fact }) => fact.kind === "provider-operation" && fact.abi.operationKind === "property" &&
    fact.abi.sourceReceiver.kind === "receiver" && fact.abi.sourceReceiver.disposition === "evaluation-only"), true,
  "the selected read retains its unused runtime receiver");
  assert.equal(operations.some(({ fact }) => fact.kind === "provider-operation" && fact.abi.operationKind === "method" &&
    fact.abi.sourceReceiver.kind === "receiver" && fact.abi.sourceReceiver.disposition === "evaluation-only"), true,
  "the selected call retains its unused runtime receiver");
  assert.equal(operations.filter(({ fact }) => fact.abi.sourceReceiver.kind === "compile-time").length, 2,
    "the actual class read and call are compile-time qualifiers without fabricated carriers");
});

test("effect-only provider reads and calls run once in source order without consuming stored receivers", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], packages: [receiverEvaluationPackage(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r14_receiver_evaluation" } }, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { open, Static, type Flag } from "@r14/evaluation";
import { check } from "@acme/testing";
let order: int32 = 0;
function receiver(): Flag { order = order * 10 + 1; return open(); }
function value(): Flag { order = order * 10 + 2; return open(); }
export function retainedReceiver(): boolean {
  const retained = open();
  const result = retained.make(open());
  return !retained.empty && !result.empty;
}
export function main(): void {
  const read = receiver().fresh;
  check(order === 1 && !read.empty);
  order = 0;
  const called = receiver().make(value());
  check(order === 12 && !called.empty);
  check(retainedReceiver());
  check(!Static.fresh.empty && !Static.make(open()).empty);
}
main();
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n").slice(0, 2048));
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /retained\.clone\(/u, "discarding a stored receiver never clones it");
  const root = writeGeneratedProject("r14-receiver-evaluation", result.artifacts);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  writeFileSync(join(root, "src/index.rs"), output + `
#[cfg(test)]
mod native_receiver_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn discarded_non_copy_receiver_matches_native_allocation_cost() {
        for _ in 0..64 {
            let (actual, actual_cost) = measure(retainedReceiver);
            let (expected, expected_cost) = measure(|| {
                let retained = String::from("r14-evaluation");
                let _ = &retained;
                let result = std::hint::black_box(String::from("r14-evaluation"));
                !retained.is_empty() && !result.is_empty()
            });
            assert_eq!(actual, expected);
            assert_eq!(actual_cost, expected_cost);
        }
    }
}
`);
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--release", "--locked", "--offline"]);
  runCargo(root, ["run", "--locked", "--offline"]);
});

test("a rejected effect-only provider receiver prevents evaluation of later arguments", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [receiverEvaluationPackage(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r14_receiver_error_order" } }, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { open, type Flag } from "@r14/evaluation";
import { check } from "@acme/testing";
let order: int32 = 0;
function receiver(fail: boolean): Flag {
  order = order * 10 + 1;
  if (fail) throw new Error("receiver");
  return open();
}
function value(): Flag { order = order * 10 + 2; return open(); }
export function main(): void {
  let caught = false;
  try { const result = receiver(true).make(value()); check(!result.empty); }
  catch { caught = true; }
  check(caught && order === 1);
}
main();
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n").slice(0, 2048));
  validateGeneratedProject("r14-receiver-error-order", result.artifacts, { run: true });
});

test("provider conversions borrow disjoint fields and snapshot values before overlapping receiver calls", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": providerEvaluationOrderSource + '\nexport function main(): void { if (!run()) throw new Error("native provider order"); }\nmain();\n' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn replace\(&mut self\)/u);
  assert.match(output, /let operation_input_0 = self\.text\.clone\(\);/u);
  assert.doesNotMatch(output, /source\.clone\(\)/u);
  for (const name of ["next", "combined", "observed"]) {
    const start = output.indexOf(`pub fn ${name}(`);
    const nextMethod = output.indexOf("\n    pub fn ", start);
    const end = output.indexOf("\n}\n", start);
    assert.equal(start >= 0 && end > start, true, `${name} emitted method`);
    assert.doesNotMatch(output.slice(start, nextMethod < 0 ? end : Math.min(end, nextMethod)), /clone\(|operation_input/u);
  }
  const root = writeGeneratedProject("provider-evaluation-order", result.artifacts);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  writeFileSync(join(root, "src/index.rs"), output + `
#[cfg(test)]
mod native_provider_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn existing_parameter_borrows_add_no_snapshot_allocation() {
        for source in ["ab".repeat(4096), "zz".repeat(4096)] {
            let (actual, actual_cost) = measure(|| borrowedProvider(&source, false).unwrap());
            let (expected, expected_cost) = measure(|| {
                js_string::includes_from_start(&source, &selectedNeedle(false).unwrap())
                    && js_string::includes_from_start(&source, "a")
            });
            assert_eq!(actual, expected);
            assert_eq!(actual_cost, expected_cost);
        }
    }

    #[test]
    fn disjoint_and_overlapping_reads_match_handwritten_allocation_cost() {
        let backing = "ab".repeat(4096);
        let mut generated = Cursor::new(backing.clone());
        let mut handwritten_text = backing.clone();
        for kind in 0..4 {
            for _ in 0..256 {
                generated.text.clone_from(&backing);
                handwritten_text.clone_from(&backing);
                generated.index = 0;
                let mut handwritten_index: i32 = 0;
                let (actual, actual_cost) = measure(|| {
                    let value = match kind {
                        0 => generated.next().unwrap(),
                        1 => generated.combined(1).unwrap(),
                        2 => generated.observed().unwrap(),
                        _ => generated.mutated().unwrap(),
                    };
                    std::hint::black_box(value.as_bytes()[0])
                });
                let (expected, expected_cost) = measure(|| {
                    let value = match kind {
                        0 | 1 => {
                            let index = handwritten_index;
                            handwritten_index += 1;
                            js_string::char_at(&handwritten_text, index + if kind == 1 { 1 } else { 0 }).unwrap()
                        },
                        2 => js_string::char_at(&handwritten_text, (handwritten_text.len() - 1) as i32).unwrap(),
                        _ => {
                            let snapshot = handwritten_text.clone();
                            handwritten_text = String::from("zz");
                            js_string::char_at(&snapshot, 0).unwrap()
                        },
                    };
                    std::hint::black_box(value.as_bytes()[0])
                });
                assert_eq!(actual, expected);
                assert_eq!(actual_cost, expected_cost);
                assert_eq!(generated.index, handwritten_index);
                assert_eq!(generated.text, handwritten_text);
            }
        }
    }
}
`);
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--release", "--locked", "--offline"]);
  runCargo(root, ["run", "--locked", "--offline"]);
});
