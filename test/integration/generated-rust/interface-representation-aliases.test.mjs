import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { interfaceRepresentationAliasFiles, interfaceRepresentationAliasNativeValueFiles, interfaceRepresentationAliasJsProofSource, interfaceRepresentationAliasSource } from "../../../../tsonic/test/fixtures/interface-representation-aliases.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

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

for (const surfaces of [[], ["js"]]) {
  test(`facade producer storage matches handwritten native allocation costs in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const js = surfaces.length !== 0;
    const crateName = `facade_cost_${js ? "js" : "native"}`;
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "lib", crateName } },
      files: { "index.ts": `
interface Tokens extends ReadonlyArray<object> {}
function same(values: Tokens, token: object): boolean {
  let count = 0;
  for (const value of values) { if (value !== token) return false; count += 1; }
  return count === 2;
}
export function run(): boolean {
  const token = {};
  const tokens = [token, token];
  return same(tokens, token);
}
` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.code).join(", "));
    const output = artifactText(result, "src/index.rs");
    assert.match(output, js ? /let tokens: js_abi::JsArray<js_abi::JsValue>/u : /let tokens: Vec<rt::TsValue>/u);
    assert.doesNotMatch(output, /\.collect\(|array_from_vec|array_from_dense_array|transmute/u,
      "the producer constructs one backing store rather than rebuilding or casting an existing array");
    const root = writeGeneratedProject("facade-producer-cost", result.artifacts);
    mkdirSync(join(root, "tests"), { recursive: true });
    const carrier = js ? "js_abi::JsValue" : "rt::TsValue";
    const storage = js ? "js_abi::JsArray::from_dense(values)" : "values";
    writeFileSync(join(root, "tests/ownership.rs"), nativeOwnershipCostSupport + `
use ${crateName}::index;
use tsonic_rust_runtime as rt;
${js ? "use tsonic_rust_js::abi as js_abi;" : ""}

fn handwritten() -> bool {
    let token = rt::EmptyObject::new();
    let values = vec![${carrier}::from(token.clone()), ${carrier}::from(token.clone())];
    let tokens = ${storage};
    let token = ${carrier}::from(token);
    let mut count = 0;
    for value in tokens.${js ? "iter_values()" : "iter()"} {
        if value != ${js ? "token" : "&token"} { return false; }
        count += 1;
    }
    count == 2
}

#[test]
fn facade_storage_has_one_native_backing_without_conversion_allocations() {
    assert!(index::run());
    assert!(handwritten());
    for _iteration in 0..100 {
        let actual = measure(index::run);
        let expected = measure(handwritten);
        assert_eq!(actual, expected);
        assert!(actual.0);
        assert_eq!(actual.1.reallocations, 0);
    }
}
`);
    runCargo(root, ["generate-lockfile", "--offline"]);
    runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "ownership"]);
  });
}
