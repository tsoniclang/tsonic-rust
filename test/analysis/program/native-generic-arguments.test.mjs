import assert from "node:assert/strict";
import test from "node:test";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
import { publishRustPhysicalEmissionContexts } from "../../../dist/analysis/program/physical-emission-contexts.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/analysis/operations/finalized-operation/finalize.js";
import { closedMetadataKey } from "../../../dist/target-model/metadata/closed-data.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { rustFutureTargetType } from "../../../dist/target-model/types/carriers/primitives.js";
import { rustProgramErrorOwner } from "../../../dist/target-model/types/carriers/program-errors.js";
import { rustProgramErrorTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { selectRustNativeInvocationErrorPropagation } from "../../../dist/analysis/errors/regions.js";
import { rustRuntimeErrorTargetType } from "../../../dist/target-model/operations/error-boundary.js";
import { analyzeRust, artifactText, compileRust, nodejsCapability, stringCarrier, unitCarrier } from "../../helpers/rust-session.mjs";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const integer = Object.freeze({ kind: "source-primitive", name: "int32" });
const wide = Object.freeze({ kind: "source-primitive", name: "int64" });
const noNativeBindings = Object.freeze({ fieldBindings: Object.freeze([]), nativeBindings: Object.freeze([]) });

function nativeInput(programErrorCarrier = () => undefined) {
  return {
    typeDefinitions: emptyRustTypeDefinitions, typeParameterNames: undefined,
    pathFor: () => undefined, additionalArgumentsFor: () => undefined,
    programErrorCarrier, producerErrorCarrier: () => undefined,
    nativeErrorJoinCarrier: () => undefined, structuralCarrier: () => undefined,
  };
}

function operation(arguments_) {
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "method", form: { form: "call", path: "native::probe" },
    sourceArgumentCarriers: [], targetGenericArguments: arguments_,
    resultCarrier: integer, isAsync: false, isFallible: false,
  });
  assert.equal(abi !== undefined, true, "the original source operation is a valid immutable finalized ABI");
  return abi;
}

function preparedContext(identity, abi, arguments_, nativeOwnerFileName = "/src/index.ts") {
  const declaration = {};
  return Object.freeze({
    use: targetUseSiteRef(declaration, "native-body", identity), declaration,
    role: "native-body", specialization: Object.freeze({ kind: "ordinary" }),
    bindings: Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() }),
    returnDestination: Object.freeze({ kind: "none" }), error: Object.freeze({ kind: "none" }),
    operands: Object.freeze([]), sourceOrigins: Object.freeze([]), callableAdapters: Object.freeze([]), nativeOwnerFileName,
    nativeBindingRequests: Object.freeze([]),
    frameEntries: Object.freeze([]),
    nativeOperations: new Map([[abi, Object.freeze({ node: declaration, arguments: Object.freeze(arguments_) })]]),
  });
}

function preparation(contexts, operands = []) {
  const byUse = new Map(contexts.map(context => [context.use, context]));
  const byOperand = new Map(operands.map(operand => [operand.use, operand]));
  return {
    physicalOperands: [],
    contexts: {
      contexts, operands, sourceOccurrences: [],
      contextFor: use => byUse.get(use), operandFor: use => byOperand.get(use),
      contextForOwner: (subject, role) => contexts.find(context => context.use.subject === subject && context.role === role),
      bodyContextFor: () => undefined, sourceErrorOperandFor: () => undefined,
      carrierFor: () => undefined, sourceFor: () => undefined, sourceOriginFor: () => undefined,
    },
  };
}

