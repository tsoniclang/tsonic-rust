import assert from "node:assert/strict";
import test from "node:test";
import { sourceMarkerFactKey } from "@tsonic/tsts";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { resolveRustJsStringCarrier } from "../../../../dist/analysis/source-evidence/types/resolution/markers.js";
import { rustJsStringTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

test("authored aliased JsString contracts retain the exact marker without changing native widths or local names", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: {
    "index.ts": `
import type { JsString as Utf16 } from "@tsonic/js/types.js";
import type { int64 } from "@tsonic/core/types.js";
type ExactText = Utf16;
export function imported(input: Utf16): Utf16 { return input; }
export function aliased(input: ExactText): ExactText { return input; }
export function wide(input: int64): int64 { return input; }
`,
    "shadow.ts": `
import type { int32 } from "@tsonic/core/types.js";
type JsString = int32;
export function shadow(input: JsString): JsString { return input; }
`,
  } });
  const ast = program.source.ast;
  const declarations = new Map();
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node)) declarations.set(ast.text(ast.name(node)), node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  for (const [name, expected] of [
    ["imported", rustJsStringTargetType()],
    ["aliased", rustJsStringTargetType()],
    ["wide", rustSourcePrimitiveTargetType("int64")],
    ["shadow", rustSourcePrimitiveTargetType("int32")],
  ]) {
    const declaration = declarations.get(name);
    assert.equal(declaration !== undefined, true, `${name}: the checked declaration exists`);
    const parameter = ast.parameters(declaration)[0];
    assert.equal(parameter !== undefined, true, `${name}: the authored parameter exists`);
    assert.equal(rustTargetTypeRefEquals(program.records.sourceParameterAbi.get(parameter)?.valueCarrier, expected), true,
      `${name}: the exact authored input is neither erased nor inferred from its spelling`);
    assert.equal(rustTargetTypeRefEquals(program.records.sourceCallableReturn.get(declaration)?.returnCarrier, expected), true,
      `${name}: the exact authored return retains the same native carrier`);
  }
});

test("JS string marker resolution requires one exact marker across semantic subjects", () => {
  const node = {};
  const type = {};
  const declaration = {};
  const unrelated = {};
  const facts = new Map();
  const context = {
    ast: { kind: subject => subject === node ? "KindTypeReference" : undefined },
    source: { sourceFacts: { getFact(subject, key) {
      assert.equal(key === sourceMarkerFactKey, true, "only the canonical marker fact is read");
      return facts.get(subject);
    } } },
    currentSemantics: { facts: { typeSubjects: subject => subject === type ? [declaration] : [] } },
  };
  assert.equal(resolveRustJsStringCarrier(node, context) === undefined, true,
    "an unmarked authored node has no invented native JS-string carrier");
  assert.equal(resolveRustJsStringCarrier(type, context) === undefined, true,
    "an unmarked semantic type has no invented native JS-string carrier");
  facts.set(node, { marker: "js-string" });
  facts.set(declaration, { marker: "js-string" });
  for (const subject of [node, type]) {
    assert.equal(rustTargetTypeRefEquals(resolveRustJsStringCarrier(subject, context), rustJsStringTargetType()), true,
      "authored and semantic facts use the same exact native marker decision");
  }
  facts.set(type, { marker: "js-string" });
  assert.equal(rustTargetTypeRefEquals(resolveRustJsStringCarrier(type, context), rustJsStringTargetType()), true,
    "duplicate identical marker facts retain one decision");
  facts.set(declaration, { marker: "pointer" });
  assert.equal(resolveRustJsStringCarrier(type, context) === undefined, true,
    "conflicting semantic marker evidence cannot select JS-string storage");
  assert.equal(resolveRustJsStringCarrier(unrelated, context) === undefined, true,
    "an unrelated subject cannot inherit another subject's marker");
});
