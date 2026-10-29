import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustSourceOptionalElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
import { rustIterableTargetPolicy } from "../../../dist/policy/operations/iteration/index.js";
import { analyzeRustFlowReadEmission } from "../../../dist/analysis/control-flow/flow-read-emission.js";
import { analyzeRustOptionalChainEmission } from "../../../dist/analysis/operations/optional-chains.js";
import { createRustFlowReadEmissionProducer } from "../../../dist/analysis/program/records/operations/flow-read-emission.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

function inspectCheckedSource(source, surface) {
  let context;
  const { result } = compileRust({
    surfaces: surface === "native" ? [] : ["js"],
    files: { "index.ts": source },
    compileTarget(request) {
      context = analyzeRustCheckedContext(request);
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
    },
  });
  assert.equal(context !== undefined, true, "the real checked analysis context is retained");
  return { context, result };
}

function descendants(context, predicate) {
  const nodes = [];
  const visit = node => {
    if (predicate(node)) nodes.push(node);
    context.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  context.sourceFiles.forEach(visit);
  return nodes;
}

function admittedOptionalGuard(surface) {
  const { context, result } = inspectCheckedSource(`
export type Children = readonly Children[] | null | undefined;
export function first(children: Children): Children { return children?.[0]; }
`, surface);
  assert.equal(result.diagnostics.length, 0, "the original optional element read is checked without rejection");
  const nodes = descendants(context, () => true);
  const program = { ...context, records: context.records.readers };
  const issues = analyzeRustOptionalChainEmission(program, nodes, context.records.optionalChainEmissionPlans, []);
  assert.equal(issues.length, 0, "the exact optional guard contract is admitted before flow emission");
  const chains = nodes.filter(node => program.records.optionalChainEmission.get(node) !== undefined);
  assert.equal(chains.length, 1, "one optional operation owns the present-stage receiver");
  const operation = chains[0];
  const emission = program.records.optionalChainEmission.get(operation);
  const guard = emission.fact.guard;
  const projection = program.records.flowReadProjection.get(guard);
  assert.equal(projection?.kind, "source-union", "the present recursive enum selects its declared collection payload");
  assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(guard)?.carrier, emission.fact.sourceGuardCarrier), true,
    "the guard starts at its exact raw optional storage");
  assert.equal(rustTargetTypeRefEquals(projection.sourceCarrier, emission.fact.selectedGuardCarrier), true,
    "the projection starts at the selected present guard stage");
  return { program, nodes, operation, emission, guard, projection };
}