test("retained native invocation results preserve Infallible and reject an unproved Result ABI before publication", () => {
  const context = preparedContext("native-call-result", operation([]), []);
  const use = targetUseSiteRef(context.declaration, "source-error", "native-call-result");
  const infallible = Object.freeze({ kind: "target-named", id: "rust.core.Infallible" });
  const carrier = rustCallableTargetType([integer], wide, { kind: "static" }, infallible);
  const operand = nativeCallResult => Object.freeze({ use, node: context.declaration, context,
    origin: { kind: "operand", evaluation: { kind: "ordinary", site: use } }, carrier: wide,
    destination: undefined, sourceErrorRegions: [], genericInvocation: undefined, nativeCallResult });
  const published = publishRustPhysicalEmissionContexts(preparation([context], [operand({ kind: "callable", carrier })]),
    () => nativeInput(), noNativeBindings);
  assert.equal(published.kind, "resolved", "the selected Infallible Result is valid without inventing a fallible context");
  const result = published.value.operandFor(use).nativeCallResult;
  assert.equal(result.kind, "result", "the full native invocation signature is required sealed data");
  assert.equal(result.propagation.kind, "infallible", "immediate invocation does not inherit a future's rejection effects");
  assert.equal(rustTargetTypeRefEquals(result.signature.result, wide), true, "the native result width is unchanged");
  assert.equal(result.signature.parameters.length === 1 && rustTargetTypeRefEquals(result.signature.parameters[0], integer), true,
    "the exact original native argument tuple is retained");
  assert.equal(Object.isFrozen(result) && Object.isFrozen(result.signature), true, "native call decisions are immutable");
  const invalid = publishRustPhysicalEmissionContexts(preparation([context], [operand({ kind: "callable", carrier: integer })]),
    () => nativeInput(), noNativeBindings);
  assert.equal(invalid.kind, "rejected", "a native scalar is never accepted as an unknown or identity callable ABI");
  assert.equal(invalid.diagnostics.length === 1 && invalid.diagnostics[0].code === "RUST_NATIVE_CALL_RESULT_NOT_PROVEN", true,
    "the original missing Result contract is diagnosed at admission");
  assert.equal("value" in invalid, false, "no incomplete physical invocation escapes publication");
});

test("retained native Result errors require the original invocation channels, not an ambient error or equal payload type", () => {
  const error = rustNamedTargetType("native:provider-error", "native::Failure", [], [], undefined, [], "native:provider-error", []);
  const foreign = rustNamedTargetType("native:foreign-error", "native::ForeignFailure", [], [], undefined, [], "native:foreign-error", []);
  const original = preparedContext("native-error-channel", operation([]), []);
  const source = Object.freeze({ identity: "definition-error", variant: "Error0", errorType: error });
  const target = Object.freeze({ identity: "caller-error", variant: "Error0", errorType: error });
  const context = Object.freeze({ ...original, error: Object.freeze({ kind: "region", owner: original.declaration,
    region: Object.freeze({ kind: "native", fileName: "/src/index.ts", localOwner: undefined, sources: Object.freeze([target]) }) }) });
  const edge = Object.freeze({ kind: "invoke", declaration: {},
    effects: { localErrors: false, nativeErrors: [{ identity: target.identity, errorType: error }] },
    nativeErrors: [{ source: { identity: source.identity, errorType: error }, target: { identity: target.identity, errorType: error } }] });
  const selection = Object.freeze({
    operand: Object.freeze({ kind: "native", fileName: "/dependency/index.ts", localOwner: undefined,
      sources: Object.freeze([source]) }),
    channels: Object.freeze([Object.freeze({ sourceIdentity: source.identity, targetIdentity: target.identity, uninhabited: false })]),
  });
  const use = targetUseSiteRef(context.declaration, "source-error", "native-error-channel");
  const operand = (carrier, sourceErrorRegions) => Object.freeze({ use, node: context.declaration, context,
    origin: { kind: "operand", evaluation: { kind: "ordinary", site: use } }, carrier: integer,
    destination: undefined, sourceErrorRegions, genericInvocation: undefined,
    nativeCallResult: Object.freeze({ kind: "callable", carrier }) });
  const carrier = rustCallableTargetType([], integer, { kind: "static" }, error);
  const publish = (selectedCarrier, regions) => publishRustPhysicalEmissionContexts(
    preparation([context], [operand(selectedCarrier, regions)]), () => nativeInput(), noNativeBindings);
  const accepted = publish(carrier, [{ edge, selection }]);
  assert.equal(accepted.kind, "resolved", "the original exact native Result channel is admitted");
  const result = accepted.value.operandFor(use).nativeCallResult;
  assert.equal(result.propagation.kind, "source", "provider errors retain source-to-caller channel transport");
  const publishedSelection = accepted.value.operandFor(use).sourceErrorRegions[0].selection;
  assert.equal(result.propagation.selection === publishedSelection, true,
    "the identical already-published selection is reused, never a second reconstruction");
  assert.equal(result.propagation.selection.channels[0].targetIdentity, target.identity, "the exact caller identity is retained");
  assert.equal(rustTargetTypeRefEquals(result.signature.error, error), true, "the actual provider E is not replaced by TsonicError");
  const conflicting = { ...selection, channels: [{ ...selection.channels[0], targetIdentity: "different-caller-error" }] };
  for (const [label, rejected] of [
    ["no invocation correspondence", publish(carrier, [])],
    ["await correspondence is not invocation correspondence", publish(carrier, [{ edge: { ...edge, kind: "await" }, selection }])],
    ["different native error identity", publish(rustCallableTargetType([], integer, { kind: "static" }, foreign), [{ edge, selection }])],
    ["ambiguous original channel mapping", publish(carrier, [{ edge, selection }, { edge: { ...edge, declaration: {} }, selection: conflicting }])],
  ]) {
    assert.equal(rejected.kind, "rejected", label);
    assert.equal("value" in rejected, false, `${label}: no partially validated native result is published`);
    assert.equal(rejected.diagnostics.some(issue => issue.code === "RUST_NATIVE_CALL_RESULT_NOT_PROVEN"), true,
      `${label}: the refusal belongs to native admission before planning`);
  }
});

