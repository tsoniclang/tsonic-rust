import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { isRustUnitCarrier, rustCallableTargetType } from "../../../../dist/target-model/types/index.js";
import { checkRustAmbientVariableUse } from "../../../../dist/analysis/declarations/type-only.js";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { createTargetSourceProgram } from "@tsonic/target-api/source";

const integer = { kind: "source-primitive", name: "int32" };
const text = { kind: "target-named", id: "rust.std.String" };
const families = [
  ["typeOnlyDeclaration", "typeOnlyDeclarations"],
  ["moduleBinding", "moduleBindings"],
  ["moduleCallableStorage", "moduleCallableStoragePlans"],
  ["sourceCallableReturn", "sourceCallableReturns"],
  ["capturedFieldStorage", "capturedFieldStoragePlans"],
];

test("all five declaration and callable families expose one immutable reader and no general writer", () => {
  const builder = createRustProgramRecordBuilder();
  const sealed = builder.seal([]);
  for (const [family, producer] of families) {
    assert.equal(builder[producer].records === builder[family], true, family);
    assert.equal(builder[family] === sealed[family], true, family);
    assert.equal(Object.isFrozen(sealed[family]), true, family);
    assert.deepEqual(Object.keys(sealed[family]), ["get"], family);
    assert.equal(sealed[family].get(undefined) === undefined, true, family);
    assert.equal(sealed[family].get({}) === undefined, true, family);
    assert.equal(builder[family].set === undefined, true, family);
    assert.equal(sealed[producer] === undefined, true, family);
  }
  const subject = {};
  const value = { name: "step", carrier: rustCallableTargetType([], integer), parameterCarriers: [], resultCarrier: integer };
  for (const attempt of [
    () => builder.typeOnlyDeclarations.finalize({}, []),
    () => builder.typeOnlyDeclarations.representationAliases({}, []),
    () => builder.moduleBindings.value({}, subject, "const", integer),
    () => builder.moduleBindings.function(subject, "step", value),
    () => builder.moduleBindings.callable(subject, subject, "step", undefined),
    () => builder.moduleBindings.defaultExport(subject, integer),
    () => builder.moduleCallableStoragePlans.finalize({}),
    () => builder.sourceCallableReturns.resolve({}, subject),
    () => builder.sourceCallableReturns.setter(subject),
    () => builder.capturedFieldStoragePlans.resolve({}, subject, integer),
  ]) assert.throws(attempt, /after analysis is sealed/u);
});

test("module value admission uses the existing declaration classifier and exact source inputs", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const selected = { storage: "module-cell", declarationKind: "let", initialization: "declaration", valueCarrier: text };
  let calls = 0;
  const walk = { context: { requiredRecords: [] }, moduleBindings: { classifyValue(declaration, kind, carrier) {
    assert.equal(declaration === subject, true);
    assert.equal(kind, "let");
    assert.equal(carrier === text, true);
    calls++;
    return selected;
  } } };
  builder.moduleBindings.value(walk, subject, "let", text);
  assert.equal(calls, 1);
  assert.equal(builder.moduleBinding.get(subject) === selected, true, "the selected physical storage remains exact");
  assert.equal(builder.minimumFoundation(), "core", "this family adds no competing carrier accounting");
  const absent = {};
  builder.moduleBindings.value({ context: { requiredRecords: [] }, moduleBindings: { classifyValue: () => undefined } }, absent, "const", integer);
  assert.equal(builder.moduleBinding.get(absent) === undefined, true);
});

