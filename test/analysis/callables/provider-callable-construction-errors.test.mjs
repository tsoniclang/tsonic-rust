import assert from "node:assert/strict";
import test from "node:test";
import { createRustProviderPackage, rustCallableTargetType } from "../../../dist/public/provider.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustProgramErrorTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { selectRustPhysicalProgramErrorOwner } from "../../../dist/analysis/errors/error-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustNamedTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustNativeErrorJoinReference } from "../../../dist/target-model/types/native-error-joins.js";
import { rustErrorRegionCarrier } from "../../../dist/analysis/errors/regions.js";
import { nativeClosureProducerFailurePackage } from "../../helpers/native-closure-producers.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";

function fixedCallbackConsumer(mode) {
  const unit = { kind: "tuple", elements: [] };
  return createRustProviderPackage({
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
}

for (const surfaces of [[], ["js"]]) for (const mode of ["value", "ref"]) for (const fallible of [false, true]) {
  test(`provider callable construction keeps its fixed error before ${mode} passing (${surfaces[0] ?? "native"}, ${fallible ? "fallible" : "pure"})`, () => {
    const provider = fixedCallbackConsumer(mode);
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
    const owner = selectRustPhysicalProgramErrorOwner(declaration,
      { ast: program.source.ast, components: program.sourcePackageComponents });
    assert.equal(owner !== undefined, true, "the original declaration retains its exact physical program-error owner");
    assert.equal(rustTargetTypeRefEquals(signature.error, rustProgramErrorTargetType(owner)), true,
      "the construction uses the fixed provider error ABI, not its independently inferred body error");
    assert.equal(program.records.errorEffects.get(declaration)?.localErrors, fallible,
      "selection preserves the body's independent intrinsic effects");
    assert.equal(program.records.lambdaBody.get(declaration).bodyErrorConversion === undefined, true,
      "an infallible or already exact local body adds no error adapter");
  });
}

for (const surfaces of [[], ["js"]]) for (const mode of ["value", "ref"]) for (const local of [false, true]) {
  test(`fixed provider callbacks admit their exact intrinsic ${local ? "mixed" : "native"} body error conversion (${surfaces[0] ?? "native"}, ${mode})`, () => {
    const failure = rustNamedTargetType("fixture:CallbackBodyFailure", "CallbackBodyFailure");
    const { result } = compileRust({ surfaces, packages: [fixedCallbackConsumer(mode), nativeClosureProducerFailurePackage(failure)],
      files: { "index.ts": `
        import { consume } from "test:callable-errors";
        import { fail } from "test:producer";
        export function run(): void {
          consume((): void => {
            const value = fail();
            ${local ? 'if (value < 0) throw new Error("native callback body");' : "void value;"}
          });
        }
      ` },
    });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("; "));
    assert.equal(result.program !== undefined && result.plan !== undefined, true, "the real checked producer reaches native planning");
    const program = result.program;
    const declarations = [];
    const visit = node => {
      if (program.source.ast.is.IsArrowFunction(node)) declarations.push(node);
      program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(declarations.length, 1, "one unchanged original callback owns both intrinsic effects");
    const declaration = declarations[0];
    const emission = program.records.lambdaBody.get(declaration);
    assert.equal(emission?.construction, "native", "the selected producer is an ordinary native callable");
    const contract = emission.bodyErrorConversion;
    assert.equal(contract !== undefined, true, "the body-to-construction boundary is decided before publication");
    assert.equal(contract.lowering, "program-error", "the existing exact native error conversion owns transport");
    assert.equal(contract.fallible, false, "transport cannot introduce another failure");
    assert.equal(contract.category, "exact", "the conversion preserves the exact native error");
    assert.equal(rustTargetTypeRefEquals(contract.source, rustErrorRegionCarrier(program.records.nativeErrorRegion.get(declaration))), true,
      "the conversion starts at the complete original intrinsic region");
    assert.equal(rustTargetTypeRefEquals(contract.target, rustCallablePhysicalSignature(emission.physicalCarrier).error), true,
      "the conversion ends at the actual fixed construction error");
    const errors = local ? rustNativeErrorJoinReference(contract.source)?.errors : [contract.source];
    assert.equal(errors?.length, local ? 2 : 1, "the body retains every local and native error channel");
    assert.equal(rustTargetTypeRefEquals(errors.at(-1), failure), true, "the original native error is not relabelled before the boundary");
    assert.equal(program.records.errorEffects.get(declaration)?.localErrors, local, "local throw effects remain independently exact");
    assert.equal(program.records.errorEffects.get(declaration)?.nativeErrors.length, 1, "the original provider failure remains one native channel");
  });
}