test("native frame invocation errors retain the defining package across a different caller's physical context", () => {
  const owner = Object.freeze({ kind: "physical", domain: "project", componentId: "definition" });
  const caller = Object.freeze({ kind: "physical", domain: "project", componentId: "caller" });
  const error = rustNamedTargetType("error:definition", "dependency::program::TsonicError", [], [], undefined, [], "error:definition", []);
  const callerError = rustNamedTargetType("error:caller", "crate::program::TsonicError", [], [], undefined, [], "error:caller", []);
  const context = Object.freeze({ kind: "region", owner: {}, region: Object.freeze({ kind: "package",
    fileName: "/caller/index.ts", localOwner: caller, sources: Object.freeze([]) }) });
  const input = nativeInput(selected => selected.kind !== "physical" ? undefined
    : selected.componentId === owner.componentId ? error : selected.componentId === caller.componentId ? callerError : undefined);
  const selected = selectRustNativeInvocationErrorPropagation(context.owner, error, context, [], owner, input);
  assert.equal(selected.kind === "resolved" && selected.value.kind === "local", true,
    "the actual defining-package E is transported through the caller's real package boundary");
  const foreign = selectRustNativeInvocationErrorPropagation(context.owner, callerError, context, [], owner, input);
  assert.equal(foreign.kind, "rejected", "a frame cannot substitute the caller's error type for its defining package E");
  const runtime = selectRustNativeInvocationErrorPropagation(context.owner, rustRuntimeErrorTargetType(), context, [], undefined, input);
  assert.equal(runtime.kind === "resolved" && runtime.value.kind === "local", true,
    "only the authoritative runtime error identity selects the runtime-to-package route");
  const noLocal = selectRustNativeInvocationErrorPropagation(context.owner, rustRuntimeErrorTargetType(), {
    ...context, region: { ...context.region, kind: "infallible", localOwner: undefined },
  }, [], undefined, input);
  assert.equal(noLocal.kind, "rejected", "a missing physical local channel is rejected before the planner sees the call");
});

test("one immutable source ABI publishes separate required native arguments in actual physical environments", () => {
  const parameter = Object.freeze({ kind: "type-parameter", identity: "source:Value", name: "Value" });
  const abi = operation([{ kind: "type", type: parameter }]);
  const original = closedMetadataKey(abi);
  const originalArgument = abi.targetGenericArguments[0].type;
  const first = preparedContext("first", abi, [{ kind: "type", type: integer }]);
  const second = preparedContext("second", abi, [{ kind: "type", type: wide }]);
  const operandUse = targetUseSiteRef(first.declaration, "operand", "first");
  const operand = Object.freeze({ use: operandUse, node: first.declaration, context: first,
    origin: { kind: "operand", evaluation: { kind: "ordinary", site: first.use } },
    carrier: integer, destination: undefined, sourceErrorRegions: [], genericInvocation: undefined,
    nativeCallResult: Object.freeze({ kind: "none" }) });
  const published = publishRustPhysicalEmissionContexts(preparation([first, second], [operand]), () => nativeInput(), noNativeBindings);
  assert.equal(published.kind, "resolved", "both actual native environments publish");
  const firstNative = published.value.contextFor(first.use);
  const secondNative = published.value.contextFor(second.use);
  assert.equal(firstNative.targetGenericArguments.get(abi)[0].nativeCarrier.name, "int32", "first exact native width");
  assert.equal(secondNative.targetGenericArguments.get(abi)[0].nativeCarrier.name, "int64", "second exact native width");
  assert.equal(published.value.operandFor(operandUse).context === firstNative, true,
    "the final operand points to the identical final published context, never an open preparation");
  assert.equal(published.value.contextForOwner(first.use.subject, "native-body") === firstNative, true,
    "the original selected owner and role resolve to that identical final context, never the private preparation");
  assert.equal(published.value.contextForOwner({}, "native-body") === undefined, true, "a foreign owner has no context");
  assert.equal(firstNative.use === first.use && firstNative.sourceOrigins === first.sourceOrigins, true,
    "original use and source-origin identity survive publication");
  assert.equal(Object.isFrozen(firstNative) && Object.isFrozen(firstNative.targetGenericArguments.get(abi)), true,
    "required selected native rows are frozen before planning");
  assert.equal(closedMetadataKey(abi), original, "the early source ABI never changes");
  assert.equal(abi.targetGenericArguments[0].type === originalArgument, true, "the original source argument remains authoritative");
});