test("module callable and default constructors retain the complete native ABI and declaration identities", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const implementation = {};
  const callable = { name: "step_value", carrier: rustCallableTargetType([integer], text), parameterCarriers: [integer], resultCarrier: text };
  builder.moduleBindings.function(declaration, "step", callable);
  const hoisted = builder.moduleBinding.get(declaration);
  assert.equal(hoisted.declarationKind, "function");
  assert.equal(hoisted.storage, "native-callable");
  assert.equal(hoisted.callableDeclaration === declaration, true);
  assert.equal(hoisted.value === callable, true);
  builder.moduleBindings.callable(implementation, declaration, "step", callable);
  assert.equal(builder.moduleBinding.get(implementation).callableDeclaration === declaration, true);
  assert.equal(builder.moduleBinding.get(implementation).declarationKind, "const");
  const unobserved = {};
  builder.moduleBindings.callable(unobserved, implementation, "native_step", undefined);
  assert.equal(Object.hasOwn(builder.moduleBinding.get(unobserved), "value"), false);
  const exported = {};
  builder.moduleBindings.defaultExport(exported, integer);
  assert.equal(builder.moduleBinding.get(exported).storage, "module-cell");
  assert.equal(builder.moduleBinding.get(exported).initialization, "value");
  assert.equal(builder.moduleBinding.get(exported).valueCarrier === integer, true);
});

test("module callable inherited equality compares every physical ABI member without publishing over its parent", () => {
  const parent = createRustProgramRecordBuilder();
  const subject = {};
  const value = { name: "value", carrier: rustCallableTargetType([integer], text), parameterCarriers: [integer], resultCarrier: text };
  parent.moduleBindings.function(subject, "implementation", value);
  const original = parent.moduleBinding.get(subject);
  const sealed = parent.seal([]);
  const child = createRustProgramRecordBuilder(undefined, sealed);
  child.moduleBindings.function(subject, "implementation", { ...value, parameterCarriers: [{ ...integer }] });
  assert.equal(child.moduleBinding.get(subject) === original, true);
  const conflicts = [
    candidate => candidate.moduleBindings.function(subject, "other", value),
    candidate => candidate.moduleBindings.callable(subject, {}, "implementation", value),
    ...[{ ...value, name: "other" }, { ...value, carrier: text }, { ...value, parameterCarriers: [] },
      { ...value, parameterCarriers: [text] }, { ...value, resultCarrier: integer }].map(changed =>
      candidate => candidate.moduleBindings.function(subject, "implementation", changed)),
    candidate => candidate.moduleBindings.defaultExport(subject, integer),
  ];
  for (const write of conflicts) {
    assertRustInheritedRecordConflict("moduleBinding", subject, original, write, /Conflicting Rust semantic plan 'tsonic\.rust\.moduleBinding'/u);
    assert.equal(child.moduleBinding.get(subject) === original, true);
  }
  const fresh = {};
  child.moduleBindings.defaultExport(fresh, integer);
  assert.equal(sealed.moduleBinding.get(fresh) === undefined, true);
});

test("module value conflicts retain const/cell kind, initialization and exact integer width", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const original = { declarationKind: "let", storage: "module-cell", initialization: "declaration", valueCarrier: integer };
  const admit = value => builder.moduleBindings.value({ context: { requiredRecords: [] }, moduleBindings: { classifyValue: () => value } }, subject, "let", integer);
  admit(original);
  admit({ ...original, valueCarrier: { ...integer } });
  for (const changed of [{ ...original, declarationKind: "var" }, { ...original, initialization: "value" },
    { ...original, valueCarrier: { kind: "source-primitive", name: "int64" } },
    { declarationKind: "const", storage: "native-const", valueCarrier: integer }]) {
    assert.throws(() => admit(changed), /Conflicting Rust semantic plan/u);
    assert.equal(builder.moduleBinding.get(subject) === original, true);
  }
});

test("complete return queries reuse inherited facts and setters preserve native unit results", () => {
  const parent = createRustProgramRecordBuilder();
  const declaration = {};
  assert.equal(parent.sourceCallableReturns.inferred === undefined, true, "the incomplete constructor is removed");
  parent.sourceCallableReturns.setter(declaration);
  const original = parent.sourceCallableReturn.get(declaration);
  const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
  const noSelection = new Proxy({}, { get() { throw new Error("the complete inherited query must be a lookup"); } });
  assert.equal(child.sourceCallableReturns.resolve(noSelection, declaration), true);
  child.sourceCallableReturns.setter(declaration);
  assert.equal(child.sourceCallableReturn.get(declaration) === original, true);
  const setter = {};
  child.sourceCallableReturns.setter(setter);
  assert.equal(isRustUnitCarrier(child.sourceCallableReturn.get(setter).returnCarrier), true);
  assert.deepEqual(child.sourceCallableReturn.get(setter).returnCarrier, { kind: "tuple", elements: [] });
  assert.equal(parent.sourceCallableReturn.get(setter) === undefined, true);
  child.seal([]);
  assert.equal(child.sourceCallableReturns.inferred === undefined, true);
});

