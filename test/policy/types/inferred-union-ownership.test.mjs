import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustInferredUnion } from "../../../dist/policy/types/resolution/inferred-unions.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

test("ambient signature inspection cannot register a source-owned union", () => {
  const declarationFile = Object.freeze({});
  const context = { currentSourceFile: declarationFile, source: { navigation: {
    isProjectDeclaration(subject) { assert.equal(subject, declarationFile); return false; },
  } }, get currentSemantics() { assert.fail("non-owned signature must not reach source-union construction"); } };
  assert.equal(resolveRustInferredUnion({}, [{}, {}], [
    rustSourcePrimitiveTargetType("int32"), rustSourcePrimitiveTargetType("bool"),
  ], context, { get sourceTypes() { assert.fail("ambient union must not mutate source registration"); } }), undefined);
});
