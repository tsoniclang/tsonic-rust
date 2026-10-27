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

for (const [formName, form, names] of (physicalForms.filter(([name]) => name !== "reverse" && name !== "literalWrapped")).slice(2, 3)) {
for (const [operation, body] of (operationControls).slice(11, 13)) {
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

for (const [formName, form, names] of (physicalForms.filter(([name]) => name !== "reverse" && name !== "literalWrapped")).slice(3, 4)) {
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

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`C102 ${lane}: complete numeric aggregates preserve native values, ordering and exact allocation costs`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "lib", crateName: "numeric_arrays" } },
      files: { "index.ts": source } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 8).map(row => `${row.code}: ${row.message.slice(0, 256)}`).join("\n"));
    const generated = artifactText(result, "src/index.rs");
    const arrayType = lane === "native" ? "Vec" : "js_abi::JsArray";
    for (const [name] of fractional) {
      assert.equal(new RegExp(`fn ${name}\\([^)]*\\) -> ${arrayType}<f64>`, "u").test(generated), true,
        `${name}: inferred destination is the native floating element`);
    }
    for (const [name] of integer) {
      assert.equal(new RegExp(`fn ${name}\\([^)]*\\) -> ${arrayType}<i32>`, "u").test(generated), true,
        `${name}: exact integer peer, no floating detour`);
    }
    for (const name of ["wideExact", "widePair", "widePreciseLiteral"]) {
      assert.equal(new RegExp(`fn ${name}\\([^)]*\\) -> ${arrayType}<i64>`, "u").test(generated), true,
        `${name}: exact wide integer remains the inferred physical element`);
    }
    assert.equal(/i64_to_f64|u64_to_f64|\.to_vec\(|\.collect::<|Box::new/u.test(generated), false,
      "no wide rounding, intermediate collection, clone buffer or box");
    const resultType = `${arrayType}<f64>`;
    const allocationCount = lane === "native" ? 1 : 2;
    const nativeObservations = observed.map(([name, argumentsText, values]) =>
      `assert_dense(${name}(${argumentsText.replaceAll("4294967295", "u32::MAX")}), &[${values.map(value =>
        fractional.some(([candidate]) => candidate === name) && Number.isInteger(value) ? `${value}.0_f64` : String(value)).join(", ")}]);`).join("\n    ");
    const assertDense = lane === "native"
      ? `fn assert_dense<T: std::fmt::Debug + PartialEq>(actual: Vec<T>, expected: &[T]) {
    assert_eq!(actual.len(), expected.len());
    assert_eq!(actual.as_slice(), expected);
}`
      : `fn assert_dense<T: std::fmt::Debug + PartialEq + Clone>(actual: js_abi::JsArray<T>, expected: &[T]) {
    assert_eq!(actual.len(), expected.len());
    for (index, value) in expected.iter().enumerate() { assert_eq!(actual.get(index).as_ref(), Some(value)); }
}`;
    const initialize = artifactText(result, "src/lib.rs").includes("pub fn initialize()") ? "crate::initialize();" : "";
    const checkedIndexResult = lane === "native" ? '.expect("native checked index succeeds")' : "";
    for (const [name, valueType] of [["verify", "bool"], ["negativeZero", "f64"], ["nativeFloat32", "f32"], ["fractionalFloat64", "f64"]]) {
      const expectedResultType = lane === "native" ? `Result<${valueType}, rt::TsonicError>` : valueType;
      assert.equal(new RegExp(`fn ${name}\\([^)]*\\) -> ${expectedResultType}`, "u").test(generated), true,
        `${name}: preserve the native checked-index result contract on the selected surface`);
    }
    const handwritten = fractional.map(([name, , values], index) => {
      const entries = values.map(value => value === -7 ? "f64::from(signed)" : value === 4294967295 ? "f64::from(unsigned)" : "0.5_f64").join(", ");
      const construction = lane === "native" ? `vec![${entries}]` : `js_abi::JsArray::from_dense(vec![${entries}])`;
      return `fn handwritten${index}(signed: i32, unsigned: u32) -> ${resultType} { ${construction} }`;
    }).join("\n");
    const genuineChecks = [["genuineFloatWidth", false], ["reverseGenuineFloatWidth", true]].map(([name, reverse]) => {
      const { carrier, enumPath, variants } = physicalUnionInfo(generated, result.artifacts.map(artifact => artifact.text).join("\n"),
        arrayType, name, ["f32", "i64"]);
      const entries = [`${enumPath}::${variants.get("f32")}(narrow)`, `${enumPath}::${variants.get("i64")}(wide)`];
      if (reverse) entries.reverse();
      const construction = lane === "native" ? `vec![${entries.join(", ")}]` : `js_abi::JsArray::from_dense(vec![${entries.join(", ")}])`;
      const narrowIndex = reverse ? 1 : 0;
      const wideIndex = reverse ? 0 : 1;
      const selected = index => lane === "native" ? `&value[${index}]`
        : `&value.get(${index}).expect("an existing native-width payload exists")`;
      return `{
    fn handwritten(narrow: f32, wide: i64) -> ${arrayType}<${carrier}> { ${construction} }
    let value = ${name}(-0.0_f32, 9_007_199_254_740_993_i64);
    assert_eq!(value.len(), 2);
    match ${selected(narrowIndex)} {
        ${enumPath}::${variants.get("f32")}(payload) => assert_eq!(payload.to_bits(), (-0.0_f32).to_bits()),
        _ => panic!("the f32 physical arm changed"),
    }
    match ${selected(wideIndex)} {
        ${enumPath}::${variants.get("i64")}(payload) => assert_eq!(*payload, 9_007_199_254_740_993_i64),
        _ => panic!("the exact i64 physical arm changed"),
    }
    for iteration in 0..1000 {
        let (value, cost) = measure(|| ${name}(std::hint::black_box(-0.0_f32), std::hint::black_box(9_007_199_254_740_993_i64)));
        let (expected, expected_cost) = measure(|| handwritten(std::hint::black_box(-0.0_f32), std::hint::black_box(9_007_199_254_740_993_i64)));
        assert_eq!(cost, expected_cost);
        assert_eq!(cost.allocations, ${allocationCount});
        assert_eq!(cost.reallocations, 0);
        if iteration == 0 { eprintln!("C130 ${lane} ${name}: {cost:?}"); }
        drop(value); drop(expected);
    }
}`;
    }).join("\n    ");
    const root = writeGeneratedProject(`inferred-numeric-arrays-${lane}`, result.artifacts);
    const proof = `
#[cfg(test)]
mod c102_native_proof {
use super::*;
${nativeOwnershipCostSupport(root)}
${handwritten}
${assertDense}
#[test]
fn exact_values_widths_signed_zero_and_source_order() {
    ${initialize}
    assert!(verify()${checkedIndexResult});
    ${nativeObservations}
    assert_dense(wideExact(9_007_199_254_740_993_i64), &[9_007_199_254_740_993_i64, 1]);
    assert_dense(widePair(9_007_199_254_740_993_i64), &[9_007_199_254_740_993_i64, 9_007_199_254_740_993_i64]);
    assert_dense(widePreciseLiteral(9_007_199_254_740_995_i64), &[9_007_199_254_740_995_i64, 9_007_199_254_740_993_i64]);
    assert_dense(literalBoundary(-7), &[-7.0_f64, 2_147_483_648.0_f64]);
    assert_dense(explicitInexact(-7, u32::MAX), &[-7.0_f64, 4_294_967_295.0_f64, 9_007_199_254_740_992.0_f64]);
    assert_dense(computedFloatPeers(-7, u32::MAX, 0.1_f64), &[-7.0_f64, 4_294_967_295.0_f64, 0.1_f64]);
    assert_dense(literalBeyondFloat32(0.5_f32), &[0.5_f64, 16_777_217.0_f64]);
    assert_dense(contextualFloat32(16_777_217, 0.5_f32), &[16_777_216.0_f32, 0.5_f32]);
    assert_dense(contextualFloat64(16_777_217, 0.5_f32), &[16_777_217.0_f64, 0.5_f64]);
    assert_dense(contextualArgument(16_777_217, 0.5_f32), &[16_777_216.0_f32, 0.5_f32]);
    let negative_zero_values = negativeZeroPeers(-7, u32::MAX);
    let negative_zero = ${lane === "native" ? "negative_zero_values[2]" : 'negative_zero_values.get(2).expect("dense signed zero exists")'};
    assert_eq!(negative_zero.to_bits(), (-0.0_f64).to_bits());
    assert_dense(spreadValues(), &[1.0_f64, 0.5, 3.5, 2.0]);
    assert_dense(suffixValues(), &[0.5_f64, 3.5, 1.0, 2.0]);
    assert_eq!(negativeZero(-7)${checkedIndexResult}.to_bits(), (-0.0_f64).to_bits());
    assert_eq!(nativeFloat32(1.5_f32)${checkedIndexResult}.to_bits(), 0.5_f32.to_bits());
    assert_eq!(fractionalFloat64(1.5_f32)${checkedIndexResult}.to_bits(), 0.1_f64.to_bits());
    assert_dense(effectOrder(), &[-7.0_f64, 0.5, 4_294_967_295.0]);
    assert_eq!(effectTrace(), 123);
    ${genuineChecks}
}
#[test]
fn exact_per_operation_native_cost() {
    type Constructor = fn(i32, u32) -> ${resultType};
    let pairs: [(Constructor, Constructor); 3] = [(mixed0, handwritten0), (mixed1, handwritten1), (mixed2, handwritten2)];
    for (index, (generated, native)) in pairs.into_iter().enumerate() {
        for iteration in 0..1000 {
            let (value, cost) = measure(|| generated(std::hint::black_box(-7), std::hint::black_box(u32::MAX)));
            let (expected, expected_cost) = measure(|| native(std::hint::black_box(-7), std::hint::black_box(u32::MAX)));
            assert_eq!(cost, expected_cost);
            assert_eq!(cost.allocations, ${allocationCount});
            assert_eq!(cost.reallocations, 0);
            if iteration == 0 { eprintln!("C102 ${lane} mixed{index}: {cost:?}"); }
            drop(value);
            drop(expected);
        }
    }
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
