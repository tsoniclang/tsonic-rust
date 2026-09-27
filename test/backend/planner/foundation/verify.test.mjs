import assert from "node:assert/strict";
import test from "node:test";
import { verifyRustFoundationPlan } from "../../../../dist/backend/planner/foundation/verify.js";
import { rustListAttribute, rustValueAttribute } from "../../../../dist/backend/target-ast/attributes.js";

const program = {
  foundation: { selected: "core", required: "core" },
  runtimeReferences: { minimumFoundationByCrate: new Map([["macro_provider", "std"]]) },
};
const attributes = [rustListAttribute("macro_provider::annotate", [
  rustValueAttribute("reason", { kind: "string", value: "compile-time only" }),
])];
const verify = model => verifyRustFoundationPlan(program, [{ kind: "source", path: "src/lib.rs", model }]);

test("attribute arguments and macro paths do not invent executable foundation requirements", () => {
  for (const field of ["attrs", "innerAttrs", "valueAttrs"]) {
    assert.deepEqual(verify({ [field]: attributes, items: [{ kind: "const", name: "VALUE",
      type: { kind: "primitive", name: "i32" }, value: { kind: "int-literal", text: "1" } }] }), []);
  }
});

test("foundation verification still rejects allocating and native runtime syntax beside attributes", () => {
  for (const [syntax, expected] of [
    [{ kind: "string" }, "alloc"],
    [{ kind: "string-concat", parts: [] }, "alloc"],
    [{ kind: "vec-literal", elements: [] }, "alloc"],
    [{ kind: "call", path: "std::process::exit", args: [] }, "std"],
    [{ kind: "call", path: "macro_provider::execute", args: [] }, "std"],
  ]) {
    const diagnostics = verify({ innerAttrs: attributes, items: [{ kind: "const", name: "VALUE",
      attrs: attributes, type: { kind: "unit" }, value: { kind: "block", valueAttrs: attributes, value: syntax } }] });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "RUST_FOUNDATION_PLAN_VIOLATION");
    assert.ok(diagnostics[0].evidence.includes(`rust.foundation.planned=${expected}`));
  }
});
