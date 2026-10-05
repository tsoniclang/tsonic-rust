import assert from "node:assert/strict";
import test from "node:test";
import { rustObjectLiteralRequiresDispatchImplementation } from "../../../../dist/backend/planner/objects/object-literals/model.js";
import { rustSourceTypeCarrier } from "../../../../dist/target-model/types/index.js";

test("data-only literal dispatch follows physical project representation rather than field fallibility", () => {
  const carrier = rustSourceTypeCarrier("/src/contracts.ts", "Options", "object");
  const definition = { kind: "interface" };
  const field = { contractDeclarations: [{}], presence: "optional" };
  const fact = { storage: "project-object", resultCarrier: carrier, contributions: [], fields: [field] };
  for (const polymorphic of [false, true]) {
    const context = { input: { program: {
      projectTypes: {
        definitionForCarrier: selected => selected === carrier ? definition : undefined,
        isPolymorphic: selected => {
          assert.equal(selected === definition, true, "reads the identical finalized project definition");
          return polymorphic;
        },
      },
      projectFieldDispatch: { planFor() {
        assert.fail("field fallibility must not choose the physical object construction protocol");
      } },
    } } };
    assert.equal(rustObjectLiteralRequiresDispatchImplementation(fact, context), polymorphic);
    assert.equal(rustObjectLiteralRequiresDispatchImplementation({ ...fact, fields: [] }, context), polymorphic,
      "empty polymorphic shapes retain their dedicated physical construction protocol");
  }
});

test("authored methods and accessors retain their exact literal implementation requirement", () => {
  const context = { input: { program: { projectTypes: { definitionForCarrier() {
    assert.fail("authored behavior already proves the literal implementation requirement");
  } } } } };
  for (const contribution of [{ kind: "method" }, { kind: "accessor" }, { kind: "spread", methods: [{}] }]) {
    assert.equal(rustObjectLiteralRequiresDispatchImplementation({
      storage: "project-object", contributions: [contribution], fields: [],
    }, context), true);
  }
});

test("structural literal dispatch uses its finalized structural shape", () => {
  const carrier = {};
  for (const dispatchName of [undefined, "OptionsDispatch"]) {
    const context = { input: { program: { structuralShapes: {
      definitionForCarrier: selected => {
        assert.equal(selected === carrier, true, "reads the identical finalized structural carrier");
        return { dispatchName };
      },
    } } } };
    assert.equal(rustObjectLiteralRequiresDispatchImplementation({
      storage: "structural-object", resultCarrier: carrier,
    }, context), dispatchName !== undefined);
  }
});
