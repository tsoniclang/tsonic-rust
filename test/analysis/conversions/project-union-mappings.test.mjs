import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustProgramSourceFiles } from "../../helpers/plan-context.mjs";
import { analyzeRustProjectUnionMappings } from "../../../dist/analysis/conversions/project-union-mappings.js";
import { createRustProjectUnionMappingProducer } from "../../../dist/analysis/program/records/types/project-union-mappings.js";
import { rustProjectUnionUpcastRelation } from "../../../dist/policy/model/project-union-relations.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../../dist/policy/conversions/contextual.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const source = `
class Base { value: number = 3; read(): number { return this.value; } }
class Derived extends Base { read(): number { return this.value + 1; } }
type Narrow = string | Derived;
type Wide = string | Base;
export function widen(value: Narrow): Wide { return value; }
`;

function widening() {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
  const { ast } = program.source;
  const widened = [];
  const visit = node => {
    if (program.records.contextualValueConversion.get(node)?.conversion.kind === "project-union-map") widened.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  rustProgramSourceFiles(program).forEach(visit);
  assert.equal(widened.length, 1, "one checked nominal union widening");
  const [node] = widened;
  return { program, node, contextual: program.records.contextualValueConversion.get(node) };
}

test("nominal union widening seals one native arm composition with its checked upcasts", () => {
  const { program, contextual } = widening();
  const { conversion } = contextual;
  const selected = program.records.projectUnionMapping.get(conversion, undefined);
  assert.ok(selected, "the conversion has its sealed composition");
  assert.ok(Object.isFrozen(selected));
  assert.equal(selected.mapping.arms.length, conversion.arms.length);
  assert.equal(selected.upcasts.length, conversion.arms.length);
  selected.upcasts.forEach((upcast, index) => assert.equal(upcast, conversion.arms[index].upcast));
  assert.deepEqual(selected.upcasts.map(upcast => upcast === null).sort(), [false, true],
    "the string arm is carried unchanged and the Derived arm is upcast");
  const upcast = selected.upcasts.find(value => value !== null);
  assert.equal(rustTargetTypeRefEquals(upcast.sourceCarrier, upcast.targetCarrier), false);
});

test("project union composition rejects inconsistent outer carriers before sealing", () => {
  const { program, node, contextual } = widening();
  const relation = rustProjectUnionUpcastRelation(program.projectTypes);
  assert.equal(rustCompilerOwnedContextualConversionMatches(contextual.sourceCarrier, contextual.targetCarrier,
    contextual.conversion, program.typeDefinitions, relation), true);
  for (const [sourceCarrier, targetCarrier] of [
    [contextual.targetCarrier, contextual.targetCarrier], [contextual.sourceCarrier, contextual.sourceCarrier],
  ]) {
    assert.equal(rustCompilerOwnedContextualConversionMatches(sourceCarrier, targetCarrier, contextual.conversion,
      program.typeDefinitions, relation), false);
    const producer = createRustProjectUnionMappingProducer(() => {});
    const issues = analyzeRustProjectUnionMappings({ ...program, records: { ...program.records,
      contextualValueConversion: { get: subject => subject === node ? { ...contextual, sourceCarrier, targetCarrier } : undefined },
    } }, [node], producer);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].sourceNode, node);
    assert.match(issues[0].message, /exact finalized native carrier and arm correspondence/u);
    assert.equal(producer.records.projectUnionMapping.get(contextual.conversion, undefined), undefined);
  }
  const producer = createRustProjectUnionMappingProducer(() => {});
  assert.deepEqual(analyzeRustProjectUnionMappings(program, [node], producer), []);
  assert.deepEqual(producer.records.projectUnionMapping.get(contextual.conversion, undefined),
    program.records.projectUnionMapping.get(contextual.conversion, undefined));
});
