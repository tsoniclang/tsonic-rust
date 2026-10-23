import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { selectRustStructuralMethodExposure } from "../../../dist/policy/types/objects/structural-emission.js";
import { rustFixedStructuralMethodDeclarations } from "../../../dist/analysis/callables/generic-values.js";

test("fixed native methods require complete readonly, required and exact body evidence", () => {
  const selected = { writes: "none", boundary: "none", extracted: false, implementations: 1, presence: "required" };
  assert.equal(selectRustStructuralMethodExposure(selected), "fixed", "one required native body has no stored callable");
  assert.equal(selectRustStructuralMethodExposure({ ...selected, boundary: "export-only" }), "fixed",
    "an export alone does not manufacture a retained callable or mutable method");
  for (const [name, change] of [
    ["written", { writes: "present" }], ["unknown writes", { writes: "unresolved" }],
    ["opaque boundary", { boundary: "opaque" }], ["extracted identity", { extracted: true }],
    ["missing body", { implementations: 0 }], ["distinct bodies", { implementations: 2 }],
    ["optional presence", { presence: "optional" }],
  ]) assert.equal(selectRustStructuralMethodExposure({ ...selected, ...change }), "stored", name);
});

test("only universally fixed actual bodies leave the retained generic family", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function create() {
  return { identity<Value>(value: Value): Value {
    const nested = <Inner>(inner: Inner): Inner => inner;
    return nested(value);
  } };
}
` } });
  const ast = program.source.ast;
  const definitions = program.structuralShapes.definitions;
  const definition = definitions.find(definition => definition.fields.some(field => field.methodPlan?.kind === "fixed"));
  assert.equal(definition !== undefined, true, "the checked literal publishes one actual fixed method plan");
  const method = definition.fields.find(field => field.methodPlan?.kind === "fixed").methodPlan;
  assert.equal(rustFixedStructuralMethodDeclarations(ast, program.structuralShapes).has(method.declaration), true,
    "the exact universally fixed source declaration needs no retained family");
  assert.equal(program.callableValues.generic.implementationFor(method.declaration), undefined,
    "no generic Callable implementation is fabricated for that native fixed body");
  const nested = [];
  const visit = node => {
    if (ast.is.IsArrowFunction(node)) nested.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(method.declaration);
  assert.equal(nested.length, 1, "the original body still contains its checked nested closure");
  assert.equal(program.callableValues.generic.implementationFor(nested[0]) !== undefined, true,
    "skipping the outer retained family never skips its body or nested closure inventory");
  const retained = { ...definition, fields: definition.fields.map(field => field.methodPlan?.kind !== "fixed" ? field
    : { ...field, methodPlan: { kind: "stored", carrier: field.methodPlan.carrier,
      receiver: field.methodPlan.receiver, constructions: [] } }) };
  assert.equal(rustFixedStructuralMethodDeclarations(ast, { definitions: [...definitions, retained] }).has(method.declaration), false,
    "one retained instantiation of the same actual body keeps its needed family");
});
