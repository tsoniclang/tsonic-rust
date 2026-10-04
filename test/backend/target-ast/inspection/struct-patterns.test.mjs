import assert from "node:assert/strict";
import test from "node:test";
import { printRustPattern } from "../../../../dist/print/source/patterns.js";
import { rustPatternBindsPath } from "../../../../dist/backend/target-ast/inspection/source-usage.js";
import { rustItemsReferenceModuleAlias } from "../../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { finalizeRustSourceStyle } from "../../../../dist/backend/target-ast/normalization/source-style.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/nodes.js";
import { rustLintAttributes } from "../../../../dist/backend/target-ast/normalization/lint-policy.js";

test("native struct patterns retain exact names, binding scope and module identity", () => {
  const pattern = { kind: "struct", path: "model::Payload", fields: [
    { name: "error", pattern: { kind: "binding", name: "error" } },
    { name: "value", pattern: { kind: "tuple", elements: [{ kind: "binding", name: "userName" },
      { kind: "path", path: "sentinel::None" }] } },
  ] };
  assert.equal(printRustPattern(pattern), "model::Payload { error, value: (userName, sentinel::None) }");
  for (const name of ["error", "userName"]) assert.equal(rustPatternBindsPath(pattern, name), true);
  for (const name of ["value", "other"]) assert.equal(rustPatternBindsPath(pattern, name), false);
  const expression = { kind: "match", expression: { kind: "path", path: "input" }, arms: [
    { pattern, expression: { kind: "int-literal", text: "1" } },
  ] };
  const item = { kind: "function", name: "read", visibility: "public", generics: emptyRustGenerics,
    params: [], returnType: { kind: "primitive", name: "i32" }, body: { statements: [{ kind: "tail", expr: expression }] } };
  assert.equal(rustItemsReferenceModuleAlias([item], "model"), true);
  assert.equal(rustItemsReferenceModuleAlias([item], "sentinel"), true);
  assert.equal(rustItemsReferenceModuleAlias([item], "other"), false);
  const normalized = finalizeRustSourceStyle({ headerComment: "Native pattern scope", items: [item] });
  assert.equal(normalized.items[0].attrs.some(attribute => JSON.stringify(attribute) === JSON.stringify(rustLintAttributes.nonSnakeCaseName)), true);
});
