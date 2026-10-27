import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { retainedPointerInputSource as source, reorderedPointerInputSource, widePointerInputSource,
  incompatiblePointerInputSources } from "../../../../tsonic/test/fixtures/retained-pointer-inputs.mjs";

function diagnosticSummary(diagnostics) {
  return JSON.stringify(diagnostics.slice(0, 8).map(({ code, message, evidence }) => ({
    code, message: message.slice(0, 512), evidence: evidence?.slice(0, 8).map(value => value.slice(0, 512)),
  })));
}

test("retained native requirements propagate through exact aliases and caller inputs, not unrelated callbacks", () => {
  const { program } = analyzeRust({ files: { "index.ts": source } });
  const ast = program.source.ast;
  const requirements = program.retainedCallableInputs;
  const inputs = program.callableValues.native.inputs;
  assert.equal(inputs.length, 5, "two retained, two forwarded, one invocation-only formal");
  for (const input of inputs) {
    const name = ast.text(ast.name(input.owner));
    const errors = requirements.forInput(input);
    assert.equal(errors.length, name === "immediate" ? 0 : 1, name);
    assert.equal(Object.isFrozen(errors), true, "published requirements are immutable");
    assert.equal(requirements.forInput({ ...input }).length, 0, "foreign evidence cannot carry a constraint");
  }
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, visit); };
  program.sourceFiles.forEach(visit);
  const boundaries = nodes.flatMap(node => [1, 2].flatMap(index => {
    const selected = requirements.forBoundary(node, index);
    return selected === undefined ? [] : [{ node, selected }];
  }));
  assert.equal(boundaries.length, 2);
  for (const { selected } of boundaries) {
    assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.inputs), true);
    assert.equal(selected.inputs.length, 1, "exact native input rather than a signature match");
    assert.equal(requirements.forInput(selected.inputs[0])[0] === selected.errorCarrier, true);
  }
  assert.equal(requirements.forBoundary({}, 1) === undefined, true);
});

for (const surfaces of [undefined, ["js"]]) {
  test(`native retained callback constraints execute through aliases and forwarding in ${surfaces?.[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": (source + "\nmain();\n") } });
    assert.equal(result.diagnostics.length, 0, diagnosticSummary(result.diagnostics));
    const code = artifactText(result, "src/index.rs");
    assert.match(code, /InvocationError:\s*core::convert::Into</u);
    assert.match(code, /::invoke\(/u);
    assert.doesNotMatch(code, /panic_any|catch_unwind|transmute|downcast|\bunsafe\b/u);
    validateGeneratedProject(`retained-input-forwarding-${surfaces?.[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

for (const [name, text] of [["reordered", reorderedPointerInputSource], ["int64", widePointerInputSource]]) {
  test(`native contextual callback inference retains ${name} source metadata`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": text + "\nmain();\n" } });
    assert.equal(result.diagnostics.length, 0, diagnosticSummary(result.diagnostics));
    const program = result.program;
    assert.equal(program !== undefined, true, "the contextual callback has a complete native analysis program");
    const inputs = [];
    const visit = node => {
      const ast = program.source.ast;
      if (ast.is.IsParameterDeclaration(node) && ast.is.IsArrowFunction(ast.parent(node))) {
        const identifier = ast.name(node);
        if (identifier !== undefined && ast.is.IsIdentifier(identifier) && ast.text(identifier) === "next") inputs.push(node);
      }
      program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(inputs.length, 1, "the actual unannotated setter has one original checked parameter");
    const input = program.records.sourceParameterAbi.get(inputs[0]);
    const expected = name === "int64" ? "int64" : "int32";
    assert.equal(input?.valueCarrier.kind === "source-primitive" && input.valueCarrier.name === expected, true,
      "the input keeps the exact selected native width before publication");
    assert.equal(input?.parameterCarrier.kind === "source-primitive" && input.parameterCarrier.name === expected, true,
      "the native entry does not reconstruct a number or unknown parameter");
    const code = artifactText(result, "src/index.rs");
    if (name === "int64") {
      assert.match(code, /Location<i64,/u);
      assert.doesNotMatch(code, /9007199254740992|as f64|i64_to_f64/u);
    }
    validateGeneratedProject(`retained-input-${name}`, result.artifacts, { run: true });
  });
}

for (const [index, text] of incompatiblePointerInputSources.entries()) {
  test(`independent conflicting callback carrier ${index} cannot reinterpret native pointer storage`, () => {
    const { result } = compileRust({ files: { "index.ts": text } });
    assert.equal(result.diagnostics.length > 0, true, "an incompatible native carrier remains rejected");
    assert.equal(result.artifacts.length, 0, "no invalid native output is published");
  });
}
