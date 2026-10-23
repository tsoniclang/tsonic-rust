import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeSource, nativeNodes } from "../../helpers/native-ast.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";

const programs = [
  ["package-error", 'throw new Error("root error");'],
  ["project-error", 'class Failure extends Error {}\nthrow new Failure("project error");'],
  ["asynchronous-initializer", 'async function initialize(): Promise<void> { throw new Error("async error"); }\nawait initialize();'],
  ["native-task-root", 'async function body(): Promise<void> { return; }\nvoid body();'],
];

for (const surfaces of [[], ["js"]]) {
  for (const [name, source] of programs) {
    test(`native ${name} binary uses exact declared reference scopes on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
      const crateName = `reference_${name.replaceAll("-", "_")}_${surfaces[0] ?? "native"}`;
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin", crateName } },
        files: { "index.ts": source } });
      assertNoTargetDiagnostics(result.diagnostics);
      const main = nativeSource(result, "src/main.rs");
      assert.equal(nativeNodes(main, node => typeof node.path === "string" &&
        ["rt", "js_abi", "js_string", "js_exact_string", "crate"].some(alias => node.path.startsWith(`${alias}::`))).length,
      0, "binary native references are qualified before syntax composition, including nested types and associated owners");
      assert.equal(main.items.some(item => item.kind === "use" && item.alias === "rt"), false,
        "a blanket runtime alias import is not used to hide an invalid cross-scope reference");
      validateGeneratedProject(`native-reference-${name}-${surfaces[0] ?? "native"}`, result.artifacts);
    });
  }
}

test("source text does not activate aliases and task-free native output gains no task machinery", () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin", crateName: "reference_free" } },
    files: { "index.ts": 'export function text(): string { return "rt:: js_abi:: are source text"; }\ntext();' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const main = artifactText(result, "src/main.rs");
  assert.doesNotMatch(main, /TaskScope|run_tasks|native_task_scope/u, "no native task work is introduced in a task-free binary");
  assert.doesNotMatch(main, /use .* as (?:rt|js_abi|js_string|js_exact_string);/u,
    "source text does not manufacture a native alias demand");
});
