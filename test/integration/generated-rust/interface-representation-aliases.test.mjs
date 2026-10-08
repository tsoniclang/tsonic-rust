import assert from "node:assert/strict";
import test from "node:test";
import { interfaceRepresentationAliasFiles, interfaceRepresentationAliasNativeValueFiles, interfaceRepresentationAliasJsProofSource, interfaceRepresentationAliasSource } from "../../../../tsonic/test/fixtures/interface-representation-aliases.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [undefined, ["js"]]) {
  test(`empty interface facades retain their native array contract in ${surfaces?.[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "interface_aliases" } },
      files: { "index.ts": `${interfaceRepresentationAliasSource}
${surfaces === undefined ? "" : interfaceRepresentationAliasJsProofSource}
export function main(): void {
  if (!run()) throw new Error("interface representation alias");
  ${surfaces === undefined ? "" : 'if (!runJsAliases()) throw new Error("array facade live and frozen alias");'}
}` },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject("interface-representation-aliases", result.artifacts, { run: true }).status, 0);
  });

  test(`cross-file generic array facades retain nested ${surfaces === undefined ? "native value storage" : "shared backing"}`, { timeout: 300_000 }, () => {
    const files = surfaces === undefined ? interfaceRepresentationAliasNativeValueFiles : interfaceRepresentationAliasFiles;
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "cross_file_facades" } },
      files: { ...files, "index.ts": `${files["index.ts"]}
export function main(): void { if (!run()) throw new Error("cross-file facade backing"); }` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.code).join(", "));
    validateGeneratedProject("cross-file-interface-facades", result.artifacts, { run: true });
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
