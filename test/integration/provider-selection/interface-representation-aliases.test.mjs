import assert from "node:assert/strict";
import test from "node:test";
import { interfaceRepresentationAliasSource } from "../../../../tsonic/test/fixtures/interface-representation-aliases.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [undefined, ["js"]]) {
  test(`empty interface facades retain their native array contract in ${surfaces?.[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "interface_aliases" } },
      files: { "index.ts": `${interfaceRepresentationAliasSource}
export function main(): void {
  if (!run()) throw new Error("interface representation alias");
  ${surfaces === undefined ? "" : `
  const tokens: MoreTokens = [{}, {}];
  if (tokens.length !== 2) throw new Error("array facade length");
  const originalTokens = [{}, {}];
  const tokenAlias: MoreTokens = originalTokens;
  const replacement = {};
  originalTokens[0] = replacement;
  if (tokenAlias[0] !== replacement) throw new Error("identity facade live alias");
  Object.freeze(replacement);
  if (!Object.isFrozen(tokenAlias[0])) throw new Error("identity facade frozen alias");
  const original = [2, 3];
  const alias: Values<number> = original;
  original[0] = 7;
  if (sum(alias) !== 10) throw new Error("array facade live alias");`}
}` },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject("interface-representation-aliases", result.artifacts, { run: true }).status, 0);
  });
}

test("interface facade analysis never erases added or merged members", () => {
  for (const declaration of [
    "interface Tagged extends ReadonlyArray<number> { tag: string; }",
    "interface Tagged extends ReadonlyArray<number> {} interface Tagged { tag: string; }",
  ]) {
    const { result } = compileRust({ files: { "index.ts": `${declaration}
export function tag(value: Tagged): string { return value.tag; }` } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_PROJECT_HERITAGE_TARGET_UNSUPPORTED"));
    assert.equal(result.artifacts.length, 0);
  }
});

test("recursive interface facades cannot leave erased declarations in native type arguments", () => {
  for (const declaration of [
    "interface Recursive extends ReadonlyArray<Recursive> {}",
    "interface Recursive extends ReadonlyArray<Other> {} interface Other extends ReadonlyArray<Recursive> {}",
  ]) {
    const { result } = compileRust({ files: { "index.ts": `${declaration}
export function identity(value: Recursive): Recursive { return value; }` } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_INTERFACE_REPRESENTATION_CYCLE"));
    assert.equal(result.artifacts.length, 0);
  }
});
