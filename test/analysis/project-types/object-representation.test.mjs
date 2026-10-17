import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

for (const [surface, surfaces] of [["native", []], ["js", ["js"]]]) {
  for (const [label, source] of [
    ["authored returns and inputs", `
interface Holder { value: number; }
export function make(value: number): Holder { return { value }; }
export function read(value: Holder): number { return value.value; }
`],
    ["closed calls and immutable aliases", `
interface Holder { value: number; }
function make(value: number): Holder { return { value }; }
function read(value: Holder): number { return value.value; }
export function result(): number { const first = make(7); const alias = first; return read(alias) + read(first); }
`],
  ]) {
    test(`an immutable native object crosses ${label} without inventing a shared owner (${surface})`, () => {
      const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
      const representation = program.objectRepresentations.representations.find(value => value.definition.sourceName === "Holder");
      assert.equal(representation !== undefined, true, "the exact checked interface has a native representation");
      assert.equal(representation.kind, "value", "a return, parameter or exported native signature is not evidence of shared storage");
      assert.equal(representation.mutable, false, "every actual source owner and field use is read-only");
      assert.equal(representation.identityObserved, false, "no observed object identity is erased");
    });
  }

  for (const [label, body] of [
    ["local alias mutation", `
  const original: Holder = { value: 1 };
  const alias = original;
  alias.value = 9;
  return original.value;
`],
    ["cross-call alias mutation", `
  const original: Holder = { value: 1 };
  const alias = original;
  write(alias);
  return original.value;
`],
    ["structural-view alias mutation", `
  const original: Holder = { value: 1 };
  const alias: { value: number } = original;
  writeView(alias);
  return original.value;
`],
  ]) {
    test(`native representation retains the original owner through ${label} (${surface})`, () => {
      const { program } = analyzeRust({ surfaces, files: { "index.ts": `
interface Holder { value: number; }
function write(value: Holder): void { value.value = 9; }
function writeView(value: { value: number }): void { value.value = 9; }
export function result(): number { ${body} }
` } });
      const representation = program.objectRepresentations.representations.find(value => value.definition.sourceName === "Holder");
      assert.equal(representation !== undefined, true, "the source origin keeps its exact nominal representation owner");
      assert.equal(representation.mutable, true, "writes through every actual alias reach the original source owner");
      assert.equal(representation.kind, "shared-mutable", "a copied inline value cannot replace observable aliased mutation");
    });
  }

  test(`observed native object identity remains distinct from an immutable value (${surface})`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
interface Holder { readonly value: number; }
export function same(): boolean {
  const original: Holder = { value: 7 };
  const alias = original;
  return original === alias;
}
` } });
    const representation = program.objectRepresentations.representations.find(value => value.definition.sourceName === "Holder");
    assert.equal(representation !== undefined && representation.identityObserved, true, "the actual identity comparison is recorded");
    assert.equal(representation.kind !== "value", true, "structural equality is never substituted for source identity");
  });

  test(`a mutable native input remains shared when external callers can alias it (${surface})`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
interface Holder { value: number; }
export function write(value: Holder): number { value.value += 1; return value.value; }
` } });
    const representation = program.objectRepresentations.representations.find(value => value.definition.sourceName === "Holder");
    assert.equal(representation !== undefined && representation.mutable, true, "actual input mutation is preserved without a local construction");
    assert.equal(representation.kind, "shared-mutable", "an open externally aliased mutable input is not guessed owned inline storage");
  });
}
