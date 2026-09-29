import assert from "node:assert/strict";
import test from "node:test";
import { retainRustCheckedCompletion, rustBlockTerminates } from "../../../../dist/backend/planner/statements/block-flow.js";
import { acmeTestingPackage, artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("only an exact no-fallthrough proof adds a safe terminal assertion", () => {
  const body = { statements: [{ kind: "let", name: "value", mutable: false, init: { kind: "bool-literal", value: true } }] };
  for (const evidence of [undefined, true]) {
    assert.equal(retainRustCheckedCompletion(body, evidence), body);
    assert.equal(rustBlockTerminates(body), false);
  }
  const retained = retainRustCheckedCompletion(body, false);
  assert.equal(retained.statements[0], body.statements[0]);
  assert.equal(retained.statements.length, 2);
  assert.equal(retained.statements[1].expr.expression.kind, "unreachable");
  assert.equal(rustBlockTerminates(retained), true);
  assert.equal(retainRustCheckedCompletion(retained, false), retained);
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
` },
  });
  assert.deepEqual(result.diagnostics, []);
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
