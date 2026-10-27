import { assertRustRecordRequirement } from "../../helpers/required-records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";


import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../../dist/target-model/types/index.js";
import { rustSourceCallResultProjectionMatches } from "../../../dist/analysis/callables/calls/source-call-results.js";

const sourceText = `
class Base<Value> {
  value: Value;
  constructor(value: Value) { this.value = value; }
  read(): Value { return this.value; }
}
class Child extends Base<number> {}
function selected(present: boolean): Base<number> | undefined {
  return present ? new Child(3) : undefined;
}
function consume(value: Base<number> | undefined): number | undefined { return value?.read(); }
export function run(): number | undefined { return consume(new Child(7)); }
`;

const fluentSourceText = `
class Base<Value> {
  value: Value;
  constructor(value: Value) { this.value = value; }
  set(value: Value): this { this.value = value; return this; }
  choose(other: this): this { return other; }
  inferred() { return this; }
  asBase(): Base<Value> { return this; }
  read(): Value { return this.value; }
}
class Child extends Base<number> { extra(): number { return this.value + 1; } }
export function set(child: Child | undefined): number | undefined { return child?.set(3).extra(); }
export function choose(child: Child | undefined, other: Child): number | undefined { return child?.choose(other).extra(); }
export function inferred(child: Child | undefined): number | undefined { return child?.inferred().extra(); }
export function base(child: Child | undefined): number | undefined { return child?.asBase().read(); }
`;

