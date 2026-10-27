import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { analyzeRustNativeParticipation } from "../../../dist/analysis/callables/calls/participation.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustNamePlan } from "../../../dist/analysis/names/plan.js";
import { rustProjectCallableTargetName } from "../../../dist/analysis/names/source-member-name.js";
import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/index.js";
import * as backendNames from "../../../dist/backend/planner/names/synthetic.js";

function declarationNamed(source, name) {
  const file = source.getSourceFile("/src/index.ts");
  return source.ast.statements(file).find(node => source.ast.text(source.ast.name(node)) === name);
}

function nativeMembership(source, file) {
  const storage = createSourceStorageQuery(source, [file]);
  const builder = createRustProgramRecordBuilder();
  const selected = analyzeRustNativeParticipation({ ast: source.ast, storage,
    navigation: source.navigation, producer: builder.nativeParticipations, requiredRecords: [] });
  assert.equal(selected.kind, "resolved", "the checked name fixture has its complete canonical native domain");
  const nativeNodes = new Set(selected.nodes);
  return node => nativeNodes.has(node);
}

test("enum native representation and variants are selected before publication", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
export enum Ordinary { firstValue = 1, secondValue = 2 }
export enum Aliased { firstValue = 1, secondValue = 1 }
` } });
  const ordinaryNode = declarationNamed(source, "Ordinary");
  const aliasNode = declarationNamed(source, "Aliased");
  const ordinary = program.records.nativeDeclaration.get(ordinaryNode);
  const aliased = program.records.nativeDeclaration.get(aliasNode);
  assert.equal(ordinary?.kind, "enum", "ordinary enum is admitted");
  assert.equal(ordinary.representation, "enum", "distinct constants select native enum syntax");
  assert.equal(aliased?.kind, "enum", "duplicate enum is admitted");
  assert.equal(aliased.representation, "constants", "duplicate constants select the existing native wrapper");
  assert.deepEqual(ordinary.variants.map(variant => [variant.name, variant.discriminant]),
    [["firstValue", "1"], ["secondValue", "2"]], "authored spelling and checked values are preserved");
  assert.equal(program.records.nativeDeclaration.get(ordinaryNode) === ordinary, true, "reader returns the identical sealed form");
  assert.equal(Object.isFrozen(ordinary) && Object.isFrozen(ordinary.variants), true, "admitted declaration data is immutable");
  assert.equal(Object.isFrozen(program.records.nativeDeclaration), true, "published declaration reader is frozen");
  assert.equal(Object.hasOwn(program, "enumMemberConstants"), false,
    "the superseded backend constant-reader route is not published alongside declaration admission");
});

test("unsupported enum constant domains reject before backend planning", () => {
  for (const [label, source] of [
    ["string", 'export enum Unsupported { member = "text" }'],
    ["fractional", "export enum Unsupported { member = 1.5 }"],
  ]) {
    let published = false;
    const { result } = compileRust({ files: { "index.ts": source }, compileTarget(request) {
      const analysis = analyzeRustAnalysisProgram(request);
      if (analysis.kind === "resolved") published = true;
      return analysis.kind === "rejected" ? analysis
        : { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
    } });
    assert.equal(published, false, `${label}: no rejected declaration reaches publication`);
    assert.equal(result.diagnostics.length, 1, `${label}: exactly one owning diagnostic`);
    assert.equal(result.diagnostics[0].code, "RUST_ENUM_CONSTANT_NOT_SUPPORTED", `${label}: analysis owns constant admission`);
    assert.equal(result.artifacts?.length ?? 0, 0, `${label}: no target artifact is emitted`);
  }
});

test("enum admission keeps keyword escaping and the existing duplicate wrapper output", () => {
  const { result } = compileRust({ files: { "index.ts": `
export enum type { match = 4, otherValue = 4 }
` } });
  assert.equal(result.diagnostics.length, 0, "valid keyword enum remains admitted");
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub struct r#type/, "the authored enum name is escaped, not renamed");
  assert.match(text, /pub const r#match: Self/, "the authored variant name is escaped, not renamed");
  assert.match(text, /pub const otherValue: Self/, "authored variant casing is preserved");
  assert.match(text, /value: 4/, "duplicate discriminant value is unchanged");
});

test("ordinary record interfaces and erased aliases publish their distinct admitted forms", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
export interface Entry { firstValue: number; "some-key": string; }
export type Amount = number;
` } });
  const entry = program.records.nativeDeclaration.get(declarationNamed(source, "Entry"));
  const amount = program.records.nativeDeclaration.get(declarationNamed(source, "Amount"));
  assert.equal(entry?.kind, "interface", "record interface has a native admission");
  assert.deepEqual(entry.fields.map(field => [field.sourceName, field.targetName, field.storageIndex]),
    [["firstValue", "firstValue", 0], ["some-key", "some_key", 1]], "exact selected field storage is retained");
  assert.equal(amount?.kind, "alias", "erased alias has its own admission");
  assert.equal(amount.fact.kind, "erased", "existing zero-runtime alias behavior is preserved");
});

