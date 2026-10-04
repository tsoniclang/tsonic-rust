import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";
import { rustSourceTypeCarrier, rustSourcePrimitiveTargetType } from "../../dist/target-model/types/index.js";

test("native Error origins are exact immutable type definitions with one publication owner", () => {
  const carrier = rustSourceTypeCarrier("/failure.ts", "Failure", "object");
  const registry = createRustTypeDefinitionRegistry();
  const origin = { kind: "project", variant: "Failure", sourceError: true };
  assert.equal(registry.registerProgramErrorOrigin(carrier, origin), true);
  const selected = registry.programErrorOrigin(carrier);
  assert.equal(Object.isFrozen(selected), true);
  origin.variant = "Changed";
  assert.equal(selected.variant, "Failure");
  assert.equal(registry.registerProgramErrorOrigin(carrier, { ...selected }), true);
  assert.equal(registry.registerProgramErrorOrigin(carrier, origin), false);
  assert.equal(registry.registerProgramErrorOrigin(rustSourcePrimitiveTargetType("int64"), selected), false);
  for (const malformed of [{ ...selected, extra: true }, { ...selected, variant: "" },
    { ...selected, sourceError: 1 }, { kind: "provider", variant: "Failure" }, { kind: "unknown" }]) {
    assert.equal(registry.registerProgramErrorOrigin(carrier, malformed), false);
  }
  let reads = 0;
  const accessor = { kind: "project", variant: "Failure" };
  Object.defineProperty(accessor, "sourceError", { enumerable: true, get() { reads++; return true; } });
  assert.equal(registry.registerProgramErrorOrigin(carrier, accessor), false);
  assert.equal(reads, 0);
  const sealed = registry.seal();
  assert.equal(Object.isFrozen(sealed), true);
  assert.equal(sealed.programErrorOrigin({ ...carrier }), selected);
  assert.equal(sealed.programErrorOrigin(rustSourcePrimitiveTargetType("int64")), undefined);
  assert.equal(sealed.programErrorOrigin({ ...carrier, extra: true }), undefined);
  assert.throws(() => registry.registerProgramErrorOrigin(carrier, selected), /sealed/u);
});
