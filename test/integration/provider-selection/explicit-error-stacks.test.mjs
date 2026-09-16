import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { explicitErrorStackSource, invalidErrorStackSources } from "../../../../tsonic/test/fixtures/explicit-error-stacks.mjs";
import { sourceClassAnnotationSource, invalidSourceClassAnnotations } from "../../../../tsonic/test/fixtures/source-class-annotations.mjs";
import { structuralMethodRestSource } from "../../../../tsonic/test/fixtures/structural-method-rest.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  for (const [name, source] of [["explicit-error-stack", explicitErrorStackSource], ["class-annotations", sourceClassAnnotationSource], ["structural-method-rest", structuralMethodRestSource]]) {
    test(`${name} executes with the shared source contract (${profile})`, { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
        target: { id: "rust", options: { outputType: "bin", crateName: name.replaceAll("-", "_") } },
        files: { "index.ts": `${source}\nimport { check } from "@acme/testing"; export function main(): void { check(run()); }` },
      });
      assert.deepEqual(result.diagnostics, []);
      validateGeneratedProject(`${name}-${profile}`, result.artifacts, { run: true });
    });
  }
  test(`invalid explicit stacks and class annotations remain checked (${profile})`, () => {
    for (const source of invalidErrorStackSources) {
      assert.throws(() => compileRust({ surfaces, files: { "index.ts": source } }), /error TS/u);
    }
    for (const { source, code } of invalidSourceClassAnnotations) {
      assert.throws(() => compileRust({ surfaces, files: { "index.ts": source } }), new RegExp(code, "u"));
    }
  });
}

test("explicit Error capture requires std without weakening alloc-only Error construction", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "alloc" } },
    files: { "index.ts": "export function capture(error: Error): void { Error.captureStackTrace(error); }" },
  });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code }) => code === "RUST_FOUNDATION_REQUIREMENT_UNSATISFIED"),
    JSON.stringify(result.diagnostics));
});
