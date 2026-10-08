import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceCallableAbiResolver } from "../../../dist/policy/ownership/source-callable-abi.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { borrowedCallbackInputSource } from "../../../../tsonic/test/fixtures/borrowed-callback-inputs.mjs";

test("published native parameter ABI supersedes a pre-finalization missing cache entry", () => {
  const parameter = {};
  const carrier = rustSourcePrimitiveTargetType("int64");
  const abi = Object.freeze({ form: "required", valueCarrier: carrier, parameterCarrier: carrier, mode: "value" });
  let published;
  const resolver = createRustSourceCallableAbiResolver({ isNativeCallableExpression: () => true,
    parameterAbiFor: selected => selected === parameter ? published : undefined });
  assert.equal(resolver.resolveParameterAbi(parameter, {
    ast: { typeNode: () => undefined, as: { AsParameterDeclaration: () => undefined } },
  }, {}, carrier), undefined);
  published = abi;
  const sealedContext = { ast: new Proxy({}, { get() { throw new Error("Published ABI must not query syntax"); } }) };
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {}), abi);
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {}, { ...carrier }), abi);
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {}, rustSourcePrimitiveTargetType("uint64")), undefined);
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {}), abi);
});

test("selected native callable inputs retain logical arrays and exact physical mutability", () => {
  const { program } = analyzeRust({ files: { "index.ts": borrowedCallbackInputSource } });
  const { ast } = program.source;
  const selected = [];
  const visit = node => {
    if (ast.is.IsCallExpression(node)) {
      const operation = program.facts.getFact(node, rustTargetOperationFactKey);
      if (operation?.kind === "source-call" && operation.target.form === "callable") {
        selected.push(operation);
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(selected.length, 4, "both callback bodies retain both repeated invocations");
  assert.equal(selected.filter(operation => operation.parameters[0]?.mode === "mut-ref").length, 2);
  assert.equal(selected.filter(operation => operation.parameters[0]?.mode === "ref").length, 2);
  for (const operation of selected) {
    const parameter = operation.parameters[0];
    assert.equal(parameter.valueCarrier.kind, "array");
    assert.equal(parameter.parameterCarrier.kind, "reference");
    assert.equal(parameter.parameterCarrier.referent.kind, "slice");
    assert.equal(parameter.parameterCarrier.mutable, parameter.mode === "mut-ref");
    assert.deepEqual(parameter.inputs[0].carrier, parameter.valueCarrier);
    assert.deepEqual(parameter.valueCarrier.element, rustSourcePrimitiveTargetType("float64"));
  }
});

test("a selected readonly callable does not admit a mutable source body", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
function invoke(values: readonly number[], apply: (items: readonly number[]) => number): number {
  return apply(values);
}
export function run(): number { return invoke([1, 2], items => { items[0] += 1; return items[0]; }); }
` } }), /TS2542: Index signature in type 'readonly number\[\]' only permits reading/u);
});
