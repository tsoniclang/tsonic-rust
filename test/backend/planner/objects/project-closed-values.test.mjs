import assert from "node:assert/strict";
import test from "node:test";
import { planRustProjectClosedValue } from "../../../../dist/backend/planner/objects/project-closed-values.js";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

test("exact project Error admission preserves its payload before passive object erasure", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class Failure extends Error {}
export function erase(value: Failure): unknown { return value; }
` } });
  assert.equal(program.projectTypes.sourceErrorDefinitions.length, 1, "one actual source Error definition");
  const carrier = program.projectTypes.openCarrier(program.projectTypes.sourceErrorDefinitions[0]);
  assert.equal(program.records.projectClosedValue.get(carrier)?.kind, "error", "the admission owner preserves the native Error payload");
  const context = { diagnostics: [], input: { program: { ...program,
    objectRepresentations: { representationFor() { assert.fail("Error admission must not erase passive object capabilities"); } },
  } } };
  const source = { kind: "path", path: "original" };
  for (const owner of ["rt::TsValue", "js_abi::JsValue"]) {
    const planned = planRustProjectClosedValue(source, owner, carrier, {}, context);
    assert.equal(planned.kind, "call");
    assert.equal(planned.path, `${owner}::from_error`);
    assert.equal(planned.args[0] === source, true, "moves the identical checked source payload");
  }
  assert.equal(context.diagnostics.length, 0);
});
