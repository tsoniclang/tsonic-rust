import assert from "node:assert/strict";
import test from "node:test";
import { classifyCarrierRequirements } from "../../../dist/analysis/declarations/generic-carrier-requirements.js";
import { rustRuntimeErrorTargetType } from "../../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustCarrierSatisfiesTraitRef } from "../../../dist/policy/constraints/native-traits.js";
import { rustMutableJsErrorTargetType, rustRetainedErrorTargetType, rustSourceErrorTargetType, rustWritableRetainedErrorTargetType, rustWritableSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustNamedTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../helpers/plan-context.mjs";
import { planRustCallableGenerics } from "../../../dist/backend/planner/declarations/callables/generics.js";

const retained = rustRetainedErrorTargetType();
const obligation = { kind: "trait-ref", id: "core::convert::Into", path: "core::convert::Into",
  genericArguments: [{ kind: "type", type: retained }], associatedConstraints: [] };
const accepts = carrier => classifyCarrierRequirements(carrier, ["js-rejection"], new Set(), new Map(), () => false, emptyRustTypeDefinitions, undefined).kind === "supported";

test("JS rejection obligations use the exact native Into<RetainedError> contract", () => {
  for (const [label, carrier] of [
    ["JsError", rustJsErrorTargetType()],
    ["runtime TsonicError", rustRuntimeErrorTargetType()],
    ["physical runtime error", rustProgramErrorTargetType({ kind: "physical", domain: "runtime" })],
    ["MutableJsError", rustMutableJsErrorTargetType()],
    ["RetainedError", retained],
    ["WritableRetainedError", rustWritableRetainedErrorTargetType()],
    ["SourceError", rustSourceErrorTargetType()],
    ["WritableSourceError", rustWritableSourceErrorTargetType()],
  ]) {
    assert.equal(rustCarrierSatisfiesTraitRef(carrier, obligation), true, label);
    assert.equal(accepts(carrier), true, label);
  }
});

test("a JS rejection requirement never guesses from an error name or package transport", () => {
  for (const carrier of [
    rustSourcePrimitiveTargetType("int32"),
    { kind: "target-named", id: "foreign.TsonicError" },
    { kind: "target-named", id: "foreign.JsError" },
    rustProgramErrorTargetType(),
    rustProgramErrorTargetType({ kind: "physical", domain: "project", componentId: "source" }),
    { ...retained, genericArguments: [{ kind: "type", type: rustJsErrorTargetType() }] },
  ]) {
    assert.equal(rustCarrierSatisfiesTraitRef(carrier, obligation), false);
    assert.equal(accepts(carrier), false);
  }
  for (const trait of [
    { ...obligation, genericArguments: [] },
    { ...obligation, genericArguments: [...obligation.genericArguments, ...obligation.genericArguments] },
    { ...obligation, genericArguments: [{ kind: "type", type: rustSourcePrimitiveTargetType("int32") }] },
  ]) assert.equal(rustCarrierSatisfiesTraitRef(rustJsErrorTargetType(), trait), false);
});

test("generic native provider evidence supplies the same exact rejection conversion obligation", () => {
  const native = trait => rustNamedTargetType("example.UnrelatedName", "example::UnrelatedName", [], [], {
    implementations: [{ trait, requirements: [] }],
  });
  assert.equal(accepts(native(obligation)), true);
  assert.equal(accepts(native({ ...obligation, genericArguments: [{ kind: "type", type: rustJsErrorTargetType() }] })), false);
  assert.equal(accepts(native({ ...obligation, path: "foreign::Into" })), false);
});

test("generic JS rejection obligations stay on their exact type and associated binders", () => {
  const parameter = { kind: "type-parameter", identity: "source/Error", name: "Error" };
  const requirements = new Map([[parameter.identity, new Set()]]);
  assert.equal(classifyCarrierRequirements(parameter, ["js-rejection"], new Set([parameter.identity]), requirements,
    () => false, emptyRustTypeDefinitions, undefined).kind === "supported", true);
  assert.deepEqual([...requirements.get(parameter.identity)], ["js-rejection"]);
  assert.equal(classifyCarrierRequirements(parameter, ["js-rejection"], new Set(), new Map(),
    () => false, emptyRustTypeDefinitions, undefined).kind === "supported", false);
  const associated = { kind: "associated-type", owner: parameter, name: "Error" };
  assert.equal(classifyCarrierRequirements(associated, ["js-rejection"], new Set(), new Map(),
    (carrier, requirement) => carrier === associated && requirement === "js-rejection", emptyRustTypeDefinitions, undefined).kind === "supported", true);
  assert.equal(classifyCarrierRequirements(associated, ["js-rejection"], new Set(), new Map(),
    () => false, emptyRustTypeDefinitions, undefined).kind === "supported", false);
});

test("native-only generic inputs retain their selected Promise object error bounds", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export async function invoke(callback: () => Promise<number>): Promise<number> {
  return await callback();
}` } });
  const { ast } = program.source;
  const declaration = program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
    ast.is.IsFunctionDeclaration(node) && program.records.sourceName.get(node) === "invoke");
  assert.equal(declaration !== undefined, true, "the original checked async declaration");
  assert.equal(ast.typeParameters(declaration).length, 0, "no authored generic parameter supplies this bound");
  const selected = program.records.nativeGenerics.get(declaration);
  assert.equal(selected?.inputs.length, 1, "the native callable input owns its exact implementation parameter");
  assert.equal(selected.sourceRequirements?.associatedTypes.some(requirement =>
    requirement.requirements.includes("js-rejection")), true, "analysis already selected the exact rejection obligation");
  const context = rustSourceFilePlanContext(program, declaration);
  const object = planRustCallableGenerics(declaration, context, undefined).finalizeGenerics();
  const intoRetained = bound => bound.kind === "trait" && bound.path === "Into<tsonic_rust_runtime::RetainedError>";
  assert.equal(object.wherePredicates.some(predicate => predicate.kind === "type" && predicate.bounds.some(intoRetained)),
    true, "the object wrapper renders its selected associated-error bound without an authored generic");
  const body = planRustCallableGenerics(declaration, { ...context, promiseBody: true }, undefined).finalizeGenerics();
  assert.equal(body.wherePredicates.some(predicate => predicate.kind === "type" && predicate.bounds.some(intoRetained)),
    false, "the native body does not inherit an unrelated JS object conversion obligation");
});