test("polymorphic inherited interfaces retain their existing dedicated route", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
export interface Named { read(): number; }
export interface Derived extends Named { write(value: number): void; }
` } });
  for (const name of ["Named", "Derived"]) {
    const declaration = declarationNamed(source, name);
    const definition = program.projectTypes.definitionForDeclaration(declaration);
    assert.equal(program.projectTypes.isPolymorphic(definition), true, `${name}: existing polymorphic selection`);
    assert.equal(program.records.nativeDeclaration.get(declaration) === undefined, true,
      `${name}: ordinary record admission never rejects or supplants the polymorphic owner`);
  }
});

test("literal and runtime unions retain their selected native alias forms", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
export type State = "ready" | "done";
export type Value = { value: number } | { next: Value };
` } });
  const state = program.records.nativeDeclaration.get(declarationNamed(source, "State"));
  const value = program.records.nativeDeclaration.get(declarationNamed(source, "Value"));
  assert.equal(state?.kind, "alias", "string-literal union remains an alias admission");
  assert.equal(state.fact.kind, "string-literal", "existing literal-union representation is preserved");
  assert.equal(value?.kind, "alias", "runtime union remains an alias admission");
  assert.equal(value.fact.kind, "runtime", "existing runtime-union representation is preserved");
  assert.equal(value.payloadTemplate !== undefined, true, "runtime union carries its physical payload correspondence");
  assert.equal(value.payloadTemplate.variants.length, value.fact.variants.length,
    "every native variant has its selected payload");
});

test("source-output identities are published once with the analyzed program", () => {
  const { program } = analyzeRust({ files: {
    "index.ts": 'export { value } from "./nested/value.js";',
    "nested/value.ts": "export const value = 1;",
  } });
  const identity = program.sourceOutputIdentities.get("/src/nested/value.ts");
  assert.equal(identity !== undefined, true, "an emitted module has its admitted identity");
  assert.equal(identity.moduleName, "nested::value", "complete native module identity is retained");
  assert.deepEqual(identity.moduleSegments, ["nested", "value"], "the source identity retains its exact native module segments");
  assert.equal(program.sourceOutputIdentities.get("/src/nested/value.ts") === identity, true,
    "consumers receive the identical selected identity without running a selector");
  assert.equal(Object.isFrozen(identity) && Object.isFrozen(identity.moduleSegments), true,
    "published identity and path data are immutable");
  assert.equal(Object.hasOwn(backendNames, "planRustSourceOutputIdentities"), false,
    "the superseded backend source-identity selector is removed, not retained as an alias");
});