test("missing suspension evidence rejects through the actual source-return producer before source inspection", () => {
  for (const [label, asynchronous, generator] of [["async", true, false], ["generator", false, true], ["async-generator", true, true]]) {
    const builder = createRustProgramRecordBuilder();
    const declaration = {};
    const walk = { context: { requiredRecords: [], records: builder, ast: { hasModifierKind: () => asynchronous },
      semanticsFor: () => ({ operations: { generator: () => generator ? {} : undefined } }) } };
    assert.equal(walk.context.records.sourceCallableReturns.resolve(walk, declaration), false, label);
    assert.equal(builder.sourceCallableReturn.get(declaration) === undefined, true, label);
  }
});

function capturedField(builder, { carrier = integer, captured = true, readonly = false, deferred = false, immutable = false } = {}) {
  const declaration = {};
  const captures = { isCaptured: () => captured, storageDeclaration: () => declaration,
    storageReadonly: () => readonly, isDeferred: () => deferred, storageImmutable: () => immutable };
  const walk = { context: { requiredRecords: [], records: builder, objectRepresentations: { receiverCaptures: captures } } };
  return { declaration, walk, resolve: () => builder.capturedFieldStoragePlans.resolve(walk, declaration, carrier) };
}

for (const [name, input, kind, initialization] of [
  ["immutable scalar", { readonly: true, immutable: true }, "copy", "ready"],
  ["mutable scalar", {}, "cell", "ready"],
  ["immutable owned value", { carrier: text, readonly: true, immutable: true }, "shared", "ready"],
  ["mutable owned value", { carrier: text }, "borrow-cell", "ready"],
  ["deferred immutable scalar", { readonly: true, immutable: true, deferred: true }, "shared", "deferred"],
]) test(`captured field producer preserves the native ${name} representation`, () => {
  const builder = createRustProgramRecordBuilder();
  const selected = capturedField(builder, input);
  selected.resolve();
  const fact = builder.capturedFieldStorage.get(selected.declaration);
  assert.equal(fact.valueCarrier === (input.carrier ?? integer), true);
  assert.equal(fact.storage.kind, kind);
  assert.equal(fact.storage.initialization, initialization);
  assert.equal(Object.isFrozen(fact.storage), true);
  assert.equal(builder.minimumFoundation(), "core", "native storage selection does not double-account its carrier");
  selected.resolve();
  assert.equal(builder.capturedFieldStorage.get(selected.declaration) === fact, true);
  const noSelection = new Proxy({}, { get() { throw new Error("captured storage was already selected"); } });
  builder.capturedFieldStoragePlans.resolve({ context: { requiredRecords: [], objectRepresentations: noSelection } },
    selected.declaration, { ...fact.valueCarrier });
  assert.equal(builder.capturedFieldStorage.get(selected.declaration) === fact, true, "same complete native field query is a lookup");
  builder.seal(selected.walk.context.requiredRecords);
  assert.throws(selected.resolve, /after analysis is sealed/u);
});

test("uncaptured fields do not manufacture storage and inherited captures keep their exact carrier and identity", () => {
  const parent = createRustProgramRecordBuilder();
  const absent = capturedField(parent, { captured: false });
  absent.resolve();
  assert.equal(parent.capturedFieldStorage.get(absent.declaration) === undefined, true);
  const selected = capturedField(parent);
  selected.resolve();
  const fact = parent.capturedFieldStorage.get(selected.declaration);
  const child = createRustProgramRecordBuilder(undefined, parent.seal(selected.walk.context.requiredRecords));
  child.capturedFieldStoragePlans.resolve(selected.walk, selected.declaration, { ...integer });
  assert.equal(child.capturedFieldStorage.get(selected.declaration) === fact, true);
  assert.throws(() => child.capturedFieldStoragePlans.resolve(selected.walk, selected.declaration, text), /Conflicting Rust semantic plan/u);
  assert.equal(child.capturedFieldStorage.get(selected.declaration) === fact, true);
});

