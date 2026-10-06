import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRustFoundationImports } from "../../../../dist/backend/planner/foundation/imports.js";
import { createRustSourceFile } from "../../../../dist/backend/target-ast/nodes.js";
import { rustValueAttribute } from "../../../../dist/backend/target-ast/attributes.js";

function imports(value, options = {}) {
  const result = applyRustFoundationImports(createRustSourceFile([{
    kind: "const", name: "VALUE", visibility: "private", type: options.type ?? { kind: "unit" }, value,
    ...(options.attrs === undefined ? {} : { attrs: options.attrs }),
  }], options.innerAttrs), "alloc");
  return result.items.filter(item => item.kind === "use").map(item => item.path);
}

test("native slice concatenation and formatter writes require no allocated format macro", () => {
  assert.deepEqual(imports({ kind: "string-concat", parts: [{ kind: "str-literal", value: "text" }] },
    { type: { kind: "string" } }), ["alloc::string::String"]);
  assert.deepEqual(imports({ kind: "format-write", writer: { kind: "path", path: "formatter" },
    format: "{}", args: [{ kind: "int-literal", text: "7" }] }), []);
});

test("compile-time attribute strings never manufacture runtime alloc imports", () => {
  const attributes = [rustValueAttribute("doc", { kind: "string", value: "metadata only" })];
  const value = { kind: "int-literal", text: "7" };
  assert.deepEqual(imports(value, { attrs: attributes }), []);
  assert.deepEqual(imports(value, { innerAttrs: attributes }), []);
  assert.deepEqual(imports({ ...value, valueAttrs: attributes }), []);
});

test("actual native owned values retain their exact alloc imports", () => {
  assert.deepEqual(imports({ kind: "owned-string-from-borrowed-str", expression: { kind: "str-literal", value: "text" } }), ["alloc::string::String"]);
  assert.deepEqual(imports({ kind: "vec-literal", elements: [] }), ["alloc::vec"]);
  assert.deepEqual(imports({ kind: "call", path: "Vec::new", args: [] }), ["alloc::vec::Vec"]);
  const model = createRustSourceFile([
    { kind: "use", path: "alloc::string::String" },
    { kind: "const", name: "VALUE", visibility: "private", type: { kind: "string" },
      value: { kind: "owned-string-from-borrowed-str", expression: { kind: "str-literal", value: "text" } } },
  ]);
  assert.equal(applyRustFoundationImports(model, "alloc"), model);
  assert.equal(applyRustFoundationImports(model, "core"), model);
  assert.equal(applyRustFoundationImports(model, "std"), model);
});
