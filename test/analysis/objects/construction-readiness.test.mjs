import assert from "node:assert/strict";
import test from "node:test";
import { formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram, selectSourceNativeGuardResult } from "@tsonic/target-api/source";
import { checkedSource, namedDeclaration, projectSourceFile } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { minimalSourceGlobals } from "../../../../tsonic/test/fixtures/minimal-source-globals.mjs";
import { analyzeRustConstructionReadiness } from "../../../dist/analysis/project-types/construction-readiness.js";
import { analyzeRustNativeParticipation } from "../../../dist/analysis/callables/calls/participation.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { analyzeRust } from "../../helpers/rust-session.mjs";

test("published construction roots use their exact native representation and actual mutable uses", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
class Interior {
  value: number = 1;
  readonly owner: Interior = this;
  constructor() { this.bump(); }
  bump(): void { this.value++; }
}
class PlainRead {
  value: number = 1;
  constructor() { this.read(); }
  read(): number { return this.value; }
}
class PlainWrite {
  value: number = 1;
  constructor() { this.bump(); }
  bump(): void { this.value++; }
}
class PlainField {
  value: number = 1;
  constructor() { this.read(); this.value = 2; }
  read(): number { return this.value; }
}
class PlainSetter {
  value: number = 1;
  constructor() { this.next = 2; }
  set next(value: number) { this.value = value; }
}
export function run(): number {
  const interior = new Interior();
  const read = new PlainRead();
  const write = new PlainWrite();
  const field = new PlainField();
  const setter = new PlainSetter();
  return interior.value + read.value + write.value + field.value + setter.value;
}
` } });
  for (const [name, nativeValue, mutable] of [["Interior", false, false], ["PlainRead", true, false],
    ["PlainWrite", true, true], ["PlainField", true, true], ["PlainSetter", true, true]]) {
    const definition = program.projectTypes.definitions.find(definition => {
      const identifier = program.source.ast.name(definition.declaration);
      return identifier !== undefined && program.source.ast.text(identifier) === name;
    });
    assert.equal(definition !== undefined, true, name);
    assert.equal(program.objectRepresentations.representationFor(definition)?.kind === "value", nativeValue,
      `${name}: the actual native owner, not a wrapper-name guess, determines the representation`);
    const plan = program.records.classConstruction.get(definition.declaration);
    assert.equal(plan?.publishesReceiver, true, `${name}: the native root is genuinely published in its constructor`);
    assert.equal(plan.mutableReceiver, mutable, `${name}: only an actual mutable native binding use requires mut`);
    assert.equal(Object.hasOwn(plan, "mutatesPublishedFields"), false, `${name}: the superseded aggregate is not published`);
  }
});

async function readiness(name, statements) {
  const checked = await checkedSource(name, { "globals.d.ts": minimalSourceGlobals, "src/index.ts": `
export function fail(): void { throw 1; }
export class Value {
  value!: number;
  constructor(flag: boolean) { ${statements} }
  read(): number { return this.value; }
}
` });
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics.slice(0, 4)).slice(0, 2048));
  const source = createTargetSourceProgram(checked);
  const file = projectSourceFile(source, "src/index.ts");
  const declaration = namedDeclaration(source.ast, file, "Value");
  const failure = namedDeclaration(source.ast, file, "fail");
  const field = source.ast.members(declaration).find(node => source.ast.is.IsPropertyDeclaration(node));
  const constructor = source.ast.members(declaration).find(node => source.ast.is.IsConstructorDeclaration(node));
  const definition = { kind: "class", declaration };
  const fields = [{ declaration: field, absenceDefault: false, externallyInitialized: false }];
  const storage = createSourceStorageQuery(source, [file]);
  assert.equal(storage.failureReason() === undefined, true, "the actual checked constructor source domain is complete");
  const records = createRustProgramRecordBuilder();
  const participation = analyzeRustNativeParticipation({ ast: source.ast, storage, navigation: source.navigation,
    producer: records.nativeParticipations, requiredRecords: [] });
  assert.equal(participation.kind, "resolved", "the same native owner admits the constructor input domain");
  const nativeNodes = new Set(participation.nodes);
  return analyzeRustConstructionReadiness({ ast: source.ast, definition, fields,
    isNativeNode: node => nativeNodes.has(node),
    layers: [{ definition, constructor, fields, statements: source.ast.statements(source.ast.body(constructor)) }],
    selectedField(node) {
      const selected = source.semantics.forNode(node).operations.propertyAccess(node);
      return selected?.selectedDeclaration === field ? { declaration: field, accessMode: selected.accessMode } : undefined;
    },
    guardResult: node => selectSourceNativeGuardResult({ ast: source.ast, navigation: source.navigation,
      semanticsFor: node => source.semantics.forNode(node) }, node,
      () => undefined, () => undefined, () => undefined),
    unreachable: () => false,
    mayThrow: node => {
      const call = source.semantics.forNode(node).operations.call(node);
      return call !== undefined && source.semantics.forNode(node).declarations.signatureDeclaration(call.selectedSignature) === failure;
    },
  });
}

for (const [name, statements, mutable] of [
  ["first-store", "this.value = 3;", false],
  ["repeated-store", "this.value = 3; this.value = 4;", true],
  ["branch-store", "if (flag) this.value = 3; else this.value = 4;", false],
  ["branch-rewrite", "if (flag) this.value = 3; else this.value = 4; this.value = 5;", true],
  ["local-increment", "this.value = 3; this.value++;", true],
  ["published-store", "this.value = 3; this.read(); this.value = 4;", false],
]) test(`construction readiness retains exact field-local mutability: ${name}`, async () => {
  const result = await readiness(`construction-mutability-${name}`, statements);
  assert.equal(result.issues.length, 0, result.issues.map(row => row.reason).join("\n"));
  const fields = [...new Set(result.expressions.filter(entry => entry.kind === "field").map(entry => entry.declaration))];
  assert.equal(fields.length, 1);
  assert.equal(result.mutatesUnpublishedField(fields[0], undefined), mutable);
  assert.equal(result.mutatesUnpublishedField({}, undefined), false, "foreign field identities cannot acquire local writes");
});

for (const [name, statements] of [
  ["finally-return", "try { return; } finally { this.value = 7; }"],
  ["do-initialization", "do { this.value = 4; } while (false);"],
  ["labeled-cleanup", "outside: while (true) { try { break outside; } finally { this.value = 7; } }"],
  ["catch-after-write", "try { this.value = 3; fail(); } catch { this.read(); }"],
  ["case-expression-write", "switch (flag) { case (this.value = 7) === 7: break; default: break; }"],
  ["default-after-case-search", "switch (flag) { default: this.read(); break; case (this.value = 7) === 7: break; }"],
]) test(`construction readiness proves exact completion: ${name}`, async () => {
  const result = await readiness(`construction-${name}`, statements);
  assert.equal(result.issues.length, 0, result.issues.map(row => row.reason).join("\n"));
  assert.equal(result.completesNormally, true);
});

for (const [name, statements] of [
  ["skipped-incrementor", "for (; true; this.value = 5) { break; }"],
  ["zero-iteration", "while (false) { this.value = 5; }"],
  ["catch-before-write", "try { fail(); this.value = 3; } catch { this.read(); }"],
  ["early-incomplete-return", "if (flag) return; this.value = 3;"],
  ["matched-before-case-write", "switch (flag) { case true: break; case (this.value = 7) === 7: break; default: break; }"],
  ["fallthrough-skips-case-write", "switch (flag) { case true: default: this.read(); break; case (this.value = 7) === 7: break; }"],
]) test(`construction readiness rejects missing dominating storage: ${name}`, async () => {
  const result = await readiness(`construction-${name}`, statements);
  assert.equal(result.issues.length !== 0, true, "required storage or receiver readiness must be proven");
});

test("a labeled continue inside a switch is not mistaken for a constructor exit", async () => {
  const result = await readiness("construction-switch-continue", `
outside: for (;;) { switch (flag) { case true: continue outside; default: continue outside; } }
`);
  assert.equal(result.completesNormally, false);
  assert.equal(result.issues.length, 0);
});

for (const [name, statements, mutable] of [
  ["first-store", "this.value = 3;", false],
  ["repeated-store", "this.value = 3; this.value = 4;", true],
  ["branch-store", "if (flag) this.value = 3; else this.value = 4;", false],
  ["branch-rewrite", "if (flag) this.value = 3; else this.value = 4; this.value = 5;", true],
  ["local-increment", "this.value = 3; this.value++;", true],
  ["published-store", "this.value = 3; this.read(); this.value = 4;", false],
]) test(`construction emission seals the final native field-local mutability: ${name}`, () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export class Value {
  value!: number;
  constructor(flag: boolean) { ${statements} }
  read(): number { return this.value; }
}
` } });
  const ast = program.source.ast;
  const definition = program.projectTypes.definitions.find(entry => ast.text(ast.name(entry.declaration)) === "Value");
  assert.equal(definition !== undefined, true, `${name}: one checked class owner`);
  const construction = program.records.classConstruction.get(definition.declaration);
  assert.equal(construction !== undefined, true, `${name}: construction is admitted before sealing`);
  const fields = construction.fields.filter(field => ast.text(ast.name(field.declaration)) === "value");
  assert.equal(fields.length, 1, `${name}: one exact checked field identity`);
  assert.equal(construction.mutableFieldLocals.get(undefined).has(fields[0].declaration), mutable,
    `${name}: only native writes to the unpublished physical local demand mutability`);
  assert.equal(construction.mutableFieldLocals.get(undefined).has({}), false, `${name}: no foreign declaration acquires mutability`);
  assert.equal(Object.hasOwn(construction, "unpublishedMutations"), false, `${name}: the superseded raw mutation set is absent`);
  assert.equal(Object.hasOwn(construction, "unpublishedAccesses"), false, `${name}: the superseded raw access set is absent`);
});

