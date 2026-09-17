import assert from "node:assert/strict";
import test from "node:test";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { collectRustProviderSemanticsFromDefinitions, mergeRustProviderSemantics } from "../../../dist/providers/packages/index.js";
import { compileRust } from "../../helpers/rust-session.mjs";

function definition(id = "acme-global") {
  return {
    id, displayName: id, version: "1.0.0",
    sourceGlobals: { selectedValue: `${id}::value` },
    modules: [{
      moduleSpecifier: `@acme/${id}`, providerModuleId: id,
      exports: [{ id: `${id}::value`, name: "value", kind: "value", type: { kind: "number" } }],
    }],
    operations: [{
      exportId: `${id}::value`, operationKind: "property",
      target: { form: "call", path: "acme::value" },
      resultCarrier: { kind: "source-primitive", name: "float64" },
    }],
    crates: [],
  };
}

test("provider globals reject invalid names and nonexistent or nonvalue exports", () => {
  for (const sourceGlobals of [null, [], "value", { "bad;name": "acme-global::value" }, { selectedValue: "missing" }]) {
    assert.throws(() => createRustProviderPackage({ ...definition(), sourceGlobals }), /source global/u);
  }
  const source = definition();
  source.modules[0].exports[0] = { id: "acme-global::value", name: "value", kind: "class", members: [] };
  assert.throws(() => createRustProviderPackage(source), /exact value export/u);
});

test("provider globals have one immutable declaration and export owner", () => {
  const source = definition();
  const provider = createRustProviderPackage(source);
  source.sourceGlobals.selectedValue = "missing";
  assert.deepEqual(provider.sourceProfileContributions({}), {
    declarations: [{ fileName: "provider-globals.d.ts", text: 'declare var selectedValue: typeof import("@acme/acme-global")["value"];' }],
  });
  assert.throws(() => mergeRustProviderSemantics(
    collectRustProviderSemanticsFromDefinitions([definition()]),
    collectRustProviderSemanticsFromDefinitions([definition("second")]),
  ), /conflicting export owners/u);
});

test("provider globals select exact imported values without taking over local bindings", () => {
  const { result } = compileRust({
    surfaces: ["js"], capabilities: [createRustProviderPackage(definition())],
    files: { "index.ts": `
import { value } from "@acme/acme-global";
export function total(): number { return selectedValue + globalThis.selectedValue + value; }
export function local(selectedValue: number): number { return selectedValue; }
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.map(artifact => artifact.text).join("\n");
  assert.equal(output.match(/acme::value\(\)/gu)?.length, 3);
  assert.match(output, /fn local\(selected_value: f64\)/u);
});

test("provider globals do not admit writes or dynamic indexing", () => {
  for (const body of [
    "globalThis.selectedValue = 3;",
    "selectedValue = 3;",
  ]) {
    const { result } = compileRust({
      surfaces: ["js"], capabilities: [createRustProviderPackage(definition())],
      files: { "index.ts": `import { value } from "@acme/acme-global";
export function changed(): number { const before = value; ${body} return before; }` },
    });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"), body);
    assert.equal(result.artifacts.length, 0);
  }
  assert.throws(() => compileRust({
    surfaces: ["js"], capabilities: [createRustProviderPackage(definition())],
    files: { "index.ts": 'export function changed(key: string) { return globalThis[key]; }' },
  }), /TS7017|TS7053/u);
});