test("an unavailable captured-field query stays retryable until its receiver evidence is complete", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = capturedField(builder, { captured: false });
  selected.resolve();
  assert.equal(builder.capturedFieldStorage.get(selected.declaration) === undefined, true);
  selected.walk.context.objectRepresentations.receiverCaptures.isCaptured = () => true;
  selected.resolve();
  assert.equal(builder.capturedFieldStorage.get(selected.declaration) !== undefined, true,
    "an earlier unavailable query must not be cached as completed");
});

function ambientFixture(builder, { malformed = false, runtime = false, nativeReference = true, defaultLibrary = false } = {}) {
  const file = { kind: "KindSourceFile" };
  const statement = { kind: "KindVariableStatement", parent: file };
  const declaration = { kind: "KindVariableDeclaration", parent: statement };
  const list = { kind: "KindVariableDeclarationList", Declarations: { Nodes: malformed ? [undefined] : [declaration] } };
  const reference = { kind: "KindIdentifier", parent: file };
  const events = [];
  const ast = { statements: () => [statement], parent: node => node.parent, kindName: node => node?.kind,
    getSourceFile: () => file,
    hasModifierKind: () => true, is: { IsVariableStatement: node => node === statement,
      IsVariableDeclaration: node => node === declaration, IsVariableDeclarationList: node => node === list, IsSourceFile: node => node === file },
    as: { AsVariableStatement: () => ({ DeclarationList: list }), AsVariableDeclarationList: () => list } };
  const walk = { context: { requiredRecords: [], ast, records: builder, diagnostics: [], typeFamilies: { families: () => [] },
    isNativeNode: node => nativeReference && node === reference,
    source: { semantics: { forNode(subject) {
      assert.equal(subject === reference, true, "the demanded checked occurrence selects its source semantics");
      return { declarations: { isDefaultLibraryDeclaration(subjectDeclaration) {
        assert.equal(subjectDeclaration === declaration, true, "library ownership belongs to the exact checked declaration");
        return defaultLibrary;
      } } };
    } }, sourceFacts: { getFact: () => undefined }, navigation: { declarationUses(subject) {
      assert.equal(subject === declaration, true);
      events.push(builder.typeOnlyDeclaration.get(statement)?.reason);
      assert.equal(builder.typeOnlyDeclaration.get(declaration) === undefined, true, "use diagnostics precede declaration admission");
      return runtime ? [{ kind: "first-class", reference }] : [{ kind: "type-only", reference }];
    } } } }, operationOptions: { providerExports: [] }, rejectedExpressions: new WeakSet(), resolving: new Set() };
  return { file, statement, declaration, reference, walk, events, list };
}

test("ambient finalization preserves statement admission, then diagnostics, then declaration admission", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = ambientFixture(builder, { runtime: true });
  builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]);
  assert.deepEqual(selected.events, ["ambient"]);
  assert.equal(builder.typeOnlyDeclaration.get(selected.declaration).reason, "ambient");
  const diagnostics = selected.walk.context.diagnostics;
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING");
  assert.equal(diagnostics[0].sourceNode === selected.reference, true);
  assert.equal(selected.walk.rejectedExpressions.has(selected.reference), true);
  builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]);
  assert.deepEqual(selected.events, ["ambient"], "a complete ambient query does not recheck uses");
  assert.equal(diagnostics.length, 1, "the original diagnostic is not duplicated");
});

