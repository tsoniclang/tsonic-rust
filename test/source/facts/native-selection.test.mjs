import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceSyntax } from "../../helpers/rust-source-syntax.mjs";
import { readRustSourceProviderSelection } from "../../../dist/source/semantics/native-selection.js";
import { rustNativeSelectionOperation } from "../../../dist/source/semantics/syntax-intrinsics.js";
import { rustLangModule } from "../../../dist/source/semantics/identity.js";

const moduleSpecifier = "@test/native/index.js";
const signatures = [{ id: "call", parameters: [{ name: "input", type: { kind: "number" } }], returnType: { kind: "number" } }];
const modules = [{ id: "test.native", moduleSpecifier, exports: [
  { id: "only.macro", name: "onlymacro", kind: "intrinsic" },
  { id: "only.value", name: "onlyvalue", kind: "function", signatures },
  { id: "both.value", intrinsicId: "both.macro", name: "both", kind: "function", signatures },
  { id: "type.only", name: "TypeOnly", kind: "type", type: { kind: "number" } },
] }];

function selection(expression, prefix = "", options = {}) {
  const state = createRustSourceSyntax([
    `import { native as selector } from "${rustLangModule}";`,
    `import * as syntax from "${rustLangModule}";`,
    `import { onlymacro, onlyvalue, both, TypeOnly } from "${moduleSpecifier}";`,
    `import * as bindings from "${moduleSpecifier}";`,
    prefix,
    `const selected = ${expression};`,
  ].join("\n"), { modules, ...options });
  const declaration = state.nodes.filter(node => state.ast.is.IsVariableDeclaration(node)).at(-1);
  const source = state.ast.as.AsVariableDeclaration(declaration).Initializer;
  assert.ok(source);
  const reference = expression => state.queries.checker.getProviderReferenceInfo(expression);
  return { ...state, selected: readRustSourceProviderSelection(source, { ast: state.ast, reference }), expression: source, reference };
}

test("native selection uses exact intrinsic and ordinary facets without choosing ambiguous namespaces", () => {
  for (const expression of ["both", "bindings.both"]) {
    const value = selection(expression).selected;
    assert.equal(value.kind, "ambiguous");
    assert.equal(value.reference.intrinsic.exportId, "both.macro");
    assert.equal(value.reference.ordinary.declaration.exportId, "both.value");
    assert.ok(Object.isFrozen(value));
  }
  for (const operation of ["macro", "value"]) {
    for (const binding of ["both", "bindings.both", 'bindings["both"]']) {
      const value = selection(`selector.${operation}(${binding})`);
      const result = value.selected;
      assert.equal(result.kind, operation === "macro" ? "intrinsic" : "ordinary");
      assert.equal(result.expression, value.ast.arguments(value.expression)[0]);
      assert.equal(result.symbol, value.reference(result.expression).symbol);
      assert.ok(Object.isFrozen(result));
      if (operation === "macro") assert.equal(result.intrinsic.exportId, "both.macro");
      else assert.equal(result.ordinary.declaration.exportId, "both.value");
    }
  }
});

test("macro-only and ordinary-only bindings do not require a selector or gain another facet", () => {
  for (const expression of ["onlymacro", "selector.macro(onlymacro)"]) {
    const selected = selection(expression).selected;
    assert.equal(selected.kind, "intrinsic");
    assert.equal(selected.intrinsic.exportId, "only.macro");
  }
  for (const expression of ["onlyvalue", "selector.value(onlyvalue)"]) {
    const selected = selection(expression).selected;
    assert.equal(selected.kind, "ordinary");
    assert.equal(selected.ordinary.declaration.exportId, "only.value");
  }
  for (const expression of ["selector.value(onlymacro)", "selector.macro(onlyvalue)"]) {
    const selected = selection(expression).selected;
    assert.equal(selected.kind, "rejected");
    assert.match(selected.reason, /has no .* facet/u);
  }
  const type = selection("selector.value(TypeOnly)").selected;
  assert.equal(type.kind, "ordinary");
  assert.equal(type.ordinary.declaration.exportId, "type.only");
  assert.equal("callable" in type, false);
});

test("native selection preserves exact immutable aliases and re-exports", () => {
  for (const expression of ["choose(alias)", 'syntax["native"]["macro"](alias)', "(selector.macro((alias)))"]) {
    const value = selection(expression, "const choose = selector.macro; const alias = both;");
    assert.equal(value.selected.kind, "intrinsic");
    assert.equal(value.selected.intrinsic.exportId, "both.macro");
  }
  const value = selection("renamed.mac(renamedBinding)", 'import { renamed, renamedBinding } from "./bridge.js";', {
    files: { "/src/bridge.ts": `import { native } from "${rustLangModule}";
export const renamed = native;
export { both as renamedBinding } from "${moduleSpecifier}";` },
  });
  assert.equal(value.selected.kind, "unavailable");
  const reexport = selection("renamed.macro(renamedBinding)", 'import { renamed, renamedBinding } from "./bridge.js";', {
    files: { "/src/bridge.ts": `export { native as renamed } from "${rustLangModule}";
export { both as renamedBinding } from "${moduleSpecifier}";` },
  });
  assert.equal(reexport.selected.kind, "intrinsic");
  assert.equal(reexport.selected.intrinsic.exportId, "both.macro");
});

test("native selection rejects malformed and runtime-selected operands instead of invoking them", () => {
  for (const expression of [
    "selector.macro()", "selector.macro(both, onlymacro)", "selector.macro<number>(both)",
    "selector.macro?.(both)", "selector.macro`both`", "selector.macro(() => both)",
    "selector.macro(factory())", "selector.macro(flag ? both : onlymacro)",
    "selector.macro(holding.current)", "selector.value(holder)",
  ]) {
    const value = selection(expression, `const flag = true;
function factory() { throw new Error("not evaluated"); }
const holding = { current: both };
let holder = onlyvalue;`);
    assert.equal(value.selected.kind, "rejected", expression);
    assert.ok(Object.isFrozen(value.selected));
  }
});

test("native selectors require complete owned declaration identity, not spelling or a forged member", () => {
  const value = selection("selector.macro(onlymacro)");
  const fact = value.reference(value.ast.as.AsCallExpression(value.expression).Expression).intrinsic;
  assert.equal(rustNativeSelectionOperation(fact), "macro");
  for (const change of [
    { providerId: "other" }, { providerVersion: "other" }, { moduleSpecifier: "other" },
    { providerModuleId: "other" }, { exportId: "other" }, { exportName: "other" },
    { signatureId: "call" }, { memberId: "other" }, { memberName: "value" },
    { memberKey: { kind: "property-key", name: "other" } }, { memberStatic: true },
  ]) assert.equal(rustNativeSelectionOperation({ ...fact, ...change }), undefined);
  const ordinary = selection("ordinary.macro(both)", "const ordinary = { macro(value: number) { return value; } };");
  assert.equal(ordinary.selected.kind, "unavailable");
});
