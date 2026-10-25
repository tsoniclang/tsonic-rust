import assert from "node:assert/strict";
import test from "node:test";
import { localProtectedAsyncSource, localProtectedErrorRegionSource,
  localProtectedModuleSource } from "../../../../tsonic/test/fixtures/local-protected-error-regions.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  for (const [name, source] of [["synchronous", localProtectedErrorRegionSource],
    ["module", localProtectedModuleSource], ["asynchronous", localProtectedAsyncSource]]) {
    test(`local protected errors retain ${name} identity and completion order (${surface})`, { timeout: 300_000 }, () => {
      const asynchronous = name === "asynchronous";
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: `local_protected_${name}_${surface}` } },
        files: { "index.ts": `${source}
export ${asynchronous ? "async " : ""}function main(): ${asynchronous ? "Promise<void>" : "void"} {
  if (!${asynchronous ? "await " : ""}run()) throw new Error("local protected completion");
}
${asynchronous ? "await " : ""}main();
` } });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 8).map(issue => `${issue.code}: ${issue.message}`).join("; "));
      assert.equal(result.program !== undefined && result.plan !== undefined, true,
        "the original local error contexts reach complete publication and planning");
      const output = artifactText(result, "src/index.rs");
      assert.doesNotMatch(output, /Box::pin|dyn (?:Future|std::error::Error)|catch_unwind/u,
        "local protection uses the existing native completion transport, not boxed or panic emulation");
      validateGeneratedProject(`local-protected-${name}-${surface}`, result.artifacts, { run: true });
    });
  }
}
