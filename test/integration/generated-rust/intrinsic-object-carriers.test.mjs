import assert from "node:assert/strict";
import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { intrinsicObjectCarrierFiles } from "../../../../tsonic/test/fixtures/intrinsic-object-carriers.mjs";

for (const surface of ["native", "js"]) {
  test(`authored and inferred intrinsic objects retain the same native payload carrier in ${surface}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin", crateName: "intrinsic_objects" } }, files: {
        ...intrinsicObjectCarrierFiles,
        "index.ts": intrinsicObjectCarrierFiles["index.ts"] + `
          export function main(): void { if (!run()) throw new Error("intrinsic object payload and identity"); }`,
      } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = artifactText(result, "src/objects.rs");
    const carrier = surface === "js" ? "js_abi::JsValue" : "rt::TsValue";
    for (const name of ["retain", "inferred", "readonly"]) {
      assert.match(source, new RegExp(`fn ${name}\\(value: ${carrier}\\) -> ${carrier}`, "u"));
    }
    assert.doesNotMatch(source, /ObjectIdentity|EmptyObject/u);
    validateGeneratedProject(`intrinsic-object-carriers-${surface}`, result.artifacts, { run: true });
  });
}
