import assert from "node:assert/strict";
import test from "node:test";
import { falliblePointerFiles, falliblePointerPackageFiles, falliblePointerPackageGraph } from "../../../../../tsonic/test/fixtures/fallible-pointer-views.mjs";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { rustLocationCallbackCarrier } from "../../../../dist/analysis/operations/location-callbacks.js";
import { rustCallableProtocol, rustClosureProtocol, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

for (const [name, files] of [["files", falliblePointerFiles], ["packages", falliblePointerPackageFiles]]) {
  for (const surfaces of [undefined, ["js"]]) {
    test(`fallible pointer callbacks preserve aliases and selected errors across ${name}, ${surfaces?.[0] ?? "native"}`, { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        sourcePackages: name === "packages" ? falliblePointerPackageGraph : undefined,
        target: { id: "rust", options: { outputType: "bin", crateName: "fallible_locations" } },
        files: { ...files, "index.ts": `${files["index.ts"]}
export function main(): void { if (!run()) throw new Error("pointer callback contract"); }` },
      });
      assert.deepEqual(result.diagnostics, []);
      assert.equal(result.artifacts.filter(artifact => artifact.path.endsWith("Cargo.toml")).length, name === "packages" ? 2 : 1);
      const code = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
      assert.match(code, /\.try_load\(\)\?/u);
      assert.match(code, /\.try_store\(/u);
      assert.doesNotMatch(code, /panic_any|catch_unwind|downcast_ref|\bunsafe\b/u);
      assert.equal(validateGeneratedProject(`fallible-locations-${name}-${surfaces?.[0] ?? "native"}`, result.artifacts, { run: true }).status, 0);
    });
  }
}

test("inline location callbacks have an explicit Result ABI without a first-class allocation", () => {
  const ast = { kindName: node => node.kind };
  const integer = rustSourcePrimitiveTargetType("int32");
  const inline = rustLocationCallbackCarrier({ kind: "KindArrowFunction" }, [integer], integer, ast);
  const retained = rustLocationCallbackCarrier({ kind: "KindIdentifier" }, [integer], integer, ast);
  assert.equal(rustClosureProtocol(inline).fallible, true);
  assert.equal(rustCallableProtocol(inline), undefined);
  assert.deepEqual(rustCallableProtocol(retained), { parameters: [integer], result: integer });
  assert.equal(rustTargetTypeRefEquals(inline, { ...inline, fallible: false }), false);
});
