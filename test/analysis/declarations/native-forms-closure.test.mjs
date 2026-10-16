import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/index.js";

function declarationNamed(source, name) {
  const file = source.getSourceFile("/src/index.ts");
  return source.ast.statements(file).find(node => source.ast.text(source.ast.name(node)) === name);
}

test("enum native representation and variants are selected before publication", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
export enum Ordinary { firstValue = 1, secondValue = 2 }
export enum Aliased { firstValue = 1, secondValue = 1 }
` } });
  const ordinaryNode = declarationNamed(source, "Ordinary");
  const aliasNode = declarationNamed(source, "Aliased");
  const ordinary = program.nativeDeclarations.get(ordinaryNode);
  const aliased = program.nativeDeclarations.get(aliasNode);
  assert.equal(ordinary?.kind, "enum", "ordinary enum is admitted");
  assert.equal(ordinary.representation, "enum", "distinct constants select native enum syntax");
  assert.equal(aliased?.kind, "enum", "duplicate enum is admitted");
  assert.equal(aliased.representation, "constants", "duplicate constants select the existing native wrapper");
  assert.deepEqual(ordinary.variants.map(variant => [variant.name, variant.discriminant]),
    [["firstValue", "1"], ["secondValue", "2"]], "authored spelling and checked values are preserved");
  assert.equal(program.nativeDeclarations.get(ordinaryNode) === ordinary, true, "reader returns the identical sealed form");
  assert.equal(Object.isFrozen(ordinary) && Object.isFrozen(ordinary.variants), true, "admitted declaration data is immutable");
  assert.equal(Object.isFrozen(program.nativeDeclarations), true, "published declaration reader is frozen");
});

test("unsupported enum constant domains reject before backend planning", () => {
  for (const [label, source] of [
    ["string", 'export enum Unsupported { member = "text" }'],
    ["fractional", "export enum Unsupported { member = 1.5 }"],
  ]) {
    let published = false;
    const { result } = compileRust({ files: { "index.ts": source }, compileTarget(request) {
      const analysis = analyzeRustTargetProgram(request);
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
  const entry = program.nativeDeclarations.get(declarationNamed(source, "Entry"));
  const amount = program.nativeDeclarations.get(declarationNamed(source, "Amount"));
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
    assert.equal(program.nativeDeclarations.get(declaration) === undefined, true,
      `${name}: ordinary record admission never rejects or supplants the polymorphic owner`);
  }
});

test("literal and runtime unions retain their selected native alias forms", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
export type State = "ready" | "done";
export type Value = number | string;
` } });
  const state = program.nativeDeclarations.get(declarationNamed(source, "State"));
  const value = program.nativeDeclarations.get(declarationNamed(source, "Value"));
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
  assert.equal(identity.artifactPath, "src/nested/value.rs", "the selected output path is retained");
  assert.equal(program.sourceOutputIdentities.get("/src/nested/value.ts") === identity, true,
    "consumers receive the identical selected identity without running a selector");
  assert.equal(Object.isFrozen(identity) && Object.isFrozen(identity.moduleSegments), true,
    "published identity and path data are immutable");
});
