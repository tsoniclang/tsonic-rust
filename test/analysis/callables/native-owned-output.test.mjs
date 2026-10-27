import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { createRustNativeCallableProtocolRegistry } from "../../../dist/analysis/callables/native/native-protocols.js";
import { analyzeRustNativeProducerBridge } from "../../../dist/analysis/callables/native/native-producer-bridges.js";
import { rustNativeCallableInvocationArguments } from "../../../dist/policy/types/callables/native-invocations.js";
import { rustNativeCallableInputPhysicalSignature } from "../../../dist/policy/conversions/native-callables.js";
import { rustCallableTargetType, rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustLifetimeKey } from "../../../dist/target-model/lifetimes/index.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";

function fixture(inspect) {
  let observations;
  let context;
  compileRust({ surfaces: [], files: { "index.ts": `
type Result = { readonly invoke: () => number };
export function callback(value: () => Result): void {}
` }, compileTarget(request) {
    context = analyzeRustCheckedContext(request, original => {
      const callableValues = Object.create(original.callableValues);
      Object.defineProperty(callableValues, "initialize", { value(input) {
        const construction = original.callableValues.initialize(input);
        const selected = construction.native.inputs.find(selected => input.ast.text(input.ast.name(selected.owner)) === "callback");
        assert.equal(selected !== undefined, true, "the original zero-input factory owns its native input before finalization");
        const registry = createRustNativeCallableProtocolRegistry({ definitions: input.typeDefinitions,
          usedNames: new Set(), structuralShapes: input.structuralShapes });
        observations = inspect({ input, selected, registry });
        return construction;
      } });
      return { ...original, callableValues };
    });
    assert.equal(context.diagnostics.length, 0, `the original positive source remains admitted: ${JSON.stringify(
      context.diagnostics.map(({ code, message }) => ({ code, message })))}`);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
  } });
  assert.equal(context !== undefined && observations !== undefined, true, "the existing source and native construction owners completed");
  return { context, observations };
}

test("zero-input native factories retain distinct logical source and exact owned output contracts", () => {
  fixture(({ input, selected }) => {
    const protocol = selected.protocol;
    const original = protocol.method.sourceResult;
    const physical = protocol.method.result;
    const sourceField = rustStructuralObjectCarrierValue(original)?.fields.find(field => field.sourceName === "invoke");
    const nativeField = rustStructuralObjectCarrierValue(physical)?.fields.find(field => field.sourceName === "invoke");
    assert.equal(sourceField !== undefined && nativeField !== undefined, true, "the same original stored output field is preserved");
    assert.equal(rustCallableProtocol(sourceField.type)?.lifetime.kind, "placeholder", "the checked source result is not retagged as physical storage");
    assert.equal(rustCallableProtocol(nativeField.type)?.lifetime.kind, "static", "the owned native output has its explicit static output contract");
    assert.equal(protocol.method.binder.parameters.length, 0, "no invocation lifetime is invented for a zero-input factory");
    const arguments_ = rustNativeCallableInvocationArguments(selected, { kind: "source-call", parameters: [], resultCarrier: original }, "factory:original");
    assert.equal(arguments_ !== undefined && arguments_.length === 0, true, "source call matching retains its own exact output domain");
    const signature = rustNativeCallableInputPhysicalSignature(selected, []);
    assert.equal(signature !== undefined && rustTargetTypeRefEquals(signature.result, physical), true,
      "physical invocation continues to require the selected native output rather than the logical placeholder");
    const bridge = analyzeRustNativeProducerBridge(protocol, input.typeDefinitions);
    const result = rustNamedTypeCarrierValue(bridge?.concreteResult);
    assert.equal(result?.genericArguments[0]?.kind === "type" && rustTargetTypeRefEquals(result.genericArguments[0].type, physical), true,
      "the actual producer Output equality retains the exact owned result contract");
    assert.equal(input.structuralShapes.definitionForCarrier(physical) !== undefined, true,
      "the exact native output application is registered by the original owner before sealing");
    return selected;
  });
});

test("native output environment instances share the original template without overwriting static or caller lifetimes", () => {
  const { context, observations } = fixture(({ input, selected, registry }) => {
    const source = selected.protocol.method.sourceResult;
    const first = { kind: "parameter", identity: "caller:first", name: "first" };
    const second = { kind: "parameter", identity: "caller:second", name: "second" };
    const left = registry.bind("/src/index.ts", rustCallableTargetType([], source, first));
    const right = registry.bind("/src/index.ts", rustCallableTargetType([], source, second));
    const owned = registry.bind("/src/index.ts", rustCallableTargetType([], source));
    assert.equal(left !== undefined && right !== undefined && owned !== undefined, true,
      "canonical named and static output instances coexist at the original initialized layout owner");
    assert.equal(left.protocol === right.protocol, true, "actual caller region identities do not create duplicate formal native protocols");
    assert.equal(left.protocol === owned.protocol, false, "a named environment contract is not silently replaced by a static contract");
    assert.equal(left.environment.length === 1 && left.environment[0].kind === "lifetime", true,
      "the named environment uses one actual lifetime argument, not a fabricated type argument");
    assert.equal(rustLifetimeKey(left.environment[0].lifetime), rustLifetimeKey(first), "the first actual source lifetime remains exact");
    assert.equal(rustLifetimeKey(right.environment[0].lifetime), rustLifetimeKey(second), "the second actual source lifetime remains distinct");
    assert.equal(input.structuralShapes.templateForCarrier(left.protocol.method.result) ===
      input.structuralShapes.templateForCarrier(owned.protocol.method.result), true,
    "both exact applications retain the same canonical original structural owner");
    assert.equal(input.structuralShapes.definitionForCarrier(source) !== undefined, true, "the original logical source application remains indexed");
    return [left.protocol.method.result, owned.protocol.method.result];
  });
  for (const carrier of observations) assert.equal(context.structuralShapes.completed.definitionForCarrier(carrier) !== undefined, true,
    "each exact native application survives ordinary callable storage finalization");
});
