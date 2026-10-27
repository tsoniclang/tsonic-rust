import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { admitRustNativeInterfaceDeclaration } from "../../../dist/analysis/declarations/native-value-declarations.js";
import { createTargetSourceProgram } from "@tsonic/target-api/source";

function interfaceFixture(sourceText) {
  const { source, program } = analyzeRust({ files: { "index.ts": sourceText } });
  const declaration = source.ast.statements(source.getSourceFile("/src/index.ts"))
    .find(node => source.ast.kindName(node) === "KindInterfaceDeclaration");
  return { declaration, source, program, input: { ast: source.ast, records: program.records,
    semanticsFor: createTargetSourceProgram(source).semantics.forNode,
    names: program.names, projectTypes: program.projectTypes, typeDefinitions: program.typeDefinitions,
    sourceLifetimes: program.sourceLifetimes, objectRepresentations: program.objectRepresentations,
    typeFamilies: program.typeFamilies } };
}

test("a native record admits its exact closed field correspondence", () => {
  const fixture = interfaceFixture("export interface Entry { value: number; }");
  const result = admitRustNativeInterfaceDeclaration(fixture.declaration, fixture.input);
  assert.equal(result.kind, "accepted", "closed record remains admitted");
  assert.equal(result.form.kind, "interface", "record form stays distinct");
  const field = result.form.fields[0];
  const selected = fixture.program.records.nativeDeclaration.get(fixture.declaration).fields[0];
  assert.equal(field.declaration === selected.declaration, true, "identical source field is retained");
  assert.equal(field.carrier === selected.carrier, true, "identical selected native carrier is retained");
  assert.equal(Object.isFrozen(result.form.fields) && Object.isFrozen(field), true, "field evidence is immutable");
});

test("record admission rejects missing physical field evidence at its sole owner", () => {
  const fixture = interfaceFixture("export interface Entry { value: number; }");
  const result = admitRustNativeInterfaceDeclaration(fixture.declaration, { ...fixture.input,
    records: { ...fixture.input.records, runtimeCarrier: { get: () => undefined } } });
  assert.equal(result.kind, "rejected", "missing carrier is not silently omitted");
  assert.equal(result.diagnostics.length, 1, "one owner reports the missing field contract");
  assert.equal(result.diagnostics[0].code, "RUST_INTERFACE_FIELD_NOT_CLOSED", "field admission owns its failure");
  assert.equal(result.diagnostics[0].sourceNode === fixture.source.ast.members(fixture.declaration)[0], true,
    "diagnostic identifies the identical selected field");
});

test("index-backed record admission keeps exact native key and value carriers", () => {
  const fixture = interfaceFixture("export interface Entries { [key: string]: number; }");
  const result = admitRustNativeInterfaceDeclaration(fixture.declaration, fixture.input);
  assert.equal(result.kind, "accepted", "closed index-backed record remains admitted");
  assert.equal(result.form.fields.length, 0, "no unrelated property storage is invented");
  assert.equal(result.form.index !== undefined, true, "selected index storage is present");
  assert.equal(result.form.index.declaration === fixture.source.ast.members(fixture.declaration)[0], true,
    "the exact checked index declaration owns its storage");
  assert.equal(Object.isFrozen(result.form.index), true, "selected index evidence is immutable");
});
