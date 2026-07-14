import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustSourceProfileRegistry } from "../dist/source/rust-target-semantics/source-profile-registry.js";

function sourceFile(fileName) {
  return { fileName };
}

function declaration(source) {
  return { source };
}

const ast = {
  getFileName(source) {
    return source.fileName;
  },
  getSourceFile(node) {
    return node.source ?? node;
  },
};

test("source profile provenance is tied to one exact compiler source file", () => {
  const registry = createRustSourceProfileRegistry();
  const native = sourceFile("/project/.tsonic/source-profiles/rust-provider/rust-globals.d.ts");
  const nativeDeclaration = declaration(native);

  registry.registerSourceFile(native, ast, false);
  assert.equal(registry.profileForNode(nativeDeclaration, ast), "native");
});

test("nested path lookalikes make source profile provenance fail closed", () => {
  const registry = createRustSourceProfileRegistry();
  const native = sourceFile("/project/.tsonic/source-profiles/rust-provider/rust-globals.d.ts");
  const lookalike = sourceFile("/project/nested/.tsonic/source-profiles/rust-provider/rust-globals.d.ts");

  registry.registerSourceFile(native, ast, false);
  registry.registerSourceFile(lookalike, ast, false);
  assert.equal(registry.profileForNode(declaration(native), ast), undefined);
  assert.equal(registry.profileForNode(declaration(lookalike), ast), undefined);
});

test("native and JavaScript profile paths are mode-exact", () => {
  const nativeRegistry = createRustSourceProfileRegistry();
  const jsRegistry = createRustSourceProfileRegistry();
  const native = sourceFile("/project/.tsonic/source-profiles/rust-provider/rust-globals.d.ts");
  const compat = sourceFile("/project/.tsonic/source-profiles/rust-provider/js-globals.d.ts");
  const surface = sourceFile("/project/.tsonic/source-profiles/js/js-globals.d.ts");

  nativeRegistry.registerSourceFile(native, ast, false);
  nativeRegistry.registerSourceFile(compat, ast, false);
  assert.equal(nativeRegistry.profileForNode(declaration(native), ast), "native");
  assert.equal(nativeRegistry.profileForNode(declaration(compat), ast), undefined);

  jsRegistry.registerSourceFile(native, ast, true);
  jsRegistry.registerSourceFile(surface, ast, true);
  assert.equal(jsRegistry.profileForNode(declaration(native), ast), undefined);
  assert.equal(jsRegistry.profileForNode(declaration(surface), ast), "js");
});