function nodes(program, predicate) {
  const { ast } = program.source;
  const pending = [...program.sourceFiles];
  const selected = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (predicate(node, ast)) selected.push(node);
    pending.push(...ast.children(node));
  }
  return selected;
}

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`optional project admission retains one exact scalar upcast before presence in ${lane}`, () => {
    const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": sourceText } });
    const constructions = nodes(program, (node, ast) => ast.is.IsNewExpression(node));
    assert.equal(constructions.length, 2);
    for (const node of constructions) {
      assertRustRecordRequirement(requiredRecords, "projectUpcast", node);
      assertRustRecordRequirement(requiredRecords, "optionProjection", node);
      const source = program.records.runtimeCarrier.get(node)?.carrier;
      const upcast = program.records.projectUpcast.get(node);
      const presence = program.records.optionProjection.get(node);
      assert.equal(source !== undefined, true, "native construction carrier exists");
      assert.equal(upcast !== undefined, true, "exact project upcast exists");
      assert.equal(presence?.kind, "some", "present source enters one optional position");
      assert.equal(rustTargetTypeRefEquals(source, upcast.sourceCarrier), true, "upcast starts at original construction");
      assert.equal(rustTargetTypeRefEquals(upcast.targetCarrier, presence.sourceCarrier), true, "presence follows scalar upcast");
      assert.equal(rustTargetTypeRefEquals(upcast.targetCarrier, presence.elementCarrier), true, "presence payload is selected base");
      assert.equal(rustOptionElementCarrier(upcast.targetCarrier) === undefined, true, "upcast is not an optional wrapper");
      assert.equal(rustTargetTypeRefEquals(rustOptionElementCarrier(presence.resultCarrier), upcast.targetCarrier), true,
        "one exact native absence layer");
      const definition = program.projectTypes.definitionForCarrier(upcast.targetCarrier);
      assert.equal(definition?.sourceName, "Base");
      assert.equal(program.projectTypes.definitionForCarrier(source)?.sourceName, "Child");
    }
    const conditional = nodes(program, (node, ast) => ast.is.IsConditionalExpression(node));
    assert.equal(conditional.length, 1);
    const conditionalResult = program.records.targetOperation.get(conditional[0]);
    assert.equal(conditionalResult?.kind, "conditional");
    assert.equal(rustOptionElementCarrier(conditionalResult.resultCarrier) !== undefined, true,
      "annotated conditional retains exact optional result");
    const consume = nodes(program, (node, ast) => {
      if (!ast.is.IsCallExpression(node)) return false;
      const callee = Node_Expression(ast, node);
      return ast.is.IsIdentifier(callee) && ast.text(callee) === "consume";
    });
    assert.equal(consume.length, 1);
    const call = program.records.targetOperation.get(consume[0]);
    assert.equal(call?.kind, "source-call");
    const input = call.parameters[0].inputs[0];
    const argument = program.source.ast.arguments(consume[0])[0];
    const presence = program.records.optionProjection.get(argument);
    assert.equal(rustTargetTypeRefEquals(input.carrier, presence.resultCarrier), true,
      "selected call input consumes the same finalized presence carrier");
  });

  test(`optional fluent calls finalize checked derived results before the next guard in ${lane}`, () => {
    const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": fluentSourceText } });
    const fluent = nodes(program, (node, ast) => {
      if (!ast.is.IsCallExpression(node)) return false;
      const callee = Node_Expression(ast, node);
      return ast.is.IsPropertyAccessExpression(callee) &&
        ["set", "choose", "inferred"].includes(ast.text(ast.name(callee)));
    });
    assert.equal(fluent.length, 3);
    for (const call of fluent) {
      const operation = program.records.targetOperation.get(call);
      const optional = program.records.optionalChain.get(call);
      const raw = program.records.runtimeCarrier.get(call)?.carrier;
      const selected = program.records.selectedCall.get(call);
      assert.equal(operation?.kind, "source-call");
      assert.equal(operation.resultProjection?.kind, "project-downcast", "native implementation result is exactly projected");
      assert.equal(program.projectTypes.definitionForCarrier(operation.resultProjection.sourceCarrier)?.sourceName, "Base");
      assert.equal(program.projectTypes.definitionForCarrier(operation.resultCarrier)?.sourceName, "Child");
      assert.equal(rustTargetTypeRefEquals(operation.resultCarrier, operation.resultProjection.selectedCarrier), true,
        "checked result is finalized at its producer");
      assert.equal(rustTargetTypeRefEquals(optional?.innerResultCarrier, operation.resultCarrier), true,
        "optional operation guards the selected native result");
      assert.equal(rustTargetTypeRefEquals(raw, optional?.resultCarrier), true, "raw result owns the exact optional carrier");
      assert.equal(rustTargetTypeRefEquals(rustOptionElementCarrier(raw), operation.resultCarrier), true,
        "next chain guard receives the exact derived payload");
      const matches = projection => rustSourceCallResultProjectionMatches(selected.sourceResultProjection,
        projection, carrier => carrier, program.projectTypes, program.typeDefinitions);
      assert.equal(matches(operation.resultProjection), true, "selected and finalized result evidence agrees");
      for (const field of ["sourceCarrier", "dispatchCarrier", "selectedCarrier"]) {
        const wrong = field === "selectedCarrier" ? operation.resultProjection.sourceCarrier : operation.resultCarrier;
        assert.equal(matches({ ...operation.resultProjection, [field]: wrong }), false,
          `reject conflicting ${field} identity`);
      }
    }
    const base = nodes(program, (node, ast) => {
      if (!ast.is.IsCallExpression(node)) return false;
      const callee = Node_Expression(ast, node);
      return ast.is.IsPropertyAccessExpression(callee) && ast.text(ast.name(callee)) === "asBase";
    });
    assert.equal(base.length, 1);
    const baseOperation = program.records.targetOperation.get(base[0]);
    assert.equal(baseOperation?.kind, "source-call");
    assert.equal(baseOperation.resultProjection === undefined, true, "ordinary base return is not replaced with this");
    assert.equal(program.projectTypes.definitionForCarrier(baseOperation.resultCarrier)?.sourceName, "Base");
  });
}

test("optional project admission does not accept unrelated checked source types", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
class Base { required: string = "base"; }
class Other { unrelated: number = 1; }
function consume(value: Base | undefined): void {}
export function run(): void { consume(new Other()); }
` } }), /TS2741: Property 'required' is missing in type 'Other'/u);
});
