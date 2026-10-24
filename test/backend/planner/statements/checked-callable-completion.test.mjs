import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { applyRustTailShape } from "../../../../dist/backend/target-ast/normalization/block-flow.js";
import { acmeTestingPackage, artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("unit completion omits only a final pure unit literal and retains preceding effects", () => {
  const effect = { kind: "expr", expr: { kind: "call", path: "record", args: [] } };
  const unit = { kind: "tuple-literal", elements: [] };
  for (const kind of ["return", "tail"]) {
    const body = { statements: [effect, { kind, expr: unit }] };
    assert.deepEqual(applyRustTailShape(body, false, new Set()), { statements: [effect] });
    assert.deepEqual(applyRustTailShape(body, true, new Set()).statements[1], { kind: "tail", expr: unit });
    const effectful = { statements: [{ kind, expr: effect.expr }] };
    assert.deepEqual(applyRustTailShape(effectful, false, new Set()).statements, [{ kind: "tail", expr: effect.expr }]);
  }
  const nested = { statements: [{ kind: "scope", body: { statements: [{ kind: "tail", expr: unit }] } }] };
  assert.deepEqual(applyRustTailShape(nested, false, new Set()), { statements: [{ kind: "scope", body: { statements: [] } }] });
  const earlyReturn = { statements: [{ kind: "return", expr: unit }, effect] };
  assert.equal(applyRustTailShape(earlyReturn, false, new Set()), earlyReturn);
});

test("exhaustive switches retain function, method and closure return flow", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "checked_completion" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
type Choice = "left" | "right";
function choose(value: Choice): number {
  switch (value) {
    case "left": return 10;
    case "right": return 20;
  }
}
class Selector {
  choose(value: Choice): number {
    switch (value) {
      case "left": return 30;
      case "right": return 40;
    }
  }
}
export function main(): void {
  const callback = (value: Choice): number => {
    switch (value) {
      case "left": return 50;
      case "right": return 60;
    }
  };
  const selector = new Selector();
  check(choose("left") === 10 && choose("right") === 20);
  check(selector.choose("left") === 30 && selector.choose("right") === 40);
  check(callback("left") === 50 && callback("right") === 60);
}
main();
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /else\s*\{\s*\}|unreachable_unchecked/u);
  validateGeneratedProject("checked-callable-completion", result.artifacts, { run: true });
});

test("a source switch missing a value-returning path remains a checker failure", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
export function choose(value: "left" | "right"): number {
  switch (value) { case "left": return 10; }
}
` } }), /TS2366/u);
});