test("source-ready ambient statement admission precedes native binding work without reading unfinished families", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = ambientFixture(builder, { runtime: true });
  const families = selected.walk.context.typeFamilies;
  selected.walk.context.typeFamilies = { families: () => assert.fail("ambient source admission needs no native family realization") };
  const statement = builder.typeOnlyDeclarations.statement(selected.walk, selected.statement);
  assert.equal(statement?.reason, "ambient", "the one source-ready producer admits the exact statement");
  assert.equal(builder.typeOnlyDeclaration.get(selected.statement) === statement, true, "the published reader sees the same statement fact");
  assert.equal(builder.typeOnlyDeclaration.get(selected.declaration)?.reason, "ambient", "its exact declaration is source-only before storage");
  assert.equal(selected.events.length, 1, "the existing runtime-use check runs once at the source boundary");
  assert.equal(selected.walk.context.diagnostics.length, 1, "the actual runtime-use refusal remains precise");
  assert.equal(selected.walk.context.diagnostics[0].code, "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING", "source-only storage is not a native runtime implementation");
  assert.equal(builder.typeOnlyDeclarations.statement(selected.walk, selected.statement) === statement, true,
    "a repeated native-body request reads the same completed fact");
  selected.walk.context.typeFamilies = families;
  builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]);
  assert.equal(builder.typeOnlyDeclaration.get(selected.statement) === statement, true,
    "late conditional/interface finalization does not replace the source-ready fact");
  assert.equal(selected.events.length, 1, "late finalization never repeats the ambient source-use decision");
  assert.equal(selected.walk.context.diagnostics.length, 1, "late family readiness never duplicates the original diagnostic");
});

test("ambient use validation reads the same exact native reference admission before requiring an implementation", () => {
  for (const nativeReference of [false, true]) {
    const builder = createRustProgramRecordBuilder();
    const selected = ambientFixture(builder, { runtime: true, nativeReference });
    builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]);
    assert.equal(selected.walk.context.diagnostics.length, nativeReference ? 1 : 0,
      "only the actual admitted native read has an implementation obligation");
    assert.equal(builder.typeOnlyDeclaration.get(selected.statement)?.reason, "ambient", "source statement metadata remains whole");
    assert.equal(builder.typeOnlyDeclaration.get(selected.declaration)?.reason, "ambient", "source declaration metadata remains whole");
    assert.equal(selected.events.length, 1, "the original source-use inventory is still visited exactly once");
    if (nativeReference) assert.equal(selected.walk.context.diagnostics[0].code, "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING",
      "the active native read retains the original precise diagnostic");
  }
});

test("one demanded ambient reference shares the native-use owner without revisiting a declaration inventory", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = ambientFixture(builder, { runtime: true });
  selected.walk.context.source.navigation.declarationUses = () => assert.fail("one exact source use never scans another declaration or use");
  const use = { kind: "first-class", role: "return", reference: selected.reference, throughMember: false, captured: false };
  checkRustAmbientVariableUse(selected.walk, selected.declaration, use);
  checkRustAmbientVariableUse(selected.walk, selected.declaration, use);
  assert.equal(selected.walk.context.diagnostics.length, 1, "repeated reads retain the one original implementation refusal");
  assert.equal(selected.walk.context.diagnostics[0].code, "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING");
  assert.equal(selected.walk.context.diagnostics[0].sourceNode === selected.reference, true, "the exact demanded occurrence owns the refusal");
  assert.equal(selected.walk.rejectedExpressions.has(selected.reference), true, "no later raw carrier is admitted for that refused value");
  assert.equal(builder.typeOnlyDeclaration.get(selected.statement) === undefined &&
    builder.typeOnlyDeclaration.get(selected.declaration) === undefined, true, "a checked dependency read does not invent emitted statement or declaration facts");
});

test("default-library values retain their native operation owner rather than authored ambient admission", () => {
  for (const defaultLibrary of [false, true]) {
    const selected = ambientFixture(createRustProgramRecordBuilder(), { runtime: true, defaultLibrary });
    if (defaultLibrary) selected.walk.context.source.sourceFacts.getFact = () =>
      assert.fail("default-library values remain with their existing native operation admission");
    checkRustAmbientVariableUse(selected.walk, selected.declaration,
      { kind: "first-class", role: "value", reference: selected.reference, throughMember: false, captured: false });
    assert.equal(selected.walk.context.diagnostics.length, defaultLibrary ? 0 : 1,
      "only actual authored ambient variables require an external native implementation");
    assert.equal(selected.walk.rejectedExpressions.has(selected.reference), !defaultLibrary,
      "library ownership never rejects an otherwise admitted checked value");
  }
});

