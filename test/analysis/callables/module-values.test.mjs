import assert from "node:assert/strict";
import test from "node:test";
import { recordRustModuleCallableStorage, rustModuleCallableStorageFactKey } from "../../../dist/analysis/callables/module-values.js";
import { rustContextualValueConversionFactKey, rustDirectCallableReferenceFactKey, rustModuleBindingFactKey } from "../../../dist/analysis/facts/keys.js";
import { selectRustCallableConversion } from "../../../dist/target-model/conversions/callable.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/index.js";
import { createRustModuleInitializationPlan } from "../../../dist/analysis/module-initialization/analyze.js";

const number = { kind: "source-primitive", name: "float64" };
const source = rustCallableTargetType([], number);
const target = rustCallableTargetType([number], number);

function classify({ exported = false, kind = "first-class", direct = source, conversion = true } = {}) {
  const declaration = {};
  const reference = {};
  const values = new Map([
    [declaration, new Map([[rustModuleBindingFactKey, { storage: "native-callable", value: { carrier: source } }]])],
    [reference, new Map([
      [rustDirectCallableReferenceFactKey, direct === null ? undefined : { carrier: direct }],
      [rustContextualValueConversionFactKey, conversion ? { targetCarrier: target,
        conversion: selectRustCallableConversion(source, target, () => undefined) } : undefined],
    ])],
  ]);
  recordRustModuleCallableStorage({ context: {
    ast: { forEachChild() {} }, sourceFiles: [declaration],
    source: { navigation: { declarationUseSummary() { return { exported }; },
      declarationUses() { return [{ kind, reference }]; } } },
    facts: { get(node, key) { return values.get(node)?.get(key); },
      set(node, key, value) { values.get(node).set(key, value); } },
  } });
  return values.get(declaration).get(rustModuleCallableStorageFactKey);
}

test("private immutable native adapters need no unused cached callable storage", () => {
  const selected = classify();
  assert.deepEqual(selected, { kind: "inline" });
  assert.ok(Object.isFrozen(selected));
  assert.deepEqual(classify({ kind: "direct-call" }), { kind: "inline" });
});

test("exported, stored and contradictory callable references retain identity storage", () => {
  assert.deepEqual(classify({ exported: true }), { kind: "stored" });
  assert.deepEqual(classify({ direct: null }), { kind: "stored" });
  assert.deepEqual(classify({ conversion: false }), { kind: "stored" });
  assert.deepEqual(classify({ direct: rustCallableTargetType([number], number) }), { kind: "stored" });
});

test("module initialization consumes the same sealed callable storage decision", () => {
  const sourceFile = {};
  const statement = {};
  const declaration = {};
  for (const [storage, expected] of [[{ kind: "inline" }, "not-required"],
    [{ kind: "stored" }, "required"], [undefined, "unresolved"]]) {
    const plan = createRustModuleInitializationPlan({
      ast: { statements() { return [statement]; },
        kindName(node) { return node === statement ? "KindVariableStatement" : "KindVariableDeclaration"; },
        forEachChild(node, visit) { if (node === statement) visit(declaration); } },
      sourceFiles: [sourceFile],
      source: { navigation: { moduleDependencies() { return []; } } },
      facts: { getFact(node, key) {
        if (node !== declaration) return undefined;
        if (key === rustModuleBindingFactKey) return { storage: "native-callable", value: { carrier: source } };
        if (key === rustModuleCallableStorageFactKey) return storage;
        return undefined;
      } },
    }, {});
    assert.equal(plan.requirementFor(sourceFile).kind, expected);
    assert.equal(plan.minimumFoundation(), expected === "required" ? "std" : "core");
  }
});
