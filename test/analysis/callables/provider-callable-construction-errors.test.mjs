import assert from "node:assert/strict";
import test from "node:test";
import { createRustProviderPackage, rustCallableTargetType } from "../../../dist/public/provider.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustRuntimeErrorTargetType } from "../../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { compileRust } from "../../helpers/rust-session.mjs";

for (const surfaces of [[], ["js"]]) for (const mode of ["value", "ref"]) for (const fallible of [false, true]) {
  test(`provider callable construction keeps its fixed error before ${mode} passing (${surfaces[0] ?? "native"}, ${fallible ? "fallible" : "pure"})`, () => {
    const unit = { kind: "tuple", elements: [] };
    const provider = createRustProviderPackage({
      id: "provider-callable-construction-errors", version: "1.0.0", displayName: "Provider callable construction errors",
      crates: [],
      modules: [{ moduleSpecifier: "test:callable-errors", providerModuleId: "test.callable-errors", exports: [{
        id: "fixture.consume", name: "consume", kind: "function", signatures: [{
          id: "fixture.consume()", parameters: [{ name: "callback", type: {
            kind: "function", id: "fixture.callback", parameters: [], returnType: { kind: "void" },
          } }], returnType: { kind: "void" },
        }],
      }] }],
      operations: [{ exportId: "fixture.consume", operationKind: "method",
        target: { form: "call", path: "fixture::consume", argModes: [mode] },
        parameterCarriers: [rustCallableTargetType([], unit)], resultCarrier: unit,
      }],
    });
    const { result } = compileRust({ surfaces, packages: [provider], files: { "index.ts": `
import { consume } from "test:callable-errors";
export function run(): void {
  consume((): void => { ${fallible ? 'throw new Error("callback");' : ""} });
}
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
    assert.equal(result.program !== undefined && result.plan !== undefined, true, "the complete checked callback is published and planned");
    const program = result.program;
    const nodes = [];
    const visit = node => {
      nodes.push(node);
      program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    const calls = nodes.filter(node => program.records.targetOperation.get(node)?.target?.path === "fixture::consume");
    assert.equal(calls.length, 1, "the real provider invocation retains its exact native ABI");
    const operation = program.records.targetOperation.get(calls[0]);
    const argument = operation.abi.targetArguments[0];
    assert.equal(argument.source.kind, "argument", "the target input retains the actual checked source argument");
    assert.equal(argument.mode, mode, "the authored provider passing mode is unchanged");
    assert.equal(argument.conversion.targetCarrier.kind, "target-named", "the canonical value ABI precedes passing-mode wrapping");
    assert.equal(argument.parameterCarrier.kind, mode === "ref" ? "reference" : "target-named",
      "borrowing wraps the input but does not change its callable error contract");
    const declarations = nodes.filter(node => program.source.ast.is.IsArrowFunction(node));
    assert.equal(declarations.length, 1, "one original callback producer is exercised");
    const declaration = declarations[0];
    const closure = program.records.targetOperation.get(declaration);
    assert.equal(closure?.kind, "closure", "the checked callback has its original closure evidence");
    const physical = program.callableValues.nativeProducers.physicalFor(declaration, closure.resultCarrier);
    const signature = rustCallablePhysicalSignature(physical);
    assert.equal(signature !== undefined, true, "the selected native construction is complete");
    assert.equal(rustTargetTypeRefEquals(signature.error, rustRuntimeErrorTargetType()), true,
      "the construction uses the fixed provider error ABI, not its independently inferred body error");
    assert.equal(program.records.errorEffects.get(declaration)?.localErrors, fallible,
      "selection preserves the body's independent intrinsic effects");
  });
}
