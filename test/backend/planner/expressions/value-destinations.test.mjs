import assert from "node:assert/strict";
import test from "node:test";
import { rustValueDestinationContext, rustSelectedValueDestinationContext, rustReturnValueContext }
  from "../../../../dist/backend/planner/expressions/value-destinations.js";

test("physical destinations apply to the selected expression and preserve unrelated demands", () => {
  const expression = {};
  const other = {};
  const child = {};
  const carrier = { kind: "type-parameter", identity: "physical", name: "Physical" };
  const existing = { kind: "source-primitive", name: "int32" };
  const context = { valueDestinations: new Map([[other, existing]]) };
  const selected = rustValueDestinationContext(expression, carrier, context);
  assert.equal(selected.valueDestinations.get(expression) === carrier, true);
  assert.equal(selected.valueDestinations.get(other) === existing, true);
  assert.equal(selected.valueDestinations.has(child), false);
  assert.equal(context.valueDestinations.has(expression), false);
  assert.equal(rustValueDestinationContext(expression, undefined, context) === context, true);
});

test("identity destinations preserve context without allocating a second map", () => {
  const context = {};
  const selection = { kind: "identity", carrier: { kind: "source-primitive", name: "int32" } };
  assert.equal(rustSelectedValueDestinationContext({}, selection, context) === context, true);
});

test("return destinations use the exact owning declaration rather than an operand or enclosing caller", () => {
  const expression = {};
  const declaration = {};
  const requested = [];
  const carrier = { kind: "type-parameter", identity: "returned-physical", name: "Returned" };
  const context = { callableDeclaration: declaration, input: { program: { callableValues: {
    nativeStorage: { returnFor(owner) { requested.push(owner); return { kind: "selected", carrier, inputs: [] }; } },
  } } } };
  const selected = rustReturnValueContext(expression, context);
  assert.equal(requested.length, 1);
  assert.equal(requested[0] === declaration, true);
  assert.equal(selected.valueDestinations.get(expression) === carrier, true);
  assert.equal(selected.valueDestinations.has(declaration), false);
});
