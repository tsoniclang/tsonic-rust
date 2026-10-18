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
    carrier: integer, destination: undefined, sourceErrorRegions: [], genericInvocation: undefined });
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
