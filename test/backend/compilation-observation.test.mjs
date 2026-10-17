import assert from "node:assert/strict";
import test from "node:test";
import { compileRustTarget } from "../../dist/backend/compile.js";
import { compileRust } from "../helpers/rust-session.mjs";
import { nativeFunction, nativeType } from "../helpers/native-ast.mjs";
import { fakeAstReader } from "../helpers/fake-compile-input.mjs";
import { assertNoTargetDiagnostics } from "../../../tsonic/test/scripts/diagnostic-assertions.mjs";

const files = { "index.ts": "export function identity(value: number): number { return value; }" };

test("planner-only fixture identifies spread assignments by its exact syntax identity", () => {
  const ast = fakeAstReader();
  assert.equal(ast.is.IsSpreadAssignment({ kindName: "KindSpreadAssignment" }), true);
  assert.equal(ast.is.IsSpreadAssignment({ kindName: "KindArrowFunction" }), false);
  assert.equal(ast.is.IsSpreadAssignment({}), false);
});

test("Rust session and helper observe the real wrapper's exact program and native plan once", () => {
  let request;
  let program;
  let plan;
  let productionResult;
  const events = [];
  const compiled = compileRust({ files, compileTarget(received, observer) {
    request = received;
    events.push("compile");
    productionResult = compileRustTarget(received, {
      analyzed(value) {
        events.push("analysis");
        program = value;
        observer.analyzed(value);
      },
      planned(value) {
        events.push("plan");
        plan = value;
        observer.planned(value);
      },
    });
    events.push("return");
    return productionResult;
  } });
  assert.deepEqual(events, ["compile", "analysis", "plan", "return"]);
  assertNoTargetDiagnostics(compiled.result.diagnostics);
  assert.equal(request.input.source.ast === compiled.source.ast, true);
  assert.equal(program.source.ast === compiled.source.ast, true);
  assert.equal(compiled.result.program === program, true);
  assert.equal(compiled.result.plan === plan, true);
  assert.equal(compiled.result.artifacts === productionResult.value.artifacts, false,
    "the public session formats the raw backend artifacts");
  for (const [index, artifact] of productionResult.value.artifacts.entries()) {
    if (artifact.kind !== "source" || artifact.language !== "rust") {
      assert.equal(compiled.result.artifacts[index] === artifact, true,
        `non-Rust artifact ${artifact.path} retains its exact identity and order`);
    }
  }
  assert.equal(Object.isFrozen(program), true);
  assert.equal(Object.hasOwn(productionResult, "program"), false);
  assert.equal(Object.hasOwn(productionResult, "plan"), false);
  assert.deepEqual(Object.keys(productionResult.value), ["artifacts"]);
  const identity = nativeFunction(compiled.result, "identity");
  assert.deepEqual(identity.params.map(parameter => parameter.type), [nativeType("f64")]);
  assert.deepEqual(identity.returnType, nativeType("f64"));
  assert.deepEqual(compiled.result.artifacts, compileRust({ files }).result.artifacts);
});

test("Rust source rejection never enters the production wrapper or observes stages", () => {
  let calls = 0;
  assert.throws(() => compileRust({
    files: { "index.ts": "export const invalid: number = 'text';" },
    compileTarget() { calls += 1; assert.fail("Rejected source reached target compilation."); },
  }), /TypeScript diagnostics/u);
  assert.equal(calls, 0);
  assert.throws(() => compileRust({ files, target: { id: "rust", options: { outputType: "invalid" } },
    compileTarget() { calls += 1; assert.fail("Rejected configuration reached target compilation."); },
  }), /outputType/u);
  assert.equal(calls, 0);
});

test("Rust entry rejection observes neither a program nor a native plan", () => {
  const events = [];
  const compiled = compileRust({
    files: { "index.ts": "export function main(): void {}" },
    target: { id: "rust", options: { outputType: "bin" } },
    compileTarget(request, observer) {
      events.push("compile");
      return compileRustTarget(request, {
        analyzed(value) { events.push("analysis"); observer.analyzed(value); },
        planned(value) { events.push("plan"); observer.planned(value); },
      });
    },
  });
  assert.deepEqual(events, ["compile"]);
  assert.deepEqual(compiled.result.diagnostics.map(diagnostic => diagnostic.code),
    ["TSONIC_UNCALLED_BINARY_ENTRY_MAIN"]);
  assert.equal(compiled.result.artifacts.length, 0);
  assert.equal(compiled.result.program === undefined, true);
  assert.equal(compiled.result.plan === undefined, true);
});

test("Rust helper retains the production formatter diagnostic and never recovers output from a plan", () => {
  const previous = process.env.RUSTFMT;
  process.env.RUSTFMT = "/definitely/missing/tsonic-stage-observer-rustfmt";
  try {
    let rawResult;
    const compiled = compileRust({ files, compileTarget(request, observer) {
      rawResult = compileRustTarget(request, observer);
      return rawResult;
    } });
    assert.equal(rawResult.kind, "resolved", "raw compilation never invokes the formatter");
    assert.equal(rawResult.value.artifacts.length > 0, true, "raw backend artifacts exist");
    assert.equal(Object.isFrozen(rawResult.value.artifacts), true);
    assert.deepEqual(compiled.result.diagnostics.map(diagnostic => diagnostic.code),
      ["RUST_SOURCE_FORMATTING_FAILED"]);
    assert.match(compiled.result.diagnostics[0].message, /Unable to execute Rust formatter/u);
    assert.equal(compiled.result.diagnostics[0].source, "tsonic-rust");
    assert.deepEqual(compiled.result.diagnostics[0].evidence, ["target.capability=rust.toolchain.rustfmt"]);
    assert.equal(compiled.result.program.source.ast === compiled.source.ast, true);
    assert.equal(compiled.result.plan !== undefined, true);
    assert.equal(compiled.result.artifacts.length, 0);
  } finally {
    if (previous === undefined) delete process.env.RUSTFMT;
    else process.env.RUSTFMT = previous;
  }
});
