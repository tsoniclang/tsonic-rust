import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { nonReturningCallsSource } from "../../../../../tsonic/test/fixtures/non-returning-calls.mjs";

test("non-returning calls preserve native termination, catches and evaluation count", { timeout: 300_000 }, () => {
  for (const surfaces of [[], ["js"]]) {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": `${nonReturningCallsSource}\nexport async function main(): Promise<void> {
        if (!await run()) throw new Error("non-returning call observations");
      }` },
    });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject("non-returning-calls", result.artifacts, { run: true });
  }
});