test("computed member names consume the shared checked key and existing collision inventory", () => {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/project", compilerOptions: {
    strict: true, target: "es2022", module: "esnext",
  }, files: { "/project/index.ts": `
const key = "some-key" as const;
const staticKey = "some-key-static" as const;
class Entry {
  some_key = 3;
  [key](): number { return 1; }
  static [staticKey](): number { return 2; }
  [7] = 4;
  [""] = 5;
}
` } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics));
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/project/index.ts");
  const names = createRustNamePlan({ ast: source.ast, sourceFiles: [file],
    isNativeNode: nativeMembership(source, file),
    semanticsFor: source.semantics.forNode, runtimeValueUses: { hasFirstClassUse: () => false } });
  assert.equal(names.diagnostics.length, 0, "checked constant keys do not become authored identifier rejections: " +
    names.diagnostics.map(issue => issue.message).join("\n"));
  const declaration = source.ast.statements(file).find(node => source.ast.is.IsClassDeclaration(node));
  const members = source.ast.members(declaration);
  const [ordinary, instance, staticMethod, numeric, empty] = members;
  assert.equal(names.nameForDeclaration(ordinary), "some_key", "authored spelling reserves the direct native name");
  assert.equal(names.nameForDeclaration(instance), "some_key_2", "constant key uses the existing encoded-key collision rule");
  assert.equal(names.nameForDeclaration(numeric), "value_7", "numeric keys use the existing native property encoding");
  assert.equal(names.nameForDeclaration(empty), "value", "a static empty key is represented, not silently omitted");
  const context = { ast: source.ast, names, semanticsFor: source.semantics.forNode };
  assert.equal(rustProjectCallableTargetName(instance, context), "some_key_2", "instance method reads the selected name");
  assert.equal(rustProjectCallableTargetName(staticMethod, context), "some_key_static",
    "computed static methods preserve their own checked source key without an invented native suffix");
  const conflicting = createCompilerSessionFromFiles({ currentDirectory: "/project", compilerOptions: {
    strict: true, target: "es2022", module: "esnext",
  }, files: { "/project/index.ts": `
const key = "some-key" as const;
class Entry {
  some_key = 3;
  [key](): number { return 1; }
  static [key](): number { return 2; }
  [7] = 4;
  [""] = 5;
}
` } }).checkSource();
  assert.equal(conflicting.diagnostics.length, 0, formatDiagnostics(conflicting.diagnostics));
  const conflictingSource = createTargetSourceProgram(conflicting);
  const conflictingFile = conflicting.getSourceFile("/project/index.ts");
  const rejected = createRustNamePlan({ ast: conflictingSource.ast, sourceFiles: [conflictingFile],
    isNativeNode: nativeMembership(conflictingSource, conflictingFile),
    semanticsFor: conflictingSource.semantics.forNode, runtimeValueUses: { hasFirstClassUse: () => false } });
  assert.equal(rejected.diagnostics.length, 1, "the original static/instance collision has one native admission refusal");
  assert.equal(rejected.diagnostics[0].code, "RUST_AUTHORED_IDENTIFIER_UNREPRESENTABLE");
  assert.match(rejected.diagnostics[0].message, /same Rust inherent item name \(E0592\)/u,
    "checked source permission cannot invent two equally named native inherent items");
});

test("ordinary numeric member names retain the shared source-token key without float64 rounding", () => {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/project", compilerOptions: {
    strict: true, target: "es2022", module: "esnext",
  }, files: { "/project/index.ts": `
class Entry {
  9007199254740994(): number { return 1; }
  1e2(): number { return 2; }
}
` } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics));
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/project/index.ts");
  const names = createRustNamePlan({ ast: source.ast, sourceFiles: [file],
    isNativeNode: nativeMembership(source, file),
    semanticsFor: source.semantics.forNode, runtimeValueUses: { hasFirstClassUse: () => false } });
  assert.equal(names.diagnostics.length, 0, "native numeric property keys do not become authored identifier failures");
  const declaration = source.ast.statements(file).find(node => source.ast.is.IsClassDeclaration(node));
  const [exact, exponent] = source.ast.members(declaration);
  const context = { ast: source.ast, names, semanticsFor: source.semantics.forNode };
  assert.equal(names.nameForDeclaration(exact), "value_9007199254740994", "the native key retains every authored integer digit");
  assert.equal(rustProjectCallableTargetName(exact, context), "value_9007199254740994", "the callable consumer uses the same selected native key");
  assert.equal(names.nameForDeclaration(exponent), "value_100", "exponent spelling is normalized by the shared owner");
  assert.equal(rustProjectCallableTargetName(exponent, context), "value_100", "numeric callable names consume the canonical key");
});