test("late native argument publication keeps genuine inference, exact consts and physical error identities", () => {
  const constant = { kind: "const", value: { kind: "integer", value: "18446744073709551615" } };
  const arguments_ = [
    { kind: "lifetime", lifetime: { kind: "static" } },
    { kind: "type", type: rustFutureTargetType(integer) },
    { kind: "type", type: rustProgramErrorTargetType() },
    constant,
  ];
  const abi = operation(arguments_);
  const first = preparedContext("root", abi, arguments_, "/root/index.ts");
  const second = preparedContext("dependency", abi, arguments_, "/dependency/index.ts");
  const owners = new Map([
    ["/root/index.ts", rustNamedTargetType("error:root", "rt::TsonicError", [], [], undefined, [], "error:root", [])],
    ["/dependency/index.ts", rustNamedTargetType("error:dependency", "dependency::program::TsonicError",
      [], [], undefined, [], "error:dependency", [])],
  ]);
  const reads = [];
  const published = publishRustPhysicalEmissionContexts(preparation([first, second]), fileName => {
    reads.push(fileName);
    return nativeInput(owner => owner.kind === "logical" ? owners.get(fileName) : undefined);
  }, noNativeBindings);
  assert.equal(published.kind, "resolved", "the actual physical native owners are available");
  for (const prepared of [first, second]) {
    const selected = published.value.contextFor(prepared.use).targetGenericArguments.get(abi);
    assert.equal(selected.length, 3, "call-site lifetimes stay omitted, without losing any value/type argument");
    assert.equal(selected[0].kind, "infer", "native Future uses genuine native inference, not an opaque carrier");
    assert.equal(rustNamedTypeCarrierValue(selected[1].nativeCarrier).nativeErrorIdentity,
      rustNamedTypeCarrierValue(owners.get(prepared.nativeOwnerFileName)).nativeErrorIdentity,
      "native rejection identity comes from the actual emitted owner");
    assert.equal(selected[2].value.value, "18446744073709551615", "native const values never round through a JS number");
  }
  assert.equal(reads.join(","), "/root/index.ts,/dependency/index.ts", "the selecting producer supplies the actual native owner");
  assert.equal(abi.targetGenericArguments.length, 4, "source ABI lifetime/type/const evidence is unchanged");
});

test("unavailable native generic evidence rejects the actual source subject before final context publication", () => {
  const missing = { kind: "opaque", id: "fixture:missing-native-argument" };
  const abi = operation([{ kind: "type", type: missing }]);
  const prepared = preparedContext("missing", abi, abi.targetGenericArguments);
  const published = publishRustPhysicalEmissionContexts(preparation([prepared]), () => nativeInput(), noNativeBindings);
  assert.equal(published.kind, "rejected", "missing evidence is a source admission failure, never inference");
  assert.equal(published.value === undefined, true, "no final native context is published");
  assert.equal(published.diagnostics.length, 1, "one native selection owner produces the diagnostic");
  assert.equal(published.diagnostics[0].code, "RUST_PROVIDER_TARGET_GENERIC_ARGUMENT_NOT_REPRESENTABLE",
    "the source refusal is precise and precedes planning");
  assert.equal(published.diagnostics[0].sourceNode === prepared.declaration, true, "the exact source identity is retained");
  assert.equal(Object.isFrozen(abi), true, "rejection does not mutate early source facts");
});

