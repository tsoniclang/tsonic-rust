import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { writeGeneratedProject, runCargo } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { rustJsArrayTargetType, rustSourcePrimitiveTargetType, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import {
  fractional,
  integer,
  declarations,
  observed,
  verificationBindings,
  verification,
  physicalForms,
  exactPhysicalForms,
  constructedPhysicalForms,
  physicalUnionInfo,
  operationControls,
  operationRefusals,
  source,
} from "./inferred-numeric-array-elements-fixtures.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`C130 ${lane}: physical integer unions preserve native payload values, cross-arm equality and exact cost`, { timeout: 300_000 }, () => {
    const files = { "index.ts": 'import type { int32, uint32 } from "@tsonic/core/types.js";\n' +
      constructedPhysicalForms.map(([name, expression, names, literal]) => `
export function ${name}(signed: int32, unsigned: uint32) { const values = ${expression}; return values; }
${literal !== undefined ? "" : `export function ${name}Equal(signed: int32, unsigned: uint32): boolean {
  const values = ${expression};
  return ${names.slice(1).map((_, index) =>
    `values[0] === values[${index + 1}] && !(values[0] !== values[${index + 1}])`).join(" && ")};
}`}`).join("\n") };
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "lib", crateName: "physical_numeric_arrays" } }, files });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 8).map(row => `${row.code}: ${row.message}`).join("\n"));
    const generated = artifactText(result, "src/index.rs");
    const allGenerated = result.artifacts.map(artifact => artifact.text).join("\n");
    const array = lane === "native" ? "Vec" : "js_abi::JsArray";
    const nativeType = { int32: "i32", uint32: "u32", float64: "f64" };
    const cases = constructedPhysicalForms.map(([name, , names, literal]) => {
      const { carrier, enumPath, variants } = physicalUnionInfo(generated, allGenerated, array, name, names.map(primitive => nativeType[primitive]));
      const entries = names.map(primitive => `${enumPath}::${variants.get(nativeType[primitive])}(${primitive === "int32"
        ? "signed" : primitive === "uint32" ? "unsigned" : literal ?? "1.0_f64"})`).join(", ");
      const resultType = `${array}<${carrier}>`;
      const constructor = lane === "native" ? `vec![${entries}]` : `js_abi::JsArray::from_dense(vec![${entries}])`;
      const value = lane === "native" ? "&value[index]" : '&value.get(index).expect("a constructed dense element exists")';
      const arms = [...variants].map(([primitive, variant]) => `${enumPath}::${variant}(payload) => ${primitive === "f64"
        ? "*payload" : "f64::from(*payload)"}`).join(", ");
      const expected = names.map(primitive => primitive === "int32" ? "-1.0_f64" : primitive === "uint32"
        ? "4_294_967_295.0_f64" : literal ?? "1.0_f64").join(", ");
      return `
fn handwritten_${name.toLowerCase()}(signed: i32, unsigned: u32) -> ${resultType} { ${constructor} }
fn check_${name.toLowerCase()}() {
    let value = ${name}(-1, u32::MAX);
    assert_eq!(value.len(), ${names.length});
    for (index, expected) in [${expected}].into_iter().enumerate() {
        let actual = match ${value} { ${arms} };
        assert_eq!(actual.to_bits(), expected.to_bits());
    }
    ${literal !== undefined ? "" : `assert!(${name}Equal(1, 1)${lane === "native" ? '.expect("checked source reads succeed")' : ""});
    assert!(!${name}Equal(-1, u32::MAX)${lane === "native" ? '.expect("distinct checked source reads succeed")' : ""});`}
    for iteration in 0..1000 {
        let (actual, cost) = measure(|| ${name}(std::hint::black_box(-1), std::hint::black_box(u32::MAX)));
        let (expected, expected_cost) = measure(|| handwritten_${name.toLowerCase()}(std::hint::black_box(-1), std::hint::black_box(u32::MAX)));
        assert_eq!(cost, expected_cost);
        assert_eq!(cost.allocations, ${lane === "native" ? 1 : 2});
        assert_eq!(cost.reallocations, 0);
        if iteration == 0 { eprintln!("C130 ${lane} ${name}: {cost:?}"); }
        drop(actual); drop(expected);
    }
}`;
    }).join("\n");
    const root = writeGeneratedProject(`physical-numeric-arrays-${lane}`, result.artifacts);
    const proof = `
#[cfg(test)]
mod c130_physical_native_proof {
use super::*;
${nativeOwnershipCostSupport(root)}
${cases}
#[test]
fn physical_values_cross_arm_number_equality_and_native_cost() {
    ${artifactText(result, "src/lib.rs").includes("pub fn initialize()") ? "crate::initialize();" : ""}
    ${constructedPhysicalForms.map(([name]) => `check_${name.toLowerCase()}();`).join("\n    ")}
}
}
`;
    appendFileSync(join(root, "src/index.rs"), proof);
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["fmt"]);
    runCargo(root, ["fmt", "--check"]);
    runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    const checked = runCargo(root, ["test", "--locked", "--offline", "--", "--nocapture"]);
    process.stdout.write(checked.stdout + checked.stderr);
  });
}