test("the exact ambient-use owner preserves type-only, linkage, erased-member and dormant references", () => {
  for (const kind of ["type-only", "source-linkage", "first-class"]) {
    for (const nativeReference of [false, true]) {
      const selected = ambientFixture(createRustProgramRecordBuilder(), { nativeReference });
      if (kind === "first-class" && nativeReference) selected.reference.parent = { kind: "KindPropertySignature", parent: selected.file };
      selected.walk.context.source.sourceFacts.getFact = () => assert.fail("erased source uses never request a provider or native implementation");
      checkRustAmbientVariableUse(selected.walk, selected.declaration,
        { kind, role: kind === "first-class" ? "value" : kind, reference: selected.reference, throughMember: false, captured: false });
      assert.equal(selected.walk.context.diagnostics.length, 0, `${kind}/${nativeReference}: no native value obligation`);
      assert.equal(selected.walk.rejectedExpressions.has(selected.reference), false, `${kind}/${nativeReference}: the unrelated source remains admitted`);
    }
  }
});

for (const surfaces of [[], ["js"]]) {
  for (const authored of ["export declare const external: number;", "export const external: number;"]) {
    for (const demand of ["runtime", "type-only", "dormant"]) {
      test(`checked dependency variable keeps exact ${demand} implementation admission in ${surfaces[0] ?? "native"}: ${authored}`, () => {
        const body = demand === "runtime"
          ? 'import { external } from "./values.js"; export function read(): number { return external; }'
          : demand === "type-only"
            ? 'import type { external } from "./values.js"; export function read(value: typeof external): number { return value; }'
            : 'import { external } from "./values.js"; export function read(value: number): number { function hidden(): number { return external; } return value; }';
        const { source, result } = compileRust({ surfaces, files: { "index.ts": body, "values.d.ts": authored } });
        if (demand === "runtime") {
          assert.deepEqual(result.diagnostics.map(issue => issue.code), ["RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING"],
            "the unimplemented dependency is refused once before physical source binding or planning");
          const ast = createTargetSourceProgram(source).ast;
          const issue = result.diagnostics[0];
          assert.equal(issue.sourceNode !== undefined && ast.text(issue.sourceNode) === "external" &&
            ast.getFileName(ast.getSourceFile(issue.sourceNode)).endsWith("/index.ts"), true,
          "the precise diagnostic belongs to the original demanded checked occurrence, not the declaration file");
          assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
            "no unsupported native value is materialized or published");
        } else {
          assert.deepEqual(result.diagnostics.map(issue => issue.code), [], "the same dependency adds no erased native obligation");
          assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
            "the actual remaining native program is still admitted");
        }
      });
    }
  }
  test(`a real project variable retains its actual implementation in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: {
      "index.ts": 'import { external } from "./values.js"; export function read(): number { return external; }',
      "values.ts": "export const external: number = 7;",
    } });
    assert.deepEqual(result.diagnostics.map(issue => issue.code), [], "a checked project value is not an unimplemented ambient reference");
    assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
      "the original project declaration and read retain native publication");
  });
  for (const demand of ["runtime", "type-only", "dormant"]) {
    test(`namespace dependency variable retains exact ${demand} implementation admission in ${surfaces[0] ?? "native"}`, () => {
      const body = demand === "runtime"
        ? 'import * as values from "./values.js"; export function read(): number { return values.external; }'
        : demand === "type-only"
          ? 'import type * as values from "./values.js"; export function read(value: typeof values.external): number { return value; }'
          : 'import * as values from "./values.js"; export function read(value: number): number { function hidden(): number { return values.external; } return value; }';
      const { result } = compileRust({ surfaces, files: { "index.ts": body, "values.d.ts": "export declare const external: number;" } });
      assert.deepEqual(result.diagnostics.map(issue => issue.code),
        demand === "runtime" ? ["RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING"] : [],
        "qualified declaration identity has the same native-use obligation, not a member-name or namespace heuristic");
      assert.equal(demand === "runtime"
        ? result.program === undefined && result.plan === undefined && result.artifacts.length === 0
        : result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
      "only the actual unimplemented runtime occurrence prevents publication");
    });
  }
  test(`canonical source absence stays independent of ambient variable storage in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: {
      "index.ts": "export function absent(): undefined { return undefined; } export function nil(): null { return null; }",
    } });
    assert.deepEqual(result.diagnostics.map(issue => issue.code), [], "source absence retains its existing native owner");
    assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
      "no authored variable or native distinction between null and undefined is fabricated");
  });
  test(`default-library Error constructors and guards keep native admission in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: {
      "index.ts": 'export function run(): boolean { const error = new Error("native"); return error instanceof Error && error.message === "native"; }',
    } });
    assert.deepEqual(result.diagnostics.map(issue => issue.code), [], "the exact library constructor is not an authored ambient variable");
    assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
      "native error construction and exact checked runtime classification remain published");
    const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(output, /rt::(?:Mutable)?JsError::error\("native"\)/u);
  });
}

test("an authored Error constructor lookalike retains its exact missing implementation refusal", () => {
  const { result } = compileRust({ files: {
    "index.ts": 'import { Error } from "./values.js"; export function run(): Error { return new Error("authored"); }',
    "values.d.ts": "export interface Error { message: string; } export declare const Error: { new(message: string): Error };",
  } });
  assert.equal(result.diagnostics.filter(issue => issue.code === "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING").length, 1,
    "a matching constructor spelling and shape never acquire default-library ownership");
  assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
    "no authored ambient constructor or error value is materialized");
});

test("actual SDK provider qualifiers retain native operation admission without an authored variable implementation", () => {
  const { result } = compileRust({ surfaces: ["js"], files: {
    "index.ts": "export function read(value: number): number { return Math.abs(value); }",
  } });
  assert.deepEqual(result.diagnostics.map(issue => issue.code), [], "the selected SDK provider, not an invented ambient binding, owns Math.abs");
  assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
    "the existing native provider operation stays available");
});

test("an authored provider-name lookalike does not acquire a native implementation", () => {
  const { result } = compileRust({ surfaces: ["js"], files: {
    "index.ts": 'import { Math } from "./values.js"; export function read(value: number): number { return Math.abs(value); }',
    "values.d.ts": "export declare const Math: { abs(value: number): number };",
  } });
  assert.equal(result.diagnostics.filter(issue => issue.code === "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING").length, 1,
    "actual checked provider identity is required; spelling and member shape are not proof");
  assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
    "no unsupported ambient object is published as an SDK provider");
});

test("malformed ambient declarations retain the original early statement admission and invariant refusal", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = ambientFixture(builder, { malformed: true });
  assert.throws(() => builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]),
    /Ambient declaration analysis received an incomplete checked declaration list/u);
  assert.equal(builder.typeOnlyDeclaration.get(selected.statement).reason, "ambient");
  assert.equal(builder.typeOnlyDeclaration.get(selected.declaration) === undefined, true);
  assert.equal(selected.walk.context.diagnostics.length, 0);
});

test("an incomplete ambient query retains its earlier statement fact and can finish without re-admission", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = ambientFixture(builder, { malformed: true });
  assert.throws(() => builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]),
    /Ambient declaration analysis received an incomplete checked declaration list/u);
  const statement = builder.typeOnlyDeclaration.get(selected.statement);
  selected.list.Declarations.Nodes = [selected.declaration];
  builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]);
  assert.equal(builder.typeOnlyDeclaration.get(selected.statement) === statement, true);
  assert.equal(builder.typeOnlyDeclaration.get(selected.declaration).reason, "ambient");
  assert.deepEqual(selected.events, ["ambient"]);
  builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]);
  assert.deepEqual(selected.events, ["ambient"], "only complete finalization is cached");
});
