import assert from "node:assert/strict";
import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { jsonNativeProjectionSource } from "../../../../tsonic/test/fixtures/json-native-projection.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native JSON projections preserve exact integers, property keys and callback error identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "json_native_projection" } },
    files: { "index.ts": (`${jsonNativeProjectionSource}\nexport function main(): void { run(); }` + "\nmain();\n") },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.equal(typeof source, "string");
  assert.match(source, /js_value_from_json_projection/u);
  validateGeneratedProject("json-native-projection", result.artifacts, { run: true });
});

test("literal JSON projections preserve authored key order and the single native absence", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "json_literal_order" } },
    files: { "index.ts": `
      export function main(): void {
        const ordered = JSON.stringify({ zebra: 1, alpha: 2 });
        const nested = JSON.stringify({ b: { a: 1, b: 2 }, a: 0 });
        const inverse = JSON.stringify({ a: { b: 2, a: 1 }, b: 0 });
        const replaced = JSON.stringify({ keep: 7, drop: 0, null: 1 },
          (key, value) => key === "drop" ? undefined : key === "null" ? null : value);
        if (ordered !== '{"zebra":1,"alpha":2}' || replaced !== '{"keep":7,"drop":null,"null":null}' ||
            nested !== '{"b":{"a":1,"b":2},"a":0}' || inverse !== '{"a":{"b":2,"a":1},"b":0}') {
          throw new Error("literal projection changed authored key order or the single absence");
        }
      }
      main();
    ` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.equal(typeof source, "string", "literal projection source exists");
  assert.doesNotMatch(source, /Undefined|if_same_then_else/u, "no second absence or lint suppression");
  validateGeneratedProject("json-literal-order", result.artifacts, { run: true });
});

test("nested literal JSON projections preserve source correspondence and evaluation order", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "json_nested_literal_order" } },
    files: { "index.ts": `
      let trace = "";
      function mark(label: string, value: number): number {
        trace = trace + label;
        return value;
      }
      export function main(): void {
        const result = JSON.stringify({ b: { a: mark("x", 1), b: mark("y", 2) }, a: mark("z", 0) });
        if (result !== '{"b":{"a":1,"b":2},"a":0}' || trace !== "xyz") {
          throw new Error("nested projection reordered a child or re-executed source effects");
        }
        const spread = JSON.stringify({ b: { ...{ b: 2, a: 1 } }, a: 0 });
        if (spread !== '{"b":{"b":2,"a":1},"a":0}') {
          throw new Error("nested spread projection lost its own source order");
        }
      }
      main();
    ` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("json-nested-literal-order", result.artifacts, { run: true });
});
