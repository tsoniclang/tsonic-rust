import assert from "node:assert/strict";
import test from "node:test";
import { planRustProjectClosedValue } from "../../../../dist/backend/planner/objects/project-closed-values.js";
import { createRustTypeDefinitionRegistry } from "../../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceTypeCarrier } from "../../../../dist/target-model/types/index.js";

test("exact project Error admission preserves its payload before passive object erasure", () => {
  const carrier = rustSourceTypeCarrier("/src/failure.ts", "Failure", "object");
  const definition = { kind: "class" };
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerProgramErrorOrigin(carrier, { kind: "project", variant: "Failure", sourceError: true }), true);
  const context = { diagnostics: [], input: { program: { typeDefinitions: registry.seal(),
    projectTypes: { definitionForCarrier: selected => selected === carrier ? definition : undefined,
      sourceErrorDefinitions: [definition] },
    objectRepresentations: { representationFor() { assert.fail("Error admission must not erase passive object capabilities"); } },
  } } };
  const source = { kind: "path", path: "original" };
  for (const owner of ["rt::TsValue", "js_abi::JsValue"]) {
    const planned = planRustProjectClosedValue(source, owner, carrier, {}, context);
    assert.equal(planned.kind, "call");
    assert.equal(planned.path, `${owner}::from_error`);
    assert.equal(planned.args[0] === source, true, "moves the identical checked source payload");
  }
  assert.equal(context.diagnostics.length, 0);
});
