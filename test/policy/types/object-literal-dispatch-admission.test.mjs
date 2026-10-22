import assert from "node:assert/strict";
import test from "node:test";
import { selectRustObjectLiteralDispatch } from "../../../dist/policy/types/objects/object-literal-emission.js";
import { rustSourceTypeCarrier } from "../../../dist/target-model/types/index.js";

// The object-literal dispatch implementation is chosen by the policy from the literal fact, the finalized project
// polymorphism and the structural dispatch shape; field fallibility is not an input.
test("data-only literal dispatch follows physical project representation rather than field fallibility", () => {
  const carrier = rustSourceTypeCarrier("/src/contracts.ts", "Options", "object");
  const field = { contractDeclarations: [{}], presence: "optional" };
  const fact = { storage: "project-object", resultCarrier: carrier, contributions: [], fields: [field] };
  for (const polymorphic of [false, true]) {
    const expected = polymorphic ? "project" : undefined;
    assert.equal(selectRustObjectLiteralDispatch({ fact, structuralDispatch: false, polymorphicProject: polymorphic }), expected);
    assert.equal(selectRustObjectLiteralDispatch({ fact: { ...fact, fields: [] }, structuralDispatch: false, polymorphicProject: polymorphic }),
      expected, "empty polymorphic shapes retain their dedicated physical construction protocol");
  }
});

test("authored methods and accessors retain their exact literal implementation requirement", () => {
  for (const contribution of [{ kind: "method" }, { kind: "accessor" }, { kind: "spread", methods: [{}] }]) {
    assert.equal(selectRustObjectLiteralDispatch({ fact: { storage: "project-object", contributions: [contribution], fields: [] },
      structuralDispatch: false, polymorphicProject: false }), "project");
  }
});

test("structural literal dispatch uses its finalized structural shape", () => {
  for (const structuralDispatch of [false, true]) {
    assert.equal(selectRustObjectLiteralDispatch({ fact: { storage: "structural-object", resultCarrier: {} },
      structuralDispatch, polymorphicProject: false }), structuralDispatch ? "structural" : undefined);
  }
});
