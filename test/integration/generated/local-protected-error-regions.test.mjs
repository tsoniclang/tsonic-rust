import assert from "node:assert/strict";
import test from "node:test";
import { TryStatement_TryBlock } from "@tsonic/target-api/source";
import { localProtectedAsyncSource, localProtectedErrorRegionSource, localProtectedIntrinsicSource,
  localProtectedModuleSource } from "../../../../tsonic/test/fixtures/local-protected-error-regions.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeFunction, nativeNodes } from "../../helpers/native-ast.mjs";
import { rustJsErrorTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

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
      if (name === "synchronous") {
        const pure = nativeFunction(result, "pureBoundCatch");
        assert.equal(nativeNodes(pure, node => node.kind === "try" && node.catchClause !== undefined).length, 0,
          "a genuinely infallible bound try body deliberately elides its unreachable catch and unused binding");
      }
      assert.doesNotMatch(output, /Box::pin|dyn (?:Future|std::error::Error)|catch_unwind/u,
        "local protection uses the existing native completion transport, not boxed or panic emulation");
      validateGeneratedProject(`local-protected-${name}-${surface}`, result.artifacts, { run: true });
    });
  }
}

test("local protection preserves a pure callback's independent native intrinsic error", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "local_protected_intrinsic" } },
    files: { "cases.ts": localProtectedIntrinsicSource, "index.ts": `import { run } from "./cases.js";
export function main(): void { if (!run()) throw new Error("native intrinsic protection"); }
main();
` } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.slice(0, 8).map(issue => `${issue.code}: ${issue.message}`).join("; "));
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(output, /\.reduce_from_first\(/u, "the existing intrinsic native Result operation remains selected");
  assert.doesNotMatch(output, /Box::new|rt::Callable::new/u, "a pure synchronous native callback requires no erased callable allocation");
  const program = result.program;
  const blocks = [];
  const visit = node => {
    if (program.source.ast.is.IsTryStatement(node)) blocks.push(TryStatement_TryBlock(program.source.ast, node));
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
  const nativeBody = blocks.find(node => program.errorRegions.localFor(node)?.sources.some(source =>
    rustTargetTypeRefEquals(source.errorType, rustJsErrorTargetType())));
  assert.equal(nativeBody !== undefined, true, "the protected body retains its independently selected native error channel");
  assert.equal(program.errorRegions.localFor(nativeBody) === program.records.nativeErrorRegion.get(nativeBody), true,
    "the analysis catalog and the existing sealed renderer record carry the identical selected body region");
  const joinedBody = blocks.find(node => {
    const region = program.errorRegions.localFor(node);
    return region?.localOwner !== undefined && region.sources.length !== 0;
  });
  assert.equal(joinedBody !== undefined, true, "a local protected body preserves both exact package and intrinsic error channels");
  const joined = program.errorRegions.localFor(joinedBody);
  assert.equal(program.records.nativeErrorJoinDeclarations.get(joined.fileName)?.some(declaration =>
    declaration.arity === joined.sources.length + 1), true,
  "the same region owner publishes a protected-only join even when no outward callable needs that arity");
  validateGeneratedProject("local-protected-intrinsic", result.artifacts, { run: true });
});
