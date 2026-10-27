import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/target-program.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";

const imports = `import { allocateptr, loadptr } from "@tsonic/core/lang.js";
import type { Pointer, uint32 } from "@tsonic/core/types.js";`;

for (const surfaces of [[], ["js"]]) {
  test(`loaded callable pointers consume checked allocation origins in ${surfaces[0] ?? "native"}`, () => {
    let program;
    const { result } = compileRust({ surfaces, files: { "index.ts": `${imports}
function value(): uint32 { return 7; }
function first(): Pointer<typeof value> { return allocateptr(value); }
function second(): Pointer<typeof value> { return allocateptr(value); }
export function read(): uint32 {
  const left = loadptr(first());
  const right = loadptr(second());
  return left() + right();
}` }, compileTarget(request) {
      const analyzed = analyzeRustAnalysisProgram(request);
      if (analyzed.kind === "rejected") return analyzed;
      program = analyzed.value;
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: analyzed.diagnostics };
    } });
    assert.equal(result.diagnostics.length, 0,
      JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    assert.equal(program !== undefined, true, "the complete pointer-callback program is admitted");
    const loads = [];
    const allocations = [];
    const factories = new Set();
    const visit = node => {
      const ast = program.source.ast;
      if (ast.is.IsCallExpression(node)) {
        const callee = Node_Expression(ast, node);
        if (callee !== undefined && ast.is.IsIdentifier(callee) && ast.text(callee) === "allocateptr") allocations.push(node);
        const arguments_ = ast.arguments(node);
        const argument = arguments_.length === 1 ? arguments_[0] : undefined;
        const factory = argument === undefined || !ast.is.IsCallExpression(argument) ? undefined : Node_Expression(ast, argument);
        const nestedArguments = argument === undefined || !ast.is.IsCallExpression(argument)
          ? undefined : ast.arguments(argument);
        if (callee !== undefined && ast.is.IsIdentifier(callee) && ast.text(callee) === "loadptr" &&
          factory !== undefined && ast.is.IsIdentifier(factory) && /^(first|second)$/u.test(ast.text(factory)) &&
          nestedArguments?.length === 0) {
          loads.push(node);
          factories.add(ast.text(factory));
        }
      }
      program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const file of program.sourceFiles) visit(file);
    assert.equal(loads.length, 2, "both independent allocations retain their exact loaded callable values");
    assert.equal(factories.has("first") && factories.has("second"), true, "both distinct original allocation factories are selected");
    assert.equal(allocations.length, 2, "both original factory allocations have their own emission owners");
    for (const allocation of allocations) {
      const selected = program.callableValues.nativeStorage.valueFor(allocation);
      assert.equal(selected.kind !== "unresolved", true, "the original allocation has completed physical storage");
      const emitted = program.records.locationAllocation.get(allocation);
      assert.equal(emitted !== undefined && Object.isFrozen(emitted), true, "allocation syntax consumes immutable physical evidence");
      assert.equal(emitted.carrier === selected.carrier, true, "the emitted owner is exactly the selected allocation carrier");
      assert.equal(emitted.pointeeCarrier === selected.carrier.genericArguments[0].type, true,
        "the allocation cannot recover the old logical callback error from its source operation");
      const signature = rustCallablePhysicalSignature(emitted.pointeeCarrier);
      assert.equal(signature !== undefined && signature.parameters.length === 0, true, "the allocation retains the original callback ABI");
      const reference = rustProducerErrorReference(signature.error);
      const error = reference === undefined ? signature.error : program.errorRegions.producerError(reference);
      assert.equal(error?.kind === "target-named" && error.id === rustInfallibleTargetId, true,
        "the allocation owner retains the same infallible error as its stored callback and returned pointer");
    }
    for (const load of loads) {
      const selected = program.callableValues.nativeStorage.valueFor(load);
      assert.equal(selected.kind !== "unresolved", true, selected.reason ?? "the checked load has physical callable storage");
      const signature = rustCallablePhysicalSignature(selected.carrier);
      assert.equal(signature?.parameters.length, 0, "the callable's native input ABI is unchanged");
      assert.equal(signature.result.kind === "source-primitive" && signature.result.name === "uint32", true,
        "the loaded callback retains its native-width result");
      const reference = rustProducerErrorReference(signature.error);
      const error = reference === undefined ? signature.error : program.errorRegions.producerError(reference);
      assert.equal(error?.kind === "target-named" && error.id === rustInfallibleTargetId, true,
        "loading does not fabricate a runtime error for the infallible source callable");
    }
  });

  for (const [name, declaration] of [
    ["self", "export function recursive(): Pointer<typeof recursive> { return allocateptr(recursive); }"],
    ["mutual", `function first(): Pointer<typeof second> { return allocateptr(second); }
export function second(): Pointer<typeof first> { return allocateptr(first); }`],
  ]) {
    test(`${name} recursive pointer carriers remain refused in ${surfaces[0] ?? "native"}`, () => {
      const { result } = compileRust({ surfaces, files: { "index.ts": `${imports}\n${declaration}` } });
      assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_POINTER_POINTEE_CARRIER_NOT_PROVEN"), true,
        "a recursive physical pointer type is not justified by unrelated finite callable origins");
      assert.equal(result.artifacts.length, 0, "an unresolved recursive pointee never reaches code generation");
    });
  }
}
