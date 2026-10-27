import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustTargetOperationFactEquals } from "../../../dist/target-model/records/operations/operation-equality.js";

const examples = [
  ["implicit and inherited construction with callable fields", `
    class Base { constructor(readonly value: number) {} }
    class Derived extends Base {}
    class Owner { readonly read = (value: number): number => value + 1; }
    export function run(): number { return new Owner().read(new Derived(3).value); }
  `],
  ["typed parameters, properties and callable getters", `
    interface Reader { read: (value: number) => number; }
    class Owner { get read(): (value: number) => number { return value => value + 1; } }
    function apply(callback: (value: number) => number, value: number): number { return callback(value); }
    export function run(reader: Reader): number { return apply(new Owner().read, reader.read(2)); }
  `],
  ["original tuple-rest and pseudo-this parameters", `
    function sum(this: void, thisValue: number, ...values: [number, number]): number {
      return thisValue + values[0] + values[1];
    }
    export function run(): number { return sum(1, 2, 3); }
  `],
];

for (const surfaces of [[], ["js"]]) for (const [name, sourceText] of examples) {
  test(`checked callable values retain ${name} in ${surfaces[0] ?? "native"}`, () => {
    const { result, source } = compileRust({ surfaces, files: { "index.ts": sourceText } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => {
        const node = issue.sourceNode;
        const name = node === undefined ? undefined : source.ast.name(node);
        return `${issue.code}: ${issue.message.slice(0, 256)}; node=${node === undefined ? "absent" : source.ast.kindName(node)}; name=${name === undefined ? "absent" : source.ast.text(name).slice(0, 128)}`;
      }).join("\n"));
    assert.equal(result.artifacts.length > 0, true, "the complete checked source reaches target emission");
    assert.equal(/fn run\(/u.test(rustSourceText(result)), true,
      "the exported ordinary native function is retained");
    if (name === "original tuple-rest and pseudo-this parameters") {
      const emitted = rustSourceText(result);
      assert.match(emitted, /\bvalues: \[f64; 2\]/u, "the homogeneous checked tuple keeps its fixed native array carrier");
      assert.match(emitted, /sum\(\s*1\.0,\s*\[2\.0_f64,\s*3\.0_f64\]\s*\)/u,
        "the three source values become one scalar and one exact native fixed array");
      assert.doesNotMatch(emitted, /vec!\[|Vec::/u, "a finite native rest tuple never allocates a dynamic rest vector");
    }
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`fixed native tuple rest preserves heterogeneous positions, optional absence and checked spreads in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      function payload(...values: [int32, string, int32?]): int32 { return values[0] + (values[2] ?? 0); }
      function empty(...values: []): int32 { return 1; }
      export function run(): int32 {
        const values: [int32, string, int32] = [1, "value", 2];
        return payload(1, "value") + payload(...values) + empty();
      }
    ` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message.slice(0, 256)}`).join("\n"));
    assert.equal(result.artifacts.length > 0, true, "the complete tuple-rest program reaches target emission");
    const emitted = rustSourceText(result);
    assert.equal(/vec!\[|Vec::/u.test(emitted), false, "fixed tuple rest never allocates a native rest vector");
    assert.equal(/Option::<i32>::None/u.test(emitted), true, "the omitted checked optional tuple element retains its native absence");
    assert.equal(/empty\(\s*\(\)\s*\)/u.test(emitted), true, "an actual empty rest tuple is an explicit native argument, not a missing slot");
    assert.doesNotMatch(emitted, /\.clone\(\)/u, "the single owned tuple spread moves its native fields without cloning");
    const program = result.program;
    assert.equal(program !== undefined, true, "the actual finite rest source publishes its sealed program");
    const { ast } = program.source;
    const calls = [];
    const visit = node => {
      if (ast.is.IsCallExpression(node)) {
        const call = ast.as.AsCallExpression(node);
        const arguments_ = ast.arguments(node);
        if (ast.is.IsIdentifier(call.Expression) && ast.text(call.Expression) === "payload" &&
          arguments_.length === 1 && ast.is.IsSpreadElement(arguments_[0])) calls.push(node);
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const file of program.sourceFiles) visit(file);
    assert.equal(calls.length, 1, "the original checked tuple has one actual spread invocation");
    const call = calls[0];
    const spread = ast.arguments(call)[0];
    const expression = ast.as.AsSpreadElement(spread).Expression;
    const fact = program.records.targetOperation.get(call);
    assert.equal(fact?.kind, "source-call", "the original invocation retains its selected source ABI");
    assert.equal(fact.parameters.length, 1, "three effective values still map to one native rest parameter");
    const inputs = fact.parameters[0].inputs;
    assert.equal(inputs.map(input => input.sourceArgumentIndex).join(","), "0,0,0", "all projections retain the one original argument slot");
    assert.equal(inputs.map(input => input.spreadElementIndex).join(","), "0,1,2", "each native position retains its checked element index");
    const sourceCarrier = program.records.runtimeCarrier.get(spread)?.carrier;
    assert.equal(sourceCarrier?.kind, "tuple", "the checked heterogeneous tuple is not replaced by a homogeneous sequence");
    for (const [index, input] of inputs.entries()) {
      assert.equal(input.sourceForm, "spread-element", `element ${index}: the checked projection form is retained`);
      assert.equal(input.projection.kind, "element", `element ${index}: required projection evidence is published`);
      assert.equal(rustTargetTypeRefEquals(input.projection.sourceCarrier, sourceCarrier.elements[index]), true,
        `element ${index}: the original native source carrier is retained`);
      assert.equal(Object.isFrozen(input.projection), true, `element ${index}: projection evidence is immutable`);
      if (index !== 2) assert.equal(input.projection.conversion === null, true, `element ${index}: native identity is explicit`);
    }
    const conversion = inputs[2].projection.conversion;
    assert.equal(conversion?.lowering, "option-some", "only the actual present optional position receives its native lift");
    assert.equal(conversion.fallible, false, "the native optional lift adds no error channel");
    assert.equal(conversion.sourceMode, "value", "the native integer is consumed once without a borrowed wrapper");
    assert.equal(rustTargetTypeRefEquals(conversion.source, inputs[2].projection.sourceCarrier), true, "the conversion retains its exact source");
    assert.equal(rustTargetTypeRefEquals(conversion.target, inputs[2].carrier), true, "the conversion retains its exact selected destination");
    assert.equal(Object.isFrozen(conversion) && Object.isFrozen(conversion.target), true, "the complete conversion contract is immutable");
    const changedInputs = inputs.map((input, index) => index !== 2 ? input :
      { ...input, projection: { ...input.projection, conversion: null } });
    const changed = { ...fact, parameters: [{ ...fact.parameters[0], inputs: changedInputs }] };
    assert.equal(rustTargetOperationFactEquals(fact, changed), false, "removing the actual optional lift changes the complete native call contract");
    assert.equal(rustTargetOperationFactEquals(changed, fact), false, "native call correspondence rejects that removed lift in either direction");
    const emission = program.records.sourceCallParameters.get(fact);
    assert.equal(emission?.[0]?.inputs[2]?.projection?.conversion === conversion, true,
      "native argument emission consumes the same selected conversion without recomputing it");
    const evaluation = program.records.sourceCallEvaluation.get(call);
    assert.equal(evaluation?.arguments.length, 1, "the complete tuple expression is evaluated exactly once");
    assert.equal(evaluation.arguments[0].source === spread && evaluation.arguments[0].expression === expression, true,
      "the native evaluation keeps the original checked spread and operand Nodes");
    const declaration = program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
      ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "payload");
    assert.equal(declaration !== undefined, true, "the native parameter comes from the actual authored implementation");
    const parameters = sourceCallableValueParameters(ast, declaration, program.source.semantics.forNode(declaration), { kind: "declaration" });
    const selected = program.records.selectedCall.get(call);
    assert.equal(parameters?.length, 1, "the original declaration has one checked native rest parameter");
    assert.equal(selected?.nativeParameterDeclarations.length, 1, "the selected physical vector retains its exact arity");
    assert.equal(selected.nativeParameterDeclarations[0] === parameters[0], true, "the physical parameter preserves its original source Node");
    const root = writeGeneratedProject(`checked-finite-rest-${surfaces[0] ?? "native"}`, result.artifacts);
    appendFileSync(join(root, "src/index.rs"), `
#[cfg(test)]
mod checked_finite_rest {
    #[test]
    fn exact_optional_and_spread_inputs() {
        assert_eq!(super::run(), 5);
    }
}
`);
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["test", "--locked", "--offline", "--", "--test-threads=1"]);
  });

  test(`public overloads retain their implementations' omitted native inputs in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      function combine(value: int32): int32;
      function combine(value: int32, delta?: int32): int32 { return value + (delta ?? 0); }
      class Counter {
        value: int32;
        constructor(value: int32);
        constructor(value: int32, delta?: int32) { this.value = value + (delta ?? 0); }
        total(value: int32): int32;
        total(value: int32, delta?: int32): int32 { return this.value + value + (delta ?? 0); }
      }
      export function run(): int32 {
        const counter = new Counter(1);
        return combine(1) + counter.total(1);
      }
    ` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message.slice(0, 256)}`).join("\n"));
    const source = rustSourceText(result);
    assert.equal(/combine\(\s*1,\s*Option::<i32>::None\s*\)/u.test(source), true,
      "the direct function call supplies the implementation's optional native slot");
    assert.equal(/Counter::new\(\s*1,\s*Option::<i32>::None\s*\)/u.test(source), true,
      "the overloaded constructor supplies its actual implementation's optional native slot");
    assert.equal(/\.total\(\s*1,\s*Option::<i32>::None\s*\)/u.test(source), true,
      "the bound method supplies its implementation's optional slot without duplicating the receiver");
  });
}