test("a retained Node stream operation has required late native error arguments without modifying its source ABI", async () => {
  const { program } = analyzeRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    files: { "index.ts": `import { stdout } from "node:process";
export function writable(): boolean { return stdout.writable; }` } });
  const selected = [];
  for (const context of program.physicalEmissionContexts.contexts) {
    for (const origin of context.sourceOrigins) assert.equal(context.targetGenericArguments.has(origin.occurrence.operation.abi), true,
      "every original checked provider occurrence has its required row in the same physical context");
    for (const [abi, arguments_] of context.targetGenericArguments) {
      if (!abi.targetGenericArguments.some(argument => argument.kind === "type" && rustProgramErrorOwner(argument.type) !== undefined)) continue;
      const fileName = program.source.ast.getFileName(program.source.ast.getSourceFile(context.declaration));
      const component = program.sourceOutputIdentities.get(fileName).componentId;
      const boundary = program.errorTransport.nativeBoundaryFor(component, { kind: "logical" });
      assert.equal(boundary !== undefined, true, "the real retained operation has its selected native error owner");
      assert.equal(arguments_.some(argument => argument.kind === "type" &&
        rustNamedTypeCarrierValue(argument.nativeCarrier)?.nativeErrorIdentity === boundary.errorTypeIdentity), true,
      "the required published generic argument preserves its real program-error identity");
      assert.equal(abi.targetGenericArguments.some(argument => argument.kind === "type" &&
        rustProgramErrorOwner(argument.type)?.kind === "logical"), true, "the early source ABI remains logical");
      selected.push(abi);
    }
  }
  assert.equal(selected.length > 0, true, "the actual installed Node provider exercises the native generic-error root");
});

test("provider resource cleanup publishes and renders its exact generic arguments in the original native body", () => {
  const provider = createRustProviderPackage({ id: "render-resource", displayName: "Native resource generic arguments", version: "1.0.0",
    modules: [{ moduleSpecifier: "@render/resource", providerModuleId: "render.resource", exports: [
      { id: "Resource", name: "Resource", kind: "interface", members: [{ id: "Resource.dispose", kind: "method",
        name: { kind: "well-known-symbol", name: "dispose" }, signatures: [{ id: "Resource.dispose()", parameters: [],
          returnType: { kind: "void" } }] }] },
      { id: "open", name: "open", kind: "function", signatures: [{ id: "open()", parameters: [],
        returnType: { kind: "provider-ref", moduleSpecifier: "@render/resource", exportName: "Resource" } }] },
    ] }], types: [{ exportId: "Resource", targetCarrier: stringCarrier }], carrierPaths: {}, crates: [],
    operations: [
      { exportId: "open", operationKind: "method", target: { form: "call", path: "String::new" }, resultCarrier: stringCarrier },
      { exportId: "Resource", memberId: "Resource.dispose", operationKind: "method",
        target: { form: "free-call", path: "core::mem::drop", receiverMode: "value" },
        targetGenericArguments: [{ kind: "type", type: stringCarrier }], resultCarrier: unitCarrier },
    ] });
  const { result } = compileRust({ surfaces: [], packages: [provider],
    files: { "index.ts": 'import { open } from "@render/resource"; export function run(): void { using active = open(); }' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic =>
    `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  const { program } = result;
  const { ast } = program.source;
  const sourceFile = program.sourceFiles.find(file => ast.getFileName(file).endsWith("/index.ts"));
  const declaration = ast.statements(sourceFile).find(node => ast.text(ast.name(node)) === "run");
  const context = program.physicalEmissionContexts.contextForOwner(declaration, "native-body");
  assert.equal(context !== undefined, true, "cleanup uses its actual source owner's required emitted context");
  const resources = [];
  const visit = node => {
    const resource = program.records.resourceManagement.get(node);
    if (resource !== undefined) resources.push({ node, resource });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(declaration);
  assert.equal(resources.length, 1, "the real source has one retained provider cleanup, not a synthetic operation witness");
  const disposal = resources[0].resource.disposal.target;
  assert.equal(disposal.form, "provider", "the native provider owns the selected disposal ABI");
  const arguments_ = context.targetGenericArguments.get(disposal.abi);
  assert.equal(arguments_ !== undefined && arguments_.length === 1, true,
    "the exact resource ABI is selected before planning even though it is not an ordinary source call occurrence");
  assert.equal(arguments_[0].kind, "type", "a concrete native String is explicit, never fake inference");
  assert.equal(arguments_[0].nativeCarrier.id, stringCarrier.id, "the selected disposal preserves its exact native carrier");
  assert.equal(disposal.abi.targetGenericArguments[0].type.id, stringCarrier.id, "early source disposal evidence remains unchanged");
  const output = artifactText(result, "src/index.rs");
  assert.equal([...output.matchAll(/core::mem::drop::<String>\(/gu)].length, 1,
    "one exact native generic drop consumes the resource without an extra wrapper");
  assert.doesNotMatch(output, /active\.(?:clone|as_ref|as_mut)\(/u, "native generic selection introduces no clone or borrow adaptation");
  validateGeneratedProject("render-resource-generic-arguments", result.artifacts);
});