for (const surface of ["native", "js"]) {
  test(`an admitted optional guard keeps its exact present-stage flow source on ${surface}`, () => {
    const { program, nodes, projection } = admittedOptionalGuard(surface);
    const producer = createRustFlowReadEmissionProducer(() => {});
    const issues = analyzeRustFlowReadEmission(program, nodes, producer);
    assert.equal(issues.length, 0, "the validated optional guard and its present projection are composable");
    assert.equal(producer.records.flowReadEmission.get(projection)?.kind, "union",
      "the original native union projection is published unchanged");
  });

  test(`an unrelated or mismatched optional guard cannot authorize a flow source on ${surface}`, () => {
    const { program, nodes, operation, emission, guard } = admittedOptionalGuard(surface);
    const integer = rustSourcePrimitiveTargetType("int32");
    for (const [label, changes] of [
      ["wrong raw source", { sourceGuardCarrier: integer }],
      ["wrong selected stage", { selectedGuardCarrier: integer }],
      ["different guard", { guard: operation }],
      ["different operation", { expression: guard }],
    ]) {
      const selected = { ...program, records: { ...program.records, optionalChainEmission: {
        get: node => node === operation ? { ...emission, fact: { ...emission.fact, ...changes } }
          : program.records.optionalChainEmission.get(node),
      } } };
      const producer = createRustFlowReadEmissionProducer(() => {});
      const issues = analyzeRustFlowReadEmission(selected, nodes, producer);
      assert.equal(issues.some(issue => issue.sourceNode === guard &&
        issue.evidence.includes("target.capability=rust.backend.flow-read-source")), true,
      `${label} must preserve the original exact-source refusal`);
    }
    const ordinary = { ...program, records: { ...program.records,
      optionalChainEmission: { get: () => undefined },
    } };
    const issues = analyzeRustFlowReadEmission(ordinary, nodes, createRustFlowReadEmissionProducer(() => {}));
    assert.equal(issues.some(issue => issue.sourceNode === guard &&
      issue.evidence.includes("target.capability=rust.backend.flow-read-source")), true,
    "without an admitted guard the ordinary raw-source check still applies");
    const otherOperation = nodes.find(node => node !== operation && node !== guard);
    assert.equal(otherOperation !== undefined, true, "the ambiguity control retains a distinct source identity");
    const ambiguous = { ...program, records: { ...program.records, optionalChainEmission: {
      get: node => node === otherOperation ? { ...emission, fact: { ...emission.fact, expression: otherOperation } }
        : program.records.optionalChainEmission.get(node),
    } } };
    const ambiguousIssues = analyzeRustFlowReadEmission(ambiguous, nodes, createRustFlowReadEmissionProducer(() => {}));
    assert.equal(ambiguousIssues.some(issue => issue.sourceNode === guard &&
      issue.evidence.includes("target.capability=rust.backend.flow-read-source")), true,
    "two distinct operations cannot authorize one ambiguous guard stage");
  });

  test(`a recursive optional collection selects its checked array payload before iteration on ${surface}`, () => {
    const { context, result } = inspectCheckedSource(`
export type Children = readonly Children[] | null | undefined;
export function count(children: Children): number {
  if (children == null) return 1;
  let total = 0;
  for (const child of children) total += count(child);
  return total;
}
`, surface);
    const loops = descendants(context, node => context.ast.is.IsForOfStatement(node));
    assert.equal(loops.length, 1, "the original recursive collection loop is checked");
    const loop = loops[0];
    const receiver = Node_Expression(context.ast, loop);
    const refinement = context.source.semantics.selectValueTypeRefinement(receiver);
    assert.equal(refinement.kind, "resolved", "the checker supplied local null-guard narrowing");
    const types = context.semanticsFor(receiver).types;
    assert.equal(types.isIdentical(types.nonNullableType(refinement.declaredType), refinement.selectedType), true,
      "the selected array is exactly the declared nonnullable type");
    const raw = context.records.runtimeCarrier.get(receiver)?.carrier;
    const present = rustSourceOptionalElementCarrier(raw);
    const variants = present === undefined ? undefined : context.typeDefinitions.sourceUnionVariants(present);
    assert.equal(variants?.length, 1, "the recursive declaration retains its single physical payload variant");
    const payload = variants[0].carrier;
    const projection = context.records.flowReadProjection.get(receiver);
    assert.equal(projection?.kind, "source-union",
      `the checker-selected payload must not stop at the enum wrapper (${projection?.kind ?? "missing"})`);
    assert.equal(rustTargetTypeRefEquals(projection.sourceCarrier, raw), true,
      "the projection starts from the original single-absence storage");
    assert.equal(rustTargetTypeRefEquals(projection.selectedCarrier, payload), true,
      "the selected carrier is the exact declared array payload");
    const policy = rustIterableTargetPolicy(payload, context.typeDefinitions);
    assert.equal(policy !== undefined, true, "the strict native policy already supports the declared payload");
    const operation = context.records.targetOperation.get(loop);
    assert.equal(operation?.kind, "iteration", "iteration is admitted after the existing projection");
    assert.equal(rustTargetTypeRefEquals(operation.elementCarrier, policy.elementCarrier), true,
      "the loop binding receives the exact declared recursive element");
    assert.equal(result.diagnostics.length, 0, "the original recursive loop has no analysis rejection");
  });

  test(`further numeric narrowing retains the recursive collection arm on ${surface}`, () => {
    const { context, result } = inspectCheckedSource(`
export type Tree = number | readonly Tree[] | null | undefined;
export function sum(tree: Tree): number {
  if (tree == null) return 0;
  if (typeof tree === "number") return tree;
  let total = 0;
  for (const child of tree) total += sum(child);
  return total;
}
`, surface);
    const loops = descendants(context, node => context.ast.is.IsForOfStatement(node));
    assert.equal(loops.length, 1, "the numeric-or-collection loop is retained");
    const loop = loops[0];
    const receiver = Node_Expression(context.ast, loop);
    const raw = context.records.runtimeCarrier.get(receiver)?.carrier;
    const projection = context.records.flowReadProjection.get(receiver);
    assert.equal(projection?.kind, "source-union", "the checked numeric exclusion selects one union payload");
    assert.equal(rustTargetTypeRefEquals(projection.sourceCarrier, raw), true,
      "further narrowing preserves the original optional source");
    const operation = context.records.targetOperation.get(loop);
    assert.equal(operation?.kind, "iteration", "the actual narrowed collection admits iteration");
    const policy = rustIterableTargetPolicy(projection.selectedCarrier, context.typeDefinitions);
    assert.equal(policy !== undefined && rustTargetTypeRefEquals(operation.elementCarrier, policy.elementCarrier), true,
      "iteration consumes the checker-selected payload without selecting a second carrier");
    assert.equal(result.diagnostics.length, 0, "the original numeric-or-array loop is admitted");
  });

  test(`whole union and scalar or generic option reads preserve their physical payload on ${surface}`, () => {
    const { context, result } = inspectCheckedSource(`
export type Tree = number | readonly Tree[] | null | undefined;
export function treeValue(value: Tree): Tree {
  if (value == null) return undefined;
  return value;
}
export function textValue(value: string | null | undefined): string {
  if (value == null) return "absent";
  return value;
}
export function genericValue<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  return value;
}
`, surface);
    const reads = descendants(context, node => {
      if (!context.ast.is.IsReturnStatement(node)) return false;
      const expression = context.ast.as.AsReturnStatement(node).Expression;
      return expression !== undefined && context.ast.is.IsIdentifier(expression) && context.ast.text(expression) === "value";
    }).map(node => context.ast.as.AsReturnStatement(node).Expression);
    assert.equal(reads.length, 3, "the whole union, scalar and generic present-value reads are all checked");
    for (const [index, receiver] of reads.entries()) {
      const raw = context.records.runtimeCarrier.get(receiver)?.carrier;
      const payload = rustSourceOptionalElementCarrier(raw);
      const projection = context.records.flowReadProjection.get(receiver);
      assert.equal(payload !== undefined, true, `read ${index}: one original optional payload is retained`);
      assert.equal(projection?.kind, "option-value", `read ${index}: no individual union arm is invented`);
      assert.equal(rustTargetTypeRefEquals(projection.sourceCarrier, raw), true,
        `read ${index}: the original native source carrier is unchanged`);
      assert.equal(rustTargetTypeRefEquals(projection.selectedCarrier, payload), true,
        `read ${index}: the complete original payload identity is preserved`);
    }
    assert.equal(result.diagnostics.length, 0, "the unchanged whole-union/scalar/generic contracts remain admitted");
  });
}
