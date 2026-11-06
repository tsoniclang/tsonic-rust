import assert from "node:assert/strict";
import { test } from "node:test";
import { createRustSourceProfileRegistry } from "../../../dist/analysis/project/source-profiles.js";
import { rustNativeSourceProfileContributions, rustJsSurfaceSourceProfileContributions, rustSourceProfileOwnerId } from "../../../dist/source/profiles/declarations.js";
import { sourceNoLibBaseDeclarations, sourcePrimitiveProfileDeclarations } from "@tsonic/js-source-profile";

test("Rust native and JS declarations consume the shared no-lib base with exact native argument lengths", () => {
  for (const contributions of [rustNativeSourceProfileContributions(), rustJsSurfaceSourceProfileContributions()]) {
    const text = contributions.declarations.map(declaration => declaration.text).join("\n");
    assert.equal(text.split(sourceNoLibBaseDeclarations).length - 1, 1);
    assert.equal(text.split(sourcePrimitiveProfileDeclarations).length - 1, 1);
    assert.equal(text.includes("interface IArguments {\n  readonly length: int32;\n}"), true);
  }
});

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
  // The registry also reads each profile file's Error contract; these provenance fixtures declare no statements.
  statements() {
    return [];
  },
};

test("source profile provenance is tied to one exact compiler source file", () => {
  const native = sourceFile(`/project/.tsonic/source-profiles/${rustSourceProfileOwnerId}/rust-globals.d.ts`);
  const nativeDeclaration = declaration(native);
  const registry = createRustSourceProfileRegistry({ ast, sourceFiles: [native] }, false);

  assert.equal(registry.profileForNode(nativeDeclaration, ast), "native");
});

test("nested path lookalikes make source profile provenance fail closed", () => {
  const native = sourceFile(`/project/.tsonic/source-profiles/${rustSourceProfileOwnerId}/rust-globals.d.ts`);
  const lookalike = sourceFile(`/project/nested/.tsonic/source-profiles/${rustSourceProfileOwnerId}/rust-globals.d.ts`);
  const registry = createRustSourceProfileRegistry({ ast, sourceFiles: [native, lookalike] }, false);

  assert.equal(registry.profileForNode(declaration(native), ast), undefined);
  assert.equal(registry.profileForNode(declaration(lookalike), ast), undefined);
});

test("native and JavaScript profile paths are mode-exact", () => {
  const native = sourceFile(`/project/.tsonic/source-profiles/${rustSourceProfileOwnerId}/rust-globals.d.ts`);
  const jsProfile = sourceFile(`/project/.tsonic/source-profiles/${rustSourceProfileOwnerId}/js-globals.d.ts`);
  const surface = sourceFile("/project/.tsonic/source-profiles/js/js-globals.d.ts");
  const nativeRegistry = createRustSourceProfileRegistry({ ast, sourceFiles: [native, jsProfile] }, false);
  const jsRegistry = createRustSourceProfileRegistry({ ast, sourceFiles: [surface] }, true);

  assert.equal(nativeRegistry.profileForNode(declaration(native), ast), "native");
  assert.equal(nativeRegistry.profileForNode(declaration(jsProfile), ast), undefined);

  assert.equal(jsRegistry.profileForNode(declaration(native), ast), undefined);
  assert.equal(jsRegistry.profileForNode(declaration(surface), ast), "js");
});
