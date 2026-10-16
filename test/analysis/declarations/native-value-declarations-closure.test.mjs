import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { admitRustNativeValueDeclaration } from "../../../dist/analysis/declarations/native-value-declarations.js";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createRustNamePlan } from "../../../dist/analysis/names/plan.js";
import { rustProjectCallableTargetName } from "../../../dist/analysis/names/source-member-name.js";

function interfaceFixture(sourceText) {
  const { source, program } = analyzeRust({ files: { "index.ts": sourceText } });
  const declaration = source.ast.statements(source.getSourceFile("/src/index.ts"))
    .find(node => source.ast.kindName(node) === "KindInterfaceDeclaration");
  return { declaration, source, program, input: { ast: source.ast, records: program.records,
    names: program.names, projectTypes: program.projectTypes, typeDefinitions: program.typeDefinitions,
    sourceLifetimes: program.sourceLifetimes, objectRepresentations: program.objectRepresentations,
    enumMemberConstants: program.enumMemberConstants, typeFamilies: program.typeFamilies } };
}

test("a native record admits its exact closed field correspondence", () => {
  const fixture = interfaceFixture("export interface Entry { value: number; }");
  const result = admitRustNativeValueDeclaration(fixture.declaration, fixture.input);
  assert.equal(result.kind, "accepted", "closed record remains admitted");
  assert.equal(result.form.kind, "interface", "record form stays distinct");
  const field = result.form.fields[0];
  const selected = fixture.program.nativeDeclarations.get(fixture.declaration).fields[0];
  assert.equal(field.declaration === selected.declaration, true, "identical source field is retained");
  assert.equal(field.carrier === selected.carrier, true, "identical selected native carrier is retained");
  assert.equal(Object.isFrozen(result.form.fields) && Object.isFrozen(field), true, "field evidence is immutable");
});

test("record admission rejects missing physical field evidence at its sole owner", () => {
  const fixture = interfaceFixture("export interface Entry { value: number; }");
  const result = admitRustNativeValueDeclaration(fixture.declaration, { ...fixture.input,
    records: { ...fixture.input.records, runtimeCarrier: { get: () => undefined } } });
  assert.equal(result.kind, "rejected", "missing carrier is not silently omitted");
  assert.equal(result.diagnostics.length, 1, "one owner reports the missing field contract");
  assert.equal(result.diagnostics[0].code, "RUST_INTERFACE_FIELD_NOT_CLOSED", "field admission owns its failure");
  assert.equal(result.diagnostics[0].sourceNode === fixture.source.ast.members(fixture.declaration)[0], true,
    "diagnostic identifies the identical selected field");
});

test("index-backed record admission keeps exact native key and value carriers", () => {
  const fixture = interfaceFixture("export interface Entries { [key: string]: number; }");
  const result = admitRustNativeValueDeclaration(fixture.declaration, fixture.input);
  assert.equal(result.kind, "accepted", "closed index-backed record remains admitted");
  assert.equal(result.form.fields.length, 0, "no unrelated property storage is invented");
  assert.equal(result.form.index !== undefined, true, "selected index storage is present");
  assert.equal(result.form.index.declaration === fixture.source.ast.members(fixture.declaration)[0], true,
    "the exact checked index declaration owns its storage");
  assert.equal(Object.isFrozen(result.form.index), true, "selected index evidence is immutable");
});

test("computed member names consume the shared checked key and existing collision inventory", () => {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/project", compilerOptions: {
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
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics));
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/project/index.ts");
  const names = createRustNamePlan({ ast: source.ast, sourceFiles: [file],
    semanticsFor: source.semantics.forNode, runtimeValueUses: { hasFirstClassUse: () => false } });
  assert.equal(names.diagnostics.length, 0, "checked constant keys do not become authored identifier rejections");
  const declaration = source.ast.statements(file).find(node => source.ast.is.IsClassDeclaration(node));
  const members = source.ast.members(declaration);
  const [ordinary, instance, staticMethod, numeric, empty] = members;
  assert.equal(names.nameForDeclaration(ordinary), "some_key", "authored spelling reserves the direct native name");
  assert.equal(names.nameForDeclaration(instance), "some_key_2", "constant key uses the existing encoded-key collision rule");
  assert.equal(names.nameForDeclaration(numeric), "value_7", "numeric keys use the existing native property encoding");
  assert.equal(names.nameForDeclaration(empty), "value", "a static empty key is represented, not silently omitted");
  const context = { ast: source.ast, names, semanticsFor: source.semantics.forNode };
  assert.equal(rustProjectCallableTargetName(instance, context), "some_key_2", "instance method reads the selected name");
  assert.equal(rustProjectCallableTargetName(staticMethod, context), "some_key_2_static",
    "computed static methods retain the accepted static/instance collision rule");
});