for (const [formName, form, names] of (physicalForms.filter(([name]) => name !== "reverse" && name !== "literalWrapped")).slice(0, 2)) {
for (const [operation, body] of (operationControls).slice(0, 13)) {
test(`C130 js: ${formName} ${operation} uses native number semantics or a precise pre-seal refusal`, { timeout: 300_000 }, () => {
      const expectedJson = names.length === 2 ? "[1,1]" : "[1,1,1]";
      const expectedSort = names.length === 2 ? "[10,2]" : "[1,10,2]";
      const source = 'import type { int32, uint32 } from "@tsonic/core/types.js";\n' +
        `export function check(signed: int32, unsigned: uint32): boolean { const values = ${form}; ` +
        body.replace("EXPECTED_JSON", JSON.stringify(expectedJson)).replace("EXPECTED_SORT", JSON.stringify(expectedSort)) + " }";
      const { result, source: checkedSource } = compileRust({ surfaces: ["js"],
        target: { id: "rust", options: { outputType: "lib", crateName: "physical_numeric_operation" } }, files: { "index.ts": source } });
      const issues = result.diagnostics.filter(issue => issue.category === "error");
      const expected = operationRefusals(operation, names);
      assert.equal(issues.length, expected.length, `${operation}: preserve the frozen accepted/refused disposition and every rejection`);
      if (expected.length !== 0) {
        assert.equal(result.program === undefined && result.plan === undefined, true,
          "the actual compilation observer publishes neither a program nor a plan");
        assert.equal(result.artifacts.length, 0, "an unsupported physical-union operation emits no target source");
        for (const [index, issue] of issues.entries()) {
          const refusal = expected[index];
          assert.equal(issue.code, refusal.code, `${operation}: exact original deciding owner`);
          assert.equal(issue.message, refusal.message, `${operation}: exact original cause`);
          assert.deepEqual(issue.evidence, refusal.evidence, `${operation}: exact carrier and operation evidence`);
          assert.equal(issue.sourceNode !== undefined, true, `${operation}: an actual source diagnostic`);
          const range = checkedSource.ast.authoredRange(issue.sourceNode);
          const text = checkedSource.ast.getSourceText(checkedSource.ast.getSourceFile(issue.sourceNode));
          assert.equal(range.kind === "authored" && range.start === source.indexOf(refusal.span) &&
            range.end === range.start + refusal.span.length && text.slice(range.start, range.end) === refusal.span, true,
          `${operation}: exact original source span, not an enclosing or contained unrelated operation`);
        }
        process.stdout.write(`C130 ${formName} ${operation}: PRESEAL ${issues.map(issue => issue.code).join(",")}\n`);
        return;
      }
      assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length > 0, true,
        "an admitted operation cannot regress to any substitute refusal");
      const signature = /pub fn check\([^)]*\) -> (bool|Result<bool,[^\n]+>)\s*\{/u.exec(artifactText(result, "src/index.rs"));
      assert.equal(signature !== null, true, "the native observer consumes the actual sealed bool or fallible-bool ABI");
      const checkedResult = signature[1] === "bool" ? "" : '.expect("the admitted native number operation succeeds")';
      const proof = `
#[cfg(test)]
mod c130_native_operation_proof {
use super::*;
#[test]
fn exact_cross_arm_number_semantics() {
    ${artifactText(result, "src/lib.rs").includes("pub fn initialize()") ? "crate::initialize();" : ""}
    assert!(check(${operation === "sort" ? "10, 2" : "1, 1"})${checkedResult});
    assert!(!check(-1, u32::MAX)${checkedResult});
}
}
`;
      const root = writeGeneratedProject(`physical-${formName}-${operation.replace(/[^a-z]/giu, "-")}`, result.artifacts.map(artifact =>
        artifact.path === "src/index.rs" ? { ...artifact, text: artifact.text + proof } : artifact));
      runCargo(root, ["generate-lockfile", "--offline"]);
      runCargo(root, ["fmt"]);
      runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
      runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
      const checked = runCargo(root, ["test", "--locked", "--offline"]);
      process.stdout.write(`C130 ${formName} ${operation}: NATIVE\n` + checked.stdout + checked.stderr);
    });
}
}