test("a checker-incoherent numeric named member receives one precise shared-key refusal", () => {
  const { result } = compileRust({ files: { "index.ts": `
export class Entry {
  9007199254740993(): number { return 1; }
}
` } });
  assert.equal(result.diagnostics.length, 1, "one declared numeric name has one owning refusal");
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.code, "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN", "the canonical shared-key consumer owns admission");
  assert.match(diagnostic.message, /9007199254740993/u, "the exact authored spelling remains in the diagnostic");
  assert.match(diagnostic.message, /checker key 9007199254740992/u, "the checker-selected conflicting identity is explicit");
  assert.match(diagnostic.message, /string key "9007199254740993"/u, "the exact string-key alternative is preserved");
  assert.equal(result.artifacts?.length ?? 0, 0, "the conflicting named member cannot reach publication");
});

test("native declaration admission preserves base-accepted local and unreachable declarations", () => {
  for (const [label, body] of [
    ["local alias after return", "return 1; type Unused = number;"],
    ["local interface after return", "return 1; interface Unused { value: number; }"],
    ["constant-false local alias", "if (false) { type Unused = number; } return 1;"],
    ["constant-false local interface", "if (false) { interface Unused { value: number; } } return 1;"],
  ]) {
    const { result } = compileRust({ files: { "index.ts": `export function read(): number { ${body} }` } });
    assert.equal(result.diagnostics.length, 0, `${label}: ${result.diagnostics.map(issue => issue.code).join(",")}`);
    const text = artifactText(result, "src/index.rs");
    assert.match(text, /pub fn read\(/u, `${label}: the actually participating native function is retained`);
    assert.doesNotMatch(text, /(?:enum|struct|type) Unused\b/u, `${label}: no nonparticipating native declaration is emitted`);
  }
});

test("an unused nested function's enum imposes no native obligations", () => {
  const label = "enum in unused nested function";
  const body = 'function unused(): void { enum Unused { value = "text" } } return 1;';
  const { result } = compileRust({ files: { "index.ts": `export function read(): number { ${body} }` } });
  assert.equal(result.diagnostics.length, 0, `${label}: ${result.diagnostics.map(issue => issue.code).join(",")}`);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn read\(/u, `${label}: the actually participating native function is retained`);
  assert.doesNotMatch(text, /(?:enum|struct|type) Unused\b/u, `${label}: no nonparticipating native declaration is emitted`);
});

test("sealed family implementations have completed contracts and missing contracts are internal invariants", async () => {
  const { compoundTypeFamilyOwnerFiles } = await import("../../fixtures/compound-type-family-owners.mjs");
  const { analyzeRustNativeDeclarationForms } = await import("../../../dist/analysis/declarations/native-forms.js");
  const { source, program } = analyzeRust({ files: compoundTypeFamilyOwnerFiles, packages: [acmeTestingPackage()] });
  assert.equal(program.typeFamilies.implementations.length > 0, true, "the checked fixture registers actual native family implementations");
  for (const implementation of program.typeFamilies.implementations) {
    const contract = program.declarationGenericRequirements.contractForCarrier({ kind: "tuple",
      elements: [implementation.owner, implementation.output] });
    assert.equal(contract !== undefined, true, "every implementation is covered by the completed generic-requirement closure");
  }
  assert.equal(program.nativeDeclarations.implementations.length, program.typeFamilies.implementations.length,
    "admission covers the complete finally sealed implementation domain in its existing order");
  assert.throws(() => analyzeRustNativeDeclarationForms({ ast: source.ast, sourceFiles: program.sourceFiles,
    semanticsFor: createTargetSourceProgram(source).semantics.forNode,
    records: program.records, names: program.names, projectTypes: program.projectTypes,
    typeDefinitions: program.typeDefinitions, sourceLifetimes: program.sourceLifetimes,
    objectRepresentations: program.objectRepresentations,
    typeFamilies: program.typeFamilies,
    structuralShapes: program.structuralShapes,
    genericRequirements: { ...program.declarationGenericRequirements, contractForCarrier: () => undefined },
  }), error => error instanceof Error && error.message.includes(
    "A sealed type-family implementation has no completed native generic requirement contract."),
  "a broken completed internal contract cannot become a user source rejection");
});
