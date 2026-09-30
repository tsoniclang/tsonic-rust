import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { closedInstanceFiles, closedNativeInstanceSource } from "../../../../tsonic/test/fixtures/closed-instance-tests.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`closed nominal union tests preserve inheritance, absence and effects on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...closedInstanceFiles, "index.ts": closedInstanceFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("closed class tests"); }',
    } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("closed-instance-tests", result.artifacts, { run: true });
  });
}

test("selected native constructors test closed payloads without copying them", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": closedNativeInstanceSource + '\nexport function main(): void { if (!run()) throw new Error("closed native tests"); }',
  } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  const start = output.indexOf("fn pattern(");
  const end = output.indexOf("fn r#match(");
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(output.slice(start, end), /\.clone\(|Box::new|Rc::new|Arc::new/u);
  validateGeneratedProject("closed-native-instance-tests", result.artifacts, { run: true });
});