for (const [label, field, rewrite, kind] of [
  ["immutable Copy capture", "readonly value = 1;", "", "copy"],
  ["immutable shared capture", 'readonly value = "initial";', "", "shared"],
  ["mutable Copy capture", "value = 1;", "this.value = 2;", "cell"],
  ["mutable non-Copy capture", 'value = "initial";', 'this.value = "updated";', "borrow-cell"],
]) test(`construction locals preserve their admitted captured storage: ${label}`, () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export class Value {
  ${field}
  readonly reader = () => this.value;
  constructor() { ${rewrite} }
}
` } });
  const ast = program.source.ast;
  const definition = program.projectTypes.definitions.find(entry => ast.text(ast.name(entry.declaration)) === "Value");
  assert.equal(definition !== undefined, true, `${label}: the checked owner is retained`);
  const construction = program.records.classConstruction.get(definition.declaration);
  assert.equal(construction !== undefined, true, `${label}: construction is admitted`);
  const declaration = construction.fields.find(entry => ast.text(ast.name(entry.declaration)) === "value")?.declaration;
  assert.equal(declaration !== undefined, true, `${label}: one exact authored captured field`);
  assert.equal(program.records.capturedFieldStorage.get(declaration)?.storage.kind, kind,
    `${label}: native capture representation is selected independently of local syntax`);
  assert.equal(construction.mutableFieldLocals.get(undefined).has(declaration), false,
    `${label}: unchanged native bindings and interior mutation need no mutable owner binding`);
});

for (const [label, base, middle, leaf, expected] of [
  ["base write ends before two rebindings", "this.value = 2;", "", "", [true, false, false, false]],
  ["middle write belongs only to the middle binding", "", "this.value = 3;", "", [false, true, false, false]],
  ["leaf write belongs only to the last binding", "", "", "this.value = 4;", [false, false, true, false]],
]) test(`constructor field mutability follows actual native binding intervals: ${label}`, () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export class Base { value = 1; constructor() { ${base} } }
export class Middle extends Base { constructor() { super(); ${middle} } }
export class Leaf extends Middle { constructor() { super(); ${leaf} } }
` } });
  const ast = program.source.ast;
  const definitions = ["Base", "Middle", "Leaf"].map(name => program.projectTypes.definitions.find(
    definition => ast.text(ast.name(definition.declaration)) === name));
  assert.equal(definitions.every(definition => definition !== undefined), true, "all actual checked construction layers exist");
  const construction = program.records.classConstruction.get(definitions[2].declaration);
  assert.equal(construction !== undefined, true, "the complete derived construction is admitted before publication");
  const field = construction.fields.find(field => ast.text(ast.name(field.declaration)) === "value");
  assert.equal(field !== undefined, true, "one canonical physical field is retained across the entire lineage");
  assert.equal(construction.localFieldDeclarations.has(field.declaration), true,
    "the native owner selects declaration at initialization and the actual subsequent rebindings");
  for (const [index, start] of [undefined, ...definitions].entries()) {
    const mutable = construction.mutableFieldLocals.get(start);
    assert.equal(mutable !== undefined, true, `binding ${index}: the canonical shape requires an explicit interval disposition`);
    assert.equal(mutable.has(field.declaration), expected[index],
      `binding ${index}: neither a previous nor a later native binding contributes writes to this local`);
  }
});

test("an early-return constructor keeps one outer binding mutable across its actual layer interval", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export class Base { value = 1; constructor(flag: boolean) { if (flag) return; this.value = 2; } }
export class Child extends Base { constructor(flag: boolean) { super(flag); this.value = 3; } }
` } });
  const ast = program.source.ast;
  const definition = program.projectTypes.definitions.find(definition => ast.text(ast.name(definition.declaration)) === "Child");
  assert.equal(definition !== undefined, true, "the checked derived owner exists");
  const construction = program.records.classConstruction.get(definition.declaration);
  assert.equal(construction !== undefined, true, "the early-completion lineage is admitted");
  const field = construction.fields.find(field => ast.text(ast.name(field.declaration)) === "value");
  assert.equal(field !== undefined, true, "the exact shared field identity is retained");
  assert.equal(construction.localFieldDeclarations.has(field.declaration), false,
    "early layer completion requires the existing outer declaration, not a fictitious rebind");
  assert.equal(construction.mutableFieldLocals.get(undefined).has(field.declaration), true,
    "all real writes to the one outer binding still require native mutability");
});
