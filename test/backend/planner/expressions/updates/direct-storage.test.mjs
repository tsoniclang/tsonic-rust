import assert from "node:assert/strict";
import test from "node:test";
import { planRustDirectStorageCore } from "../../../../../dist/backend/planner/expressions/updates/direct-storage.js";
import { rustBindingStorageFactKey, rustModuleBindingFactKey, rustSourceBindingFactKey } from "../../../../../dist/analysis/facts/keys.js";
import { rustStringTargetType } from "../../../../../dist/target-model/types/index.js";
import { fakeAstReader } from "../../../../helpers/fake-compile-input.mjs";

function fixture(storage, module = false) {
  const node = { kindName: "KindIdentifier" };
  const declaration = {};
  const carrier = rustStringTargetType();
  const context = { input: { program: {
    source: { ast: { ...fakeAstReader(), is: { ...fakeAstReader().is,
      IsParenthesizedExpression: selected => selected.kindName === "KindParenthesizedExpression" },
      as: { AsParenthesizedExpression: selected => selected.kindName === "KindParenthesizedExpression" ? selected : undefined } } },
    sourceNavigation: { sourceReferenceFor: () => undefined },
    facts: { getFact: (selected, key) => selected === node && key === rustSourceBindingFactKey
      ? { sourceDeclaration: declaration, scope: module ? "module" : "lexical", fileName: "/index.ts" }
      : selected === declaration && key === (module ? rustModuleBindingFactKey : rustBindingStorageFactKey) && storage !== undefined
        ? { storage, valueCarrier: carrier } : undefined },
    names: { nameForDeclaration: () => "value" }, localStorageAliases: { owner: () => undefined },
  } }, moduleName: "index", crateName: "app", moduleNameByFileName: new Map([["/index.ts", "index"]]),
    externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map() };
  return { node, declaration, carrier, context };
}

function selected(node, context) {
  return planRustDirectStorageCore(node, context, undefined,
    () => assert.fail("direct binding selection must not replan a value"),
    () => assert.fail("direct binding selection must not invent a provider call"));
}

test("direct storage consumes finalized lexical and module binding representation", () => {
  for (const storage of ["location", "cell", "borrow-cell"]) {
    const { node, context } = fixture(storage);
    assert.equal(selected(node, context) === undefined, true, storage);
    assert.equal(selected({ kindName: "KindParenthesizedExpression", Expression: node }, context) === undefined, true, storage + " parenthesized");
  }
  const { node, context } = fixture("module-cell", true);
  assert.equal(selected(node, context) === undefined, true, "module storage is not a native value place");
  const direct = fixture();
  assert.deepEqual(selected(direct.node, direct.context), { kind: "path", path: "value" });
});

test("direct storage preserves exact lexical value overrides and selected capture storage", () => {
  const { node, declaration, carrier, context } = fixture("location");
  const expression = { kind: "path", path: "selected_value" };
  assert.equal(selected(node, { ...context, expressionOverrides: new Map([[node, {
    expression, carrier, valueForm: "storage",
  }]]) }) === expression, true, "a lexical storage override owns its physical expression");
  for (const valueForm of ["owned", "shared-reference"]) {
    assert.equal(selected(node, { ...context, expressionOverrides: new Map([[node, {
      expression, carrier, valueForm,
    }]]) }) === undefined, true, valueForm);
  }
  for (const storage of ["value", "location", "cell", "borrow-cell"]) {
    const capture = { declaration, expression, valueCarrier: carrier, storage };
    const result = selected(node, { ...context, capturedBindings: [capture] });
    assert.equal(result === expression, storage === "value", "the selected capture owns " + storage);
  }
});
