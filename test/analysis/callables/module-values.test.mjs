import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { recordRustModuleCallableStorage } from "../../../dist/analysis/callables/module-values.js";



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
    [declaration, new Map([["moduleBinding", { storage: "native-callable", value: { carrier: source } }]])],
    [reference, new Map([
      ["directCallableReference", direct === null ? undefined : { carrier: direct }],
      ["contextualValueConversion", conversion ? { targetCarrier: target,
        conversion: selectRustCallableConversion(source, target, () => undefined) } : undefined],
    ])],
  ]);
  recordRustModuleCallableStorage({ context: {
    ast: { forEachChild() {}, is: { IsFunctionDeclaration() { return false; } } }, sourceFiles: [declaration],
    source: { navigation: { declarationUseSummary() { return { exported }; },
      expressionValueFlow() { return { aliasDeclarations: [] }; },
      declarationUses() { return [{ kind, reference }]; } } },
    records: createRustRecordFixture({
      moduleBinding: { get: node => values.get(node)?.get("moduleBinding") },
      directCallableReference: { get: node => values.get(node)?.get("directCallableReference") },
      contextualValueConversion: { get: node => values.get(node)?.get("contextualValueConversion") },
      moduleCallableStorage: {
        get: node => values.get(node)?.get("moduleCallableStorage"),
        set: (node, value) => values.get(node).set("moduleCallableStorage", value),
      },
    }),
  } });
  return values.get(declaration).get("moduleCallableStorage");
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
      records: createRustRecordFixture({moduleBinding: { get: (node) => {
    if (node !== declaration)
        return undefined;
    return { storage: "native-callable", value: { carrier: source } };
} },
moduleCallableStorage: { get: (node) => {
    if (node !== declaration)
        return undefined;
    return storage;
} }}),
    }, {}, { outputType: "lib", projectRoot: "/src", entryPoint: "index.ts" });
    assert.equal(plan.requirementFor(sourceFile).kind, expected);
    assert.equal(plan.minimumFoundation(), expected === "required" ? "std" : "core");
  }
});
