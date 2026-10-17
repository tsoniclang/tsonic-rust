import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { planRustSourceErrorPropagation } from "../../../../dist/backend/planner/expressions/calls/source-errors.js";

import { planRustNativeErrorJoin } from "../../../../dist/backend/planner/types/native-error-joins.js";
import { rustNativeFallibleBoundary } from "../../../../dist/backend/planner/program/fallible-boundaries.js";
import { nativeProducerFixture } from "../../../helpers/native-producer-bridges.mjs";
import { analyzeRustErrorRegions, publishRustErrorRegion } from "../../../../dist/analysis/errors/regions.js";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
import { createRustErrorRegionCatalog } from "../../../../dist/backend/planner/program/error-regions.js";

function fixture(joined = false) {
  const carrier = { kind: "source-primitive", name: "int32" };
  const { context } = nativeProducerFixture({ result: carrier });
  const declaration = {};
  const node = {};
  const source = { identity: "producer", errorType: carrier };
  const target = { identity: "instantiation", errorType: carrier };
  const sourceEffects = { localErrors: false, nativeErrors: [source] };
  const edge = { declaration, effects: { localErrors: false, nativeErrors: [target] }, nativeErrors: [{ source, target }] };
  const errorType = { kind: "primitive", name: "i32" };
  const join = planRustNativeErrorJoin({ identity: "exact-active-region", name: "ActiveErrors", visibility: "private",
    sources: [{ ...target, errorType, variant: "Target" }, ...(joined
      ? [{ identity: "other", errorType, variant: "Other" }] : [])] });
  context.fallibleBoundary = rustNativeFallibleBoundary(join);
  context.syntheticNames = { reserved: new Set(), nextSuffixByBase: new Map() };
  context.diagnostics = [];
  context.sourceFile = {};
  const ast = {
    getSourceFile: () => context.sourceFile, getFileName: () => "/index.ts", getSourceText: () => "",
    kindName: () => "KindCallExpression", pos: () => 0, end: () => 0,
    forEachChild: (selected, visit) => {
      if (selected === context.sourceFile) { visit(declaration); visit(node); }
    },
  };
  context.input.program.source = { ast };
  context.input.program.sourceFiles = [context.sourceFile];
  const records = createRustRecordFixture({
    errorEffects: { get: selected => selected === declaration ? sourceEffects : undefined },
    sourceErrorEffects: { get: selected => selected === node ? { edges: [edge] } : undefined },
  });
  context.input.program.records = records;
  const regions = analyzeRustErrorRegions({ ast, sourceFiles: [context.sourceFile], isNativeNode: () => true,
    records, definitions: context.input.program.typeDefinitions, producers: { producers: [] },
    names: { nameForDeclaration: () => undefined, functionNameForDeclaration: () => undefined,
      callableValueNameForDeclaration: () => undefined },
    callables: { native: { inputs: [] }, nativeGenericProducers: { errorAritiesFor: () => [] } },
    promiseBodies: { objects: new Set() },
  });
  assert.equal(regions.kind, "resolved", "the actual source edge and physical payloads pass the canonical pre-seal selector");
  const selected = regions.value.sourceFor(edge);
  assert.equal(selected?.channels.length === 1 && selected.channels[0].sourceIdentity === source.identity &&
    selected.channels[0].targetIdentity === target.identity, true, "the sealed source-to-caller error identity is exact");
  const native = publishRustErrorRegion(selected.operand, node, {
    typeDefinitions: context.input.program.typeDefinitions, typeParameterNames: undefined,
    pathFor: () => undefined, additionalArgumentsFor: () => undefined, programErrorCarrier: () => undefined,
    producerErrorCarrier: () => undefined, nativeErrorJoinCarrier: () => undefined, structuralCarrier: () => undefined,
  });
  assert.equal(native.kind, "resolved", "the original exact payload is admitted before native planning");
  const use = targetUseSiteRef(declaration, "native-body", "/index.ts:fixture");
  context.emissionContext = Object.freeze({ use });
  const operand = Object.freeze({ sourceErrorRegions: Object.freeze([
    Object.freeze({ edge, selection: Object.freeze({ ...selected, operand: native.value }) }),
  ]) });
  context.input.program.physicalEmissionContexts = {
    sourceErrorOperandFor: (selectedUse, subject) => selectedUse === use && subject === node ? operand : undefined,
  };
  context.input.program.errorRegions = { declarationsFor: regions.value.declarationsFor, producerError: regions.value.producerError };
  context.input.errorRegions = createRustErrorRegionCatalog(context.input.program);
  return { context, node, edge, expression: { kind: "call", path: "invoke", args: [] } };
}

test("exact unchanged source errors propagate without an identity map closure", () => {
  const current = fixture();
  const result = planRustSourceErrorPropagation(current.node, current.edge, current.expression, current.context);
  assert.equal(result?.kind, "try");
  assert.equal(result.expr === current.expression, true, "validated identical error payload needs no adapter");
  assert.equal(current.context.diagnostics.length, 0);
});

test("a source error entering a real join retains the exact variant adapter", () => {
  const current = fixture(true);
  const result = planRustSourceErrorPropagation(current.node, current.edge, current.expression, current.context);
  assert.equal(result?.kind, "try");
  assert.equal(result.expr.kind, "method-call");
  assert.equal(result.expr.method, "map_err");
  assert.equal(result.expr.receiver === current.expression, true);
  assert.equal(result.expr.args[0].body.method, "Target");
  assert.equal(current.context.diagnostics.length, 0);
});

test("equal native error types never bypass missing source correspondence", () => {
  const current = fixture();
  const edge = { ...current.edge, nativeErrors: [{ ...current.edge.nativeErrors[0],
    source: { ...current.edge.nativeErrors[0].source, identity: "foreign-producer" } }] };
  assert.equal(planRustSourceErrorPropagation(current.node, edge, current.expression, current.context) === undefined, true);
  assert.equal(current.context.diagnostics.length, 1);
  assert.equal(current.context.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
});
