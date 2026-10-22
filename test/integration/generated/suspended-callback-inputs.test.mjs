import assert from "node:assert/strict";
import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { suspendedCallbackInputsSource } from "../../../../tsonic/test/fixtures/suspended-callback-inputs.mjs";
import { analyzeRust, compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("suspended callback inputs preserve borrowed function and owning method result lifetimes", { timeout: 300_000 }, () => {
  const options = { surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": (suspendedCallbackInputsSource + "\nawait main();\n") } };
  const { result } = compileRust(options);
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  // Promise bodies and source files are analysis catalogs of the complete analysis program.
  const { program } = analyzeRust(options);
  const ast = program.source.ast;
  const owners = [];
  const visit = node => {
    if ((ast.is.IsFunctionDeclaration(node) || ast.is.IsMethodDeclaration(node)) &&
      ast.text(ast.name(node)) === "sum") owners.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(owners.length, 2, "the original function and Reader method keep separate native owners");
  for (const owner of owners) {
    const body = program.promiseBodies.declarations.get(owner);
    assert.equal(body !== undefined, true, "the directly awaited owner has its own exact native body");
    const asynchronous = program.records.asyncFunction.get(owner);
    assert.equal(asynchronous?.kind === "js-promise" && asynchronous.lowering.kind === "factory", true,
      "abstract callback completions retain their actual suspending native body");
    const parameters = ast.parameters(owner);
    const inputs = program.callableValues.native.inputsFor(owner);
    assert.equal(parameters.length === 2 && inputs.length === 2, true, "both exact input contracts remain present");
    for (const [index, parameter] of parameters.entries()) {
      const physical = program.callableValues.nativeStorage.parameterFor(parameter);
      assert.equal(physical.kind === "selected" && physical.carrier === inputs[index].implementation, true,
        "the native body moves its exact implementation, without an allocating wrapper or invented loan");
      assert.equal(asynchronous.lowering.capturedParameters[index] === parameter, true,
        "each suspension capture retains the exact original input identity");
    }
    assert.equal(source.includes(`async fn ${body.name}`), true, "the selected body is emitted as a native Future");
    if (program.promiseBodies.objects.has(owner)) {
      assert.equal(/JsPromise<f64>/u.test(source), true, "a genuinely demanded object has one exact native payload");
    }
  }
  assert.equal(/JsPromise<'/u.test(source), false, "native input lifetimes are never extra JS Promise type arguments");
  validateGeneratedProject("suspended-callback-inputs", result.artifacts, { run: true });
});
