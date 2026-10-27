import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { recordRustModuleCallableStorage } from "../../../dist/analysis/callables/values/module-values.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";



import { selectRustCallableConversion } from "../../../dist/policy/conversions/callable.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/index.js";
import { createRustModuleInitializationPlan } from "../../../dist/analysis/module-initialization/analyze.js";

const number = { kind: "source-primitive", name: "float64" };
const source = rustCallableTargetType([], number);
const target = rustCallableTargetType([number], number);

function classify({ exported = false, kind = "first-class", direct = source, conversion = true } = {}) {
  const declaration = {};
  const reference = {};
  const builder = createRustProgramRecordBuilder();
  const requiredRecords = [];
  builder.moduleBindings.function(declaration, "step", { name: "step", carrier: source,
    parameterCarriers: [], resultCarrier: number });
  const values = new Map([
    [reference, new Map([
      ["directCallableReference", direct === null ? undefined : { carrier: direct }],
      ["contextualValueConversion", conversion ? { targetCarrier: target,
        conversion: selectRustCallableConversion(source, target, () => undefined) } : undefined],
    ])],
  ]);
  recordRustModuleCallableStorage({ context: {
    requiredRecords,
    isNativeNode: node => node === declaration,
    ast: { forEachChild() {}, is: { IsFunctionDeclaration() { return false; } } }, sourceFiles: [declaration],
    source: { navigation: { declarationUseSummary() { return { exported }; },
      expressionValueFlow() { return { aliasDeclarations: [] }; },
      declarationUses() { return [{ kind, reference }]; } } },
    records: { ...createRustRecordFixture({
      directCallableReference: { get: node => values.get(node)?.get("directCallableReference") },
      contextualValueConversion: { get: node => values.get(node)?.get("contextualValueConversion") },
    }, builder), assertOpen: builder.assertOpen, moduleCallableStoragePlans: builder.moduleCallableStoragePlans },
  } });
  builder.seal(requiredRecords);
  return builder.moduleCallableStorage.get(declaration);
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
  const name = {};
  for (const [storage, expected] of [[{ kind: "inline" }, "not-required"],
    [{ kind: "stored" }, "required"], [undefined, "unresolved"]]) {
    const plan = createRustModuleInitializationPlan({
      ast: { statements() { return [statement]; },
        kindName(node) { return node === statement ? "KindVariableStatement" : node === declaration ? "KindVariableDeclaration" : "KindIdentifier"; },
        name(node) { return node === declaration ? name : undefined; },
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
    }, {}, { outputType: "lib", projectRoot: "/src", entryPoint: "index.ts" }, Object.freeze([]));
    assert.equal(plan.requirementFor(sourceFile).kind, expected);
    assert.equal(plan.minimumFoundation(), expected === "required" ? "std" : "core");
  }
});

