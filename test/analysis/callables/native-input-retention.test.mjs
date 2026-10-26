import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustCallableInputProtocol } from "../../../dist/target-model/types/carriers/callables.js";

for (const [name, source] of [
  ["array", "export function choose(fallback: () => number[]): number[] { return fallback(); }"],
  ["nominal record", `
class Result { constructor(readonly value: number) {} }
export function choose(fallback: () => Result): Result { return fallback(); }
`],
]) {
  test(`an owned ${name} result does not retain its borrowed callable input`, () => {
    const { program } = analyzeRust({ surfaces: [], files: { "index.ts": source } });
    const { ast } = program.source;
    const declaration = program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
      ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "choose");
    assert.equal(declaration !== undefined, true, "the actual checked owner is present");
    const parameter = ast.parameters(declaration)[0];
    const abi = program.records.sourceParameterAbi.get(parameter);
    assert.equal(abi !== undefined && rustCallableInputProtocol(abi.valueCarrier) !== undefined, true,
      "the source ABI retains the exact borrowed callable-input contract");
    assert.equal(rustCallableInputProtocol(abi.parameterCarrier) !== undefined, true,
      "the native physical entry is borrowed rather than concrete runtime storage");
    assert.equal(program.callableValues.native.isConcreteCallableParameter(parameter), false,
      "result ownership does not invent a concrete runtime Callable parameter");
    assert.equal(program.callableValues.native.isNativeRetainedParameter(parameter), false,
      "an invoked callback is not retained merely because its result is owned");
    const inputs = program.callableValues.native.inputsFor(declaration);
    assert.equal(inputs.length, 1, "the exact generic native input remains available");
    assert.equal(inputs[0].subject.node === parameter, true, "the input retains the checked parameter identity");
    assert.equal(program.records.sourceParameterAbi.get(parameter) === abi, true,
      "classification does not replace the physical entry ABI");
  });
}
