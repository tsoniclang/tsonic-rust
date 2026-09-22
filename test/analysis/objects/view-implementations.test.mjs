import assert from "node:assert/strict";
import test from "node:test";
import { selectRustProjectViewImplementations } from "../../../dist/analysis/objects/view-implementations.js";
import { createRustClassValueRegistry } from "../../../dist/analysis/objects/class-values.js";
import { rustSourceTypeCarrier, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";

const declaration = Object.freeze({ file: "/model.ts" });
const member = Object.freeze({ file: "/model.ts" });
const parameter = { kind: "type-parameter", name: "Value" };
const number = { kind: "source-primitive", name: "float64" };
const source = argument => rustSourceTypeCarrier("/model.ts", "Box", "object", [{ kind: "type", type: argument }]);
const view = (argument, file = "/view.ts") => ({ declaration, sourceCarrier: source(argument),
  targetCarrier: rustStructuralObjectTargetType(file, [{ sourceName: "value", type: argument, presence: "required", readonly: true }]),
  fields: [{ declaration: member, storageIndex: 0 }],
});
const context = sameComponent => ({
  ast: { getSourceFile: node => node.file, getFileName: file => file },
  sourcePackages: { packages: [
    { componentId: "model", sourceFiles: ["/model.ts"] },
    { componentId: sameComponent ? "model" : "view", sourceFiles: ["/view.ts", "/other.ts"] },
  ] },
});

test("native instance and constructor views share one exact generic implementation", () => {
  const generic = view(parameter);
  const concrete = view(number);
  const selected = selectRustProjectViewImplementations([concrete, generic, concrete], context(false));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].sourceCarrier, generic.sourceCarrier);
  assert.equal(selected[0].ownerFileName, "/view.ts");
  assert.ok(Object.isFrozen(selected));
  assert.ok(Object.isFrozen(selected[0]));
  assert.equal(selectRustProjectViewImplementations([generic, concrete], context(true))[0].ownerFileName, "/model.ts");
});

test("view coverage does not merge distinct declarations, layouts or destination owners", () => {
  const generic = view(parameter);
  const concrete = view(number);
  const variants = [
    { ...concrete, declaration: { file: "/model.ts" } },
    { ...concrete, fields: [{ declaration: member, storageIndex: 1 }] },
    { ...concrete, fields: [{ declaration: { file: "/model.ts" }, storageIndex: 0 }] },
    view(number, "/other.ts"),
    { ...concrete, targetCarrier: view({ kind: "source-primitive", name: "bool" }).targetCarrier },
  ];
  for (const variant of variants) assert.equal(selectRustProjectViewImplementations([generic, variant], context(false)).length, 2);
  assert.throws(() => selectRustProjectViewImplementations([view(number, "/missing.ts")], context(false)), /exact source and destination package owners/u);
  assert.throws(() => selectRustProjectViewImplementations([{ ...concrete, declaration: { file: "/missing.ts" } }], context(false)), /exact source and destination package owners/u);
});

test("constructor type demand does not request a runtime evaluation", () => {
  const registry = createRustClassValueRegistry();
  assert.equal(registry.hasConstructorValue(declaration), false);
  registry.recordConstructorValue(declaration, "type");
  assert.equal(registry.hasConstructorValue(declaration), true);
  assert.equal(registry.evaluatesConstructorValue(declaration), false);
  registry.recordConstructorValue(declaration, "value");
  assert.equal(registry.evaluatesConstructorValue(declaration), true);
  registry.recordConstructorValue(declaration, "type");
  assert.equal(registry.evaluatesConstructorValue(declaration), true);
});
