import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { rustClosureCaptureFactKey } from "../../../dist/analysis/facts/operations/keys.js";
import { rustCapturedFieldStorageFactKey } from "../../../dist/analysis/facts/receiver-captures.js";
import { fixedFieldSelfSource } from "../../helpers/fixed-field-self.mjs";

function recursiveFields(program) {
  const fields = [];
  const visit = node => {
    if (program.source.ast.is.IsPropertyDeclaration(node)) {
      const initializer = program.source.ast.as.AsPropertyDeclaration(node)?.Initializer;
      if (initializer !== undefined && program.source.ast.is.IsArrowFunction(initializer)) fields.push({ declaration: node, initializer });
    }
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return fields;
}

function authoredArrows(program) {
  const arrows = [];
  const visit = node => {
    if (program.source.ast.is.IsArrowFunction(node)) arrows.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return arrows;
}

for (const surfaces of [[], ["js"]]) for (const [name, source] of [
  ["readonly escaped", fixedFieldSelfSource],
  ["closed nonreadonly", fixedFieldSelfSource.replace("readonly recurse", "recurse")],
  ["exact computed field", fixedFieldSelfSource.replace("this.recurse(count - 1)", 'this["recurse"](count - 1)')],
  ["closed nominal alias", `
    class Value { readonly recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1); }
    export function escaped(): (count: number) => number { const value = new Value(); const alias = value; return alias.recurse; }
  `],
  ["owned primitive result", `
    class Value { readonly recurse = (count: number): string => count === 0 ? "done" : this.recurse(count - 1); }
    export function escaped(): (count: number) => string { return new Value().recurse; }
  `],
]) test(`fixed field self closes ${name} in ${surfaces[0] ?? "native"}`, () => {
  const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
  const fields = recursiveFields(program);
  assert.equal(fields.length, 1, "one authored callback field");
  const { declaration, initializer } = fields[0];
  const captures = program.objectRepresentations.receiverCaptures;
  const selected = captures.fixedSelfFor(initializer);
  const fact = program.facts.getFact(initializer, rustClosureCaptureFactKey);
  assert.equal(selected !== undefined, true, "the exact source owner relation is proven");
  assert.equal(selected.declaration === declaration, true);
  assert.equal(fact?.recursiveDeclaration === declaration, true);
  assert.equal(fact?.recursiveField?.declaration === declaration, true);
  assert.equal(fact?.receiverFields.length, 0, "self is not retained as a separate physical owner");
  assert.equal(captures.capturesFor(initializer).length, 0);
  assert.equal(captures.isCaptured(declaration), false, "the removed edge does not demand a field box");
  assert.equal(program.facts.getFact(declaration, rustCapturedFieldStorageFactKey) === undefined, true);
  assert.equal(selected.references.length > 0, true);
  for (const reference of selected.references) assert.equal(captures.fixedSelfForReference(reference) === selected, true);
});

for (const [name, source] of [
  ["live replacement", `
    class Value { recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1); }
    export function run(): number { const value = new Value(); const before = value.recurse; value.recurse = (): number => 99; return before(2); }
  `],
  ["readonly constructor replacement", `
    class Value {
      readonly recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
      constructor() { this.recurse = (): number => 99; }
    }
    export function escaped(): (count: number) => number { return new Value().recurse; }
  `],
  ["exported native owner", fixedFieldSelfSource.replace("class Value", "export class Value")],
  ["exported owner factory", fixedFieldSelfSource + "\nexport function owner(): Value { return new Value(); }"],
  ["public owner type relationship", fixedFieldSelfSource + "\nexport type PublicValue = Value;"],
  ["inferred public type query", `
    class Value { readonly recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1); }
    export function reader() { const value = new Value(); return (input: typeof value): number => input.recurse(1); }
  `],
  ["whole owner argument", fixedFieldSelfSource + `
    function read(value: Value): number { return value.recurse(2); }
    export function argument(): number { return read(new Value()); }
  `],
  ["field argument boundary", `
    class Value { readonly recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1); }
    function receive(value: (count: number) => number): (count: number) => number { return value; }
    export function escaped(): (count: number) => number { return receive(new Value().recurse); }
  `],
  ["source receiver rebinding", `
    class Value { readonly recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1); }
    export function escaped(): (count: number) => number { let value = new Value(); value = new Value(); return value.recurse; }
  `],
  ["mutable structural alias", `
    class Value { recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1); }
    export function run(): number {
      const value = new Value(); const before = value.recurse;
      const view: { recurse: (count: number) => number } = value;
      view.recurse = (): number => 99;
      return before(2);
    }
  `],
  ["inherited override", `
    class Value { readonly recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1); }
    class Child extends Value { override readonly recurse = (count: number): number => count + 99; }
    export function escaped(): (count: number) => number { return new Child().recurse; }
  `],
  ["noninitializer origin", `
    function identity(value: (count: number) => number): (count: number) => number { return value; }
    class Value { readonly recurse = identity((count: number): number => count === 0 ? 1 : this.recurse(count - 1)); }
    export function escaped(): (count: number) => number { return new Value().recurse; }
  `],
  ["mutual fields", `
    class Value {
      readonly even = (count: number): boolean => count === 0 ? true : this.odd(count - 1);
      readonly odd = (count: number): boolean => count === 0 ? false : this.even(count - 1);
    }
    export function escaped(): (count: number) => boolean { return new Value().even; }
  `],
  ["nested retained self", `
    class Value {
      readonly recurse = (count: number): number => { const next = (): number => this.recurse(count - 1); return count === 0 ? 1 : next(); };
    }
    export function escaped(): (count: number) => number { return new Value().recurse; }
  `],
  ["effectful exact computed key", `
    let keys = 0;
    class Value { readonly recurse = (count: number): number => count === 0 ? 1 : this[(keys += 1, "recurse")](count - 1); }
    export function escaped(): (count: number) => number { return new Value().recurse; }
  `],
  ["another retained field", `
    class Value {
      readonly prefix = "done";
      readonly recurse = (count: number): string => count === 0 ? this.prefix : this.recurse(count - 1);
    }
    export function escaped(): (count: number) => string { return new Value().recurse; }
  `],
  ["generic enclosing owner", `
    class Value<T> { readonly recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1); }
    export function escaped(): (count: number) => number { return new Value<number>().recurse; }
  `],
]) test(`unproved ${name} retains its existing owner relation`, () => {
  const { program } = analyzeRust({ files: { "index.ts": source } });
  const arrows = authoredArrows(program);
  assert.equal(arrows.some(initializer => program.objectRepresentations.receiverCaptures.capturesFor(initializer).length > 0), true,
    "the negative exercises an actual retained field edge, not an unrelated empty closure");
  for (const initializer of arrows) {
    assert.equal(program.objectRepresentations.receiverCaptures.fixedSelfFor(initializer) === undefined, true,
      "the bounded proof must not admit an open or different owner relation");
    assert.equal(program.facts.getFact(initializer, rustClosureCaptureFactKey)?.recursiveField === undefined, true);
  }
});

test("removing one self edge preserves an independent callback's exact field-storage demand", () => {
  const source = `
    class Value {
      readonly recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
      readonly reader = (count: number): number => this.recurse(count);
    }
    export function escaped(): (count: number) => number { return new Value().recurse; }
  `;
  const { program } = analyzeRust({ files: { "index.ts": source } });
  const fields = recursiveFields(program);
  assert.equal(fields.length, 2);
  const selected = fields.find(field => program.objectRepresentations.receiverCaptures.fixedSelfFor(field.initializer) !== undefined);
  assert.equal(selected !== undefined, true, "one exact own-field relation is selected");
  const retained = fields.find(field => field !== selected);
  const captures = program.objectRepresentations.receiverCaptures;
  assert.equal(captures.capturesFor(selected.initializer).length, 0);
  assert.equal(captures.capturesFor(retained.initializer).length, 1, "the other callback keeps its actual field owner");
  assert.equal(captures.capturesFor(retained.initializer)[0].declaration === selected.declaration, true);
  assert.equal(captures.isCaptured(selected.declaration), true, "physical demand is recomputed across all remaining environments");
  assert.equal(program.facts.getFact(selected.declaration, rustCapturedFieldStorageFactKey) !== undefined, true);
  const { result } = compileRust({ files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0, "the demanded deferred slot remains constructible");
  const emitted = rustSourceText(result);
  assert.equal(emitted.includes("::recursive("), true);
  assert.equal(emitted.includes("captured_field"), true, "only the independent field edge keeps its owner");
});

for (const surfaces of [[], ["js"]]) test(`fixed field self eliminates only its deferred ownership slot in ${surfaces[0] ?? "native"}`, () => {
  const { result } = compileRust({ surfaces, files: { "index.ts": fixedFieldSelfSource } });
  assert.equal(result.diagnostics.length, 0, "exact fixed field source emits successfully");
  const emitted = rustSourceText(result);
  assert.equal(emitted.includes("::recursive("), true, "the existing native callable constructor is reused");
  assert.equal(/captured_field|OnceCell|RefCell|Location::uninitialized/u.test(emitted), false,
    "no retained field slot, mutable cell or construction envelope survives the removed edge");
});
