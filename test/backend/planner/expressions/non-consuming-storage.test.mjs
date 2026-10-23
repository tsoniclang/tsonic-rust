import assert from "node:assert/strict";
import test from "node:test";
import { planRustValueRead } from "../../../../dist/backend/planner/expressions/typed-locations.js";
import { createRustOwnershipFixture } from "../../../helpers/ownership.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";

test("selected reads emit their one ownership operation and never inspect authored expression syntax", () => {
  const node = {};
  const carrier = { kind: "source-primitive", name: "int32" };
  const owner = { kind: "field", receiver: { kind: "path", path: "environment" }, name: "capture_0" };
  const expressions = [owner, { kind: "method-call", receiver: owner, method: "clone", args: [] },
    { kind: "method-call", receiver: owner, method: "clone", args: [{ kind: "int-literal", text: "1" }] },
    { kind: "method-call", receiver: owner, method: "load", args: [] }];
  for (const mode of ["copy", "move", "borrow", "clone"]) {
    const ownership = createRustOwnershipFixture(node, carrier, mode);
    const context = { input: { program: { records: createRustRecordFixture({
      readOwnership: { get: selected => ownership.reads.get(selected) },
    }) } } };
    for (const expression of expressions) {
      const actual = planRustValueRead(node, expression, context);
      if (mode === "clone") {
        assert.equal(actual.kind, "method-call");
        assert.equal(actual.method, "clone");
        assert.equal(actual.receiver === expression, true, "only the selected clone is emitted");
        assert.deepEqual(actual.args, []);
      } else assert.equal(actual === expression, true, mode + " preserves every authored effect");
    }
  }
});