function modulePatternPlan(kind, { erased = false, prefix = "none", prefixFirst = true, sameStatement = false } = {}) {
  const sourceFile = { kind: "KindSourceFile" };
  const statement = { kind: "KindVariableStatement" };
  const declaration = { kind: "KindVariableDeclaration" };
  const name = { kind };
  const earlierDeclaration = { kind: "KindVariableDeclaration" };
  const earlierName = { kind: "KindIdentifier" };
  const expression = { kind: "KindCallExpression" };
  const member = { kind: "KindClassStaticBlockDeclaration" };
  const earlierStatement = { kind: prefix === "expression" ? "KindExpressionStatement"
    : prefix === "export" ? "KindExportAssignment"
      : prefix === "class-environment" || prefix === "static-class-field" ? "KindClassDeclaration" : "KindVariableStatement" };
  const bindings = new Map([
    [declaration, { storage: "module-cell" }],
    [earlierDeclaration, prefix === "stored-callable" ? { storage: "native-callable", value: { carrier: source } }
      : { storage: "module-cell" }],
  ]);
  const statements = prefix === "none" || sameStatement ? [statement]
    : prefixFirst ? [earlierStatement, statement] : [statement, earlierStatement];
  const plan = createRustModuleInitializationPlan({
    ast: {
      statements: () => statements,
      kindName: node => node?.kind,
      name: node => node === declaration ? name : node === earlierDeclaration ? earlierName : undefined,
      members: node => node === earlierStatement && prefix === "static-class-field" ? [member] : [],
      forEachChild(node, visit) {
        if (node === statement) {
          if (sameStatement) visit(earlierDeclaration);
          visit(declaration);
        } else if (node === earlierStatement) visit(earlierDeclaration);
      },
      is: { IsExpressionStatement: node => node === earlierStatement && prefix === "expression" },
      as: { AsExpressionStatement: node => node === earlierStatement ? { Expression: expression } : undefined },
    },
    sourceFiles: [sourceFile],
    source: { navigation: { moduleDependencies: () => [] } },
    records: createRustRecordFixture({
      moduleBinding: { get: node => bindings.get(node) },
      moduleCallableStorage: { get: node => node === earlierDeclaration ? { kind: "stored" } : undefined },
      compileTimeSource: { get: node => erased && node === declaration },
    }),
    projectTypes: { memberSlotName: () => undefined },
    safetyApplications: { operationForExpression: () => undefined },
  }, { forDeclaration: node => node === earlierStatement && prefix === "class-environment"
    ? { environment: { evaluatedConstructorValue: true, staticFields: [] } } : undefined },
  { outputType: "lib", projectRoot: "/src", entryPoint: "index.ts" }, Object.freeze([]));
  return { requirement: plan.requirementFor(sourceFile), declaration, name, bindings, plan };
}

for (const kind of ["KindObjectBindingPattern", "KindArrayBindingPattern"]) {
  for (const prefix of ["none", "module-cell", "stored-callable", "class-environment", "static-class-field", "expression", "export"]) {
    for (const prefixFirst of prefix === "none" ? [true] : [true, false]) {
      test(`module admission refuses ${kind} ${prefixFirst ? "after" : "before"} ${prefix} initialization`, () => {
        const selected = modulePatternPlan(kind, { prefix, prefixFirst });
        assert.equal(selected.requirement.kind, "unresolved", "a present binding fact does not prove module-pattern storage");
        assert.equal(selected.requirement.node === selected.declaration, true, "the exact invalid root evidence owns the refusal");
        assert.equal(selected.requirement.reason,
          "Top-level binding pattern requires its finalized ordered root and leaf module-binding evidence.",
          "the existing error owner receives the exact missing root-evidence reason");
        assert.equal(selected.bindings.has(selected.declaration), true, "the actual module-binding evidence remains present");
        assert.equal(selected.name.kind, kind, "classification does not replace the original checked pattern");
      });
    }
  }
  test(`module admission sees ${kind} after a required binding in the same statement`, () => {
    const selected = modulePatternPlan(kind, { prefix: "module-cell", sameStatement: true });
    assert.equal(selected.requirement.kind, "unresolved", "every declaration in the one statement is classified");
    assert.equal(selected.requirement.node === selected.declaration, true, "a prior required declaration cannot hide the later pattern");
  });
  for (const prefix of ["none", "expression"]) {
    test(`module admission preserves erased ${kind} with ${prefix} initialization`, () => {
      const selected = modulePatternPlan(kind, { erased: true, prefix });
      assert.equal(selected.requirement.kind, prefix === "none" ? "not-required" : "required", "existing compile-time erasure precedes the storage requirement");
      assert.equal(selected.plan.minimumFoundation(), prefix === "none" ? "core" : "std", "ordinary runtime work keeps its foundation");
    });
  }
}

for (const prefix of ["none", "module-cell", "stored-callable", "class-environment", "static-class-field", "expression", "export"]) {
  test(`module admission preserves a plain identifier with ${prefix} initialization`, () => {
    const selected = modulePatternPlan("KindIdentifier", { prefix });
    assert.equal(selected.requirement.kind, "required", "ordinary selected module cells remain supported");
    assert.equal(selected.plan.minimumFoundation(), "std", "the required module foundation is unchanged");
  });
}
