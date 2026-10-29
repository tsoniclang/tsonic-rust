import assert from "node:assert/strict";
import test from "node:test";
import { Node_Initializer } from "@tsonic/target-api/source";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { retainedFieldFreezeOrigins, retainedFieldFreezeValueSource } from "../../../../tsonic/test/fixtures/retained-field-freeze-origins.mjs";

function captures(program, className, memberName) {
  const ast = program.source.ast;
  const definition = program.projectTypes.definitions.find(selected => selected.sourceName === className);
  assert.equal(definition !== undefined, true, `selected class ${className}`);
  const member = ast.members(definition.declaration).find(selected =>
    selected !== undefined && ast.text(ast.name(selected)) === memberName);
  assert.equal(member !== undefined, true, `selected member ${className}.${memberName}`);
  const callable = Node_Initializer(ast, member);
  assert.equal(callable !== undefined, true, `selected initializer ${className}.${memberName}`);
  const expected = program.objectRepresentations.receiverCaptures.capturesFor(callable);
  const selected = program.records.closureCapture.get(callable)?.receiverFields;
  assert.equal(selected !== undefined && selected.length === expected.length, true, "exact receiver-field inventory");
  for (const [index, source] of expected.entries()) {
    const capture = selected[index];
    assert.equal(capture.declaration === source.declaration, true, "the original field declaration");
    assert.equal(capture.receiver === source.receiver && capture.reference === source.reference, true, "the exact receiver occurrence");
    assert.equal(capture.references.length === source.references.length &&
      capture.references.every((reference, offset) => reference === source.references[offset]), true, "the complete ordered reference membership");
  }
  return expected;
}

test("sealed live-field demand distinguishes sibling read, write and child-store callbacks", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class Value {
  value = 1;
  child = { value: 1 };
  read = (): number => this.value;
  change = (next: number): void => { this.value = next; };
  increment = (): void => { this.value += 1; };
  childChange = (): void => { this.child.value = 2; };
}
export function main(): void { Object.freeze(new Value()); }
` } });
  const read = captures(program, "Value", "read")[0];
  const change = captures(program, "Value", "change")[0];
  const increment = captures(program, "Value", "increment")[0];
  const child = captures(program, "Value", "childChange")[0];
  assert.equal(read !== undefined && change !== undefined && increment !== undefined && child !== undefined, true);
  assert.equal(read.declaration === change.declaration && change.declaration === increment.declaration, true, "sibling callbacks retain their one field");
  assert.equal(child.declaration === read.declaration, false, "child storage remains distinct");
  assert.equal(program.frozenDataWrites === undefined, true, "no frozen-write service");
});

for (const [name, members, main, selectedMember] of [
  ["read-only-scalar", "value = 1; read = (): number => this.value;", "value.read();", "read"],
  ["readonly-field", "readonly value = 1; read = (): number => this.value;", "value.read();", "read"],
  ["child-content", "child = { value: 1 }; change = (): void => { this.child.value = 2; };", "value.change();", "change"],
]) test(`selected freeze does not create a premature outer identity for ${name}`, () => {
  const source = `class Value { ${members} }
export function main(): void { const value = new Value(); Object.freeze(value); ${main} }`;
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
  const selected = captures(program, "Value", selectedMember)[0];
  assert.equal(selected !== undefined, true, name);
  assert.equal(program.frozenDataWrites === undefined, true, "no freeze-induced capture demand");
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
  const output = artifactText(result, "src/index.rs");
  assert.equal(typeof output === "string" && output.length !== 0, true, "actual generated Rust source");
  assert.equal(/ObjectIdentity::new|with_context_and_identity/u.test(output), false, name);
});

for (const { name, declarations, invocation } of retainedFieldFreezeOrigins)
  test(`admitted ${name} freeze keeps exact native capture membership`, () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
${retainedFieldFreezeValueSource}
${declarations}
export function main(): void { const value = new Value(); ${invocation} }
` } });
  const reader = captures(program, "Value", "read")[0];
  const writer = captures(program, "Value", "change")[0];
  assert.equal(reader !== undefined && writer !== undefined, true, name);
  assert.equal(writer.declaration === reader.declaration, true, "reader and writer select the same native field");
  assert.equal(program.frozenDataWrites === undefined, true, "no runtime freeze identity transport");
});

test("generic and inherited class storage retains exact captures without frozen identity transport", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class Base<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  read = (): T => this.value;
  change = (next: T): void => { this.value = next; };
}
class Value extends Base<number> { constructor() { super(1); } }
function freeze<T>(value: { value: T }): void { Object.freeze(value); }
export function main(): void { const value = new Value(); freeze(value); }
` } });
  const reader = captures(program, "Base", "read")[0];
  const writer = captures(program, "Base", "change")[0];
  assert.equal(reader !== undefined && writer !== undefined, true);
  assert.equal(writer.declaration === reader.declaration, true, "the canonical inherited field");
  assert.equal(program.frozenDataWrites === undefined, true, "no freeze-induced outer identity");
});