for (const [formName, form, names] of (physicalForms.filter(([name]) => name !== "reverse" && name !== "literalWrapped")).slice(2, 3)) {
for (const [operation, body] of (operationControls).slice(0, 11)) {
test(`C130 js: ${formName} ${operation} uses native number semantics or a precise pre-seal refusal`, { timeout: 300_000 }, () => {
      const expectedJson = names.length === 2 ? "[1,1]" : "[1,1,1]";
      const expectedSort = names.length === 2 ? "[10,2]" : "[1,10,2]";
      const source = 'import type { int32, uint32 } from "@tsonic/core/types.js";\n' +
        `export function check(signed: int32, unsigned: uint32): boolean { const values = ${form}; ` +
        body.replace("EXPECTED_JSON", JSON.stringify(expectedJson)).replace("EXPECTED_SORT", JSON.stringify(expectedSort)) + " }";
      const { result, source: checkedSource } = compileRust({ surfaces: ["js"],
        target: { id: "rust", options: { outputType: "lib", crateName: "physical_numeric_operation" } }, files: { "index.ts": source } });
      const issues = result.diagnostics.filter(issue => issue.category === "error");
      const expected = operationRefusals(operation, names);
      assert.equal(issues.length, expected.length, `${operation}: preserve the frozen accepted/refused disposition and every rejection`);
      if (expected.length !== 0) {
        assert.equal(result.program === undefined && result.plan === undefined, true,
          "the actual compilation observer publishes neither a program nor a plan");
        assert.equal(result.artifacts.length, 0, "an unsupported physical-union operation emits no target source");
        for (const [index, issue] of issues.entries()) {
          const refusal = expected[index];
          assert.equal(issue.code, refusal.code, `${operation}: exact original deciding owner`);
          assert.equal(issue.message, refusal.message, `${operation}: exact original cause`);
          assert.deepEqual(issue.evidence, refusal.evidence, `${operation}: exact carrier and operation evidence`);
          assert.equal(issue.sourceNode !== undefined, true, `${operation}: an actual source diagnostic`);
          const range = checkedSource.ast.authoredRange(issue.sourceNode);
          const text = checkedSource.ast.getSourceText(checkedSource.ast.getSourceFile(issue.sourceNode));
          assert.equal(range.kind === "authored" && range.start === source.indexOf(refusal.span) &&
            range.end === range.start + refusal.span.length && text.slice(range.start, range.end) === refusal.span, true,
          `${operation}: exact original source span, not an enclosing or contained unrelated operation`);
        }
        process.stdout.write(`C130 ${formName} ${operation}: PRESEAL ${issues.map(issue => issue.code).join(",")}\n`);
        return;
      }
      assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length > 0, true,
        "an admitted operation cannot regress to any substitute refusal");
      const signature = /pub fn check\([^)]*\) -> (bool|Result<bool,[^\n]+>)\s*\{/u.exec(artifactText(result, "src/index.rs"));
      assert.equal(signature !== null, true, "the native observer consumes the actual sealed bool or fallible-bool ABI");
      const checkedResult = signature[1] === "bool" ? "" : '.expect("the admitted native number operation succeeds")';
      const proof = `
#[cfg(test)]
mod c130_native_operation_proof {
use super::*;
#[test]
fn exact_cross_arm_number_semantics() {
    ${artifactText(result, "src/lib.rs").includes("pub fn initialize()") ? "crate::initialize();" : ""}
    assert!(check(${operation === "sort" ? "10, 2" : "1, 1"})${checkedResult});
    assert!(!check(-1, u32::MAX)${checkedResult});
}
}
`;
      const root = writeGeneratedProject(`physical-${formName}-${operation.replace(/[^a-z]/giu, "-")}`, result.artifacts.map(artifact =>
        artifact.path === "src/index.rs" ? { ...artifact, text: artifact.text + proof } : artifact));
      runCargo(root, ["generate-lockfile", "--offline"]);
      runCargo(root, ["fmt"]);
      runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
      runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
      const checked = runCargo(root, ["test", "--locked", "--offline"]);
      process.stdout.write(`C130 ${formName} ${operation}: NATIVE\n` + checked.stdout + checked.stderr);
    });
}
}
