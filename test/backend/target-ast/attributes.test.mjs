import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceFile, emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { rustWordAttribute } from "../../../dist/backend/target-ast/attributes.js";
import { inlineRustAttributedModules } from "../../../dist/backend/planner/attributes/modules.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { finalizeRustDeadCode } from "../../../dist/backend/target-ast/normalization/dead-code.js";
import { printRustSourceFile } from "../../../dist/print/source/items.js";

test("attributed module assembly retains lexical scope and recursively prints native items", () => {
  const nested = createRustSourceFile([{ kind: "function", name: "run", visibility: "public", generics: emptyRustGenerics,
    params: [], attrs: [rustWordAttribute("probe::entry")], body: { statements: [] } }]);
  const parent = createRustSourceFile([{ kind: "mod-decl", name: "inner", visibility: "public" }]);
  const root = createRustSourceFile([{ kind: "mod-decl", name: "outer", visibility: "public" }]);
  const modules = new Map([
    ["outer", { model: parent, attributes: [rustWordAttribute("probe::outer")] }],
    ["outer::inner", { model: nested, attributes: [rustWordAttribute("probe::inner")] }],
  ]);
  const model = inlineRustAttributedModules(root, "", modules);
  assert.equal(root.items[0].body, undefined);
  assert.equal(model.items[0].body.items[0].body.items[0].name, "run");
  const printed = printRustSourceFile(finalizeRustDeadCode(finalizeRustSourceStyle(model)));
  assert.match(printed, /#\[probe::outer\]\npub mod outer \{/u);
  assert.match(printed, /#\[probe::inner\]\n    pub mod inner \{/u);
  assert.match(printed, /#\[probe::entry\]\n        pub fn run\(\)/u);
  assert.doesNotMatch(printed, /mod (?:outer|inner);/u);
  assert.throws(() => inlineRustAttributedModules(model, "", modules), /different body owner/u);
});
