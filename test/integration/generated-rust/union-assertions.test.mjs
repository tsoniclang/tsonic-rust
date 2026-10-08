import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { unionAssertionSource } from "../../../../tsonic/test/fixtures/union-assertions.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`explicit union projections retain exact native arms on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts":
        'import { check } from "@acme/testing";\n' + unionAssertionSource +
        '\nexport function main(): void { check(run()); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    const shapes = artifactText(result, "src/shapes.rs");
    if (surfaces.length === 0) assert.match(shapes, /retains an unconstructed checked union variant/);
    else assert.doesNotMatch(shapes, /dead_code/);
    validateGeneratedProject("union-assertions", result.artifacts, { run: true });
  });
}

test("shared generated unions aggregate construction across distinct payload instantiations", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
function invoke(value: string | (() => string)): string { return (value as () => string)(); }
function choose(value: number | boolean): number { return typeof value === "number" ? value : 3; }
export function main(): void {
  check(invoke(() => "called") === "called" && choose(7) === 7 && choose(true) === 3);
}
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const shapes = artifactText(result, "src/shapes.rs");
  assert.equal((shapes.match(/enum Union2</g) ?? []).length, 1);
  assert.doesNotMatch(shapes, /dead_code/);
  validateGeneratedProject("shared-union-variant-liveness", result.artifacts, { run: true });
});
