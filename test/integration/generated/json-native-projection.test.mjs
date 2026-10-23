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
        const replaced = JSON.stringify({ keep: 7, drop: 0, null: 1 },
          (key, value) => key === "drop" ? undefined : key === "null" ? null : value);
        if (ordered !== '{"zebra":1,"alpha":2}' || replaced !== '{"keep":7,"drop":null,"null":null}') {
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
