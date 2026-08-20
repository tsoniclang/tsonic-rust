import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustSourceProfileRegistry } from "../../../dist/analysis/facts/source-profile-registry.js";
import { rustSourceProfileOwnerId } from "../../../dist/source/profiles/declarations.js";

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
  const native = sourceFile(`/project/.tsonic/source-profiles/${rustSourceProfileOwnerId}/rust-globals.d.ts`);
  const nativeDeclaration = declaration(native);
  const registry = createRustSourceProfileRegistry([native], ast, false);

  assert.equal(registry.profileForNode(nativeDeclaration, ast), "native");
});

test("nested path lookalikes make source profile provenance fail closed", () => {
  const native = sourceFile(`/project/.tsonic/source-profiles/${rustSourceProfileOwnerId}/rust-globals.d.ts`);
  const lookalike = sourceFile(`/project/nested/.tsonic/source-profiles/${rustSourceProfileOwnerId}/rust-globals.d.ts`);
  const registry = createRustSourceProfileRegistry([native, lookalike], ast, false);

  assert.equal(registry.profileForNode(declaration(native), ast), undefined);
  assert.equal(registry.profileForNode(declaration(lookalike), ast), undefined);
});

test("native and JavaScript profile paths are mode-exact", () => {
  const native = sourceFile(`/project/.tsonic/source-profiles/${rustSourceProfileOwnerId}/rust-globals.d.ts`);
  const jsProfile = sourceFile(`/project/.tsonic/source-profiles/${rustSourceProfileOwnerId}/js-globals.d.ts`);
  const surface = sourceFile("/project/.tsonic/source-profiles/js/js-globals.d.ts");
  const nativeRegistry = createRustSourceProfileRegistry([native, jsProfile], ast, false);
  const jsRegistry = createRustSourceProfileRegistry([surface], ast, true);

  assert.equal(nativeRegistry.profileForNode(declaration(native), ast), "native");
  assert.equal(nativeRegistry.profileForNode(declaration(jsProfile), ast), undefined);

  assert.equal(jsRegistry.profileForNode(declaration(native), ast), undefined);
  assert.equal(jsRegistry.profileForNode(declaration(surface), ast), "js");
});
