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
  return program.objectRepresentations.receiverCaptures.capturesFor(callable);
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
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(read.declaration), true);
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(read.declaration, read.reference), false);
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(change.declaration, change.reference), true);
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(increment.declaration, increment.reference), true);
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(child.declaration), false);
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(child.declaration, child.reference), false);
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
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(selected.declaration), false);
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
  const output = artifactText(result, "src/index.rs");
  assert.equal(typeof output === "string" && output.length !== 0, true, "actual generated Rust source");
  assert.equal(/ObjectIdentity::new|with_context_and_identity/u.test(output), false, name);
});

for (const { name, declarations, invocation } of retainedFieldFreezeOrigins)
  test(`admitted ${name} freeze retains the exact data-store identity`, () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
${retainedFieldFreezeValueSource}
${declarations}
export function main(): void { const value = new Value(); ${invocation} }
` } });
  const reader = captures(program, "Value", "read")[0];
  const writer = captures(program, "Value", "change")[0];
  assert.equal(reader !== undefined && writer !== undefined, true, name);
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(writer.declaration, writer.reference), true, name);
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(reader.declaration, reader.reference), false, name);
});

test("generic and inherited class storage retains writer demand without taxing the reader", () => {
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
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(writer.declaration, writer.reference), true);
  assert.equal(program.frozenDataWrites.capturesFieldIdentity(reader.declaration, reader.reference), false);
});
