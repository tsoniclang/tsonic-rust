import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustSourceProfileRegistry } from "../../../dist/analysis/facts/source-profile-registry.js";
import { rustSourceProfileOwnerId } from "../../../dist/source/profiles/declarations.js";
import {
  rustJsSurfaceSourceProfileContributions,
  rustNativeSourceProfileContributions,
} from "../../../dist/source/profiles/declarations.js";
import { jsRegExpSourceProfileDeclarations } from "@tsonic/js-source-profile";

test("only the Rust JS surface composes the canonical RegExp declaration contract", () => {
  const nativeText = declarationText(rustNativeSourceProfileContributions());
  const jsText = declarationText(rustJsSurfaceSourceProfileContributions());

  assert.equal(nativeText.includes(jsRegExpSourceProfileDeclarations), false);
  assert.equal(jsText.split(jsRegExpSourceProfileDeclarations).length - 1, 1);
  assert.equal((jsText.match(/interface RegExp \{/gu) ?? []).length, 1);
  assert.equal((jsText.match(/interface RegExpConstructor \{/gu) ?? []).length, 1);
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
};

function declarationText(contributions) {
  return (contributions.declarations ?? []).map((item) => item.text).join("\n");
}

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
