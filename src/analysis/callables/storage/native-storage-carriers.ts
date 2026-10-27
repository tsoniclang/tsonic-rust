import type { AstReader } from "@tsonic/tsts";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustCallableTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustNamedTargetType } from "../../../target-model/types/carriers/native.js";
import { rustTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";
import { rustRuntimeCallableTargetType } from "../../../target-model/types/carriers/runtime-carriers.js";
import { rustCallableInvocationSignaturesMatch } from "../../../policy/conversions/callable-input.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { isRustAbsenceCarrier } from "../../../target-model/types/carriers/native.js";
import { rustUnionAlternatives } from "../../../target-model/types/union-relations.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { inferRustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import { directReturnedValues } from "./native-storage-values.js";
import { rustCallablePhysicalCarrier } from "../../../policy/conversions/callable-physical.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustFrameCallablePlan } from "../../../target-model/records/callables/frame-callables.js";

/** The analysis facts the native storage carrier selections read. */
export interface RustNativeStorageCarrierInput {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
  readonly frames: Pick<RustFrameCallablePlan, "bindingFor">;
}

export function rustNativeStorageAbsentOrigin(input: RustNativeStorageCarrierInput, subject: SourceStorageSubject): boolean {
  if (subject.projection.length !== 0) return false;
  if (isRustAbsenceCarrier(input.records.runtimeCarrier.get(subject.node)?.carrier)) return true;
  // A sync callable's return produces no Future when every value it returns is absent, including an implicit
  // `undefined` completion and a body that never returns.
  if (subject.kind !== "return" || input.records.asyncFunction.get(subject.node) !== undefined) return false;
  return directReturnedValues(input.ast, subject.node)?.every(value =>
    isRustAbsenceCarrier(input.records.runtimeCarrier.get(value)?.carrier)) === true;
}

// The one stored payload of a union carrier that is a type-erased runtime callable with the destination's signature.
export function rustNativeStorageErasedUnionCallablePayload(input: RustNativeStorageCarrierInput, union: TargetTypeRef | undefined, current: TargetTypeRef): TargetTypeRef | undefined {
  const present = rustOptionElementCarrier(union) ?? union;
  const value = rustSourceUnionCarrierValue(present);
  const payloads = value?.payloads.kind === "physical" ? value.payloads.types
    : present === undefined ? undefined : rustUnionAlternatives(present, input.definitions)?.map(variant => variant.carrier);
  const matching = (payloads ?? []).filter(payload => payload.kind === "target-named" && payload.id === rustCallableTargetId &&
    rustCallableInvocationSignaturesMatch(current, payload));
  return matching.length === 1 ? rustCallablePhysicalCarrier(matching[0]!) : undefined;
}

// A class field reached through an unbound receiver holds the field's own storage; a frame-callable field stores
// its physical frame callable directly, so that storage is the producer's physical implementation.
export function rustNativeStorageFrameFieldCarrier(input: RustNativeStorageCarrierInput, origin: SourceStorageSubject): TargetTypeRef | undefined {
  const component = origin.projection.length === 1 ? origin.projection[0] : undefined;
  const carrier = origin.kind !== "receiver" || component?.kind !== "member" ? undefined
    : input.frames.bindingFor(component.declaration)?.carrier;
  return carrier !== undefined && rustFrameCallableValue(carrier) !== undefined ? carrier : undefined;
}

// A closure's callable parameter is not a native input (a closure cannot be generic); it holds its type-erased
// runtime callable carrier.
export function rustNativeStorageErasedClosureParameter(input: RustNativeStorageCarrierInput, origin: SourceStorageSubject, current: TargetTypeRef): TargetTypeRef | undefined {
  const owner = input.ast.parent(origin.node);
  if (owner === undefined || !input.ast.is.IsArrowFunction(owner) && !input.ast.is.IsFunctionExpression(owner)) return undefined;
  const carrier = input.records.sourceParameterAbi.get(origin.node)?.valueCarrier;
  const selected = rustOptionElementCarrier(carrier) ?? carrier;
  const protocol = rustCallableProtocol(selected);
  if (selected?.kind !== "target-named" || selected.id !== rustCallableTargetId || protocol?.lifetime === undefined ||
    protocol.error === undefined || !rustCallableInvocationSignaturesMatch(current, selected)) return undefined;
  // Its physical storage is the runtime callable over its argument tuple and fallible result.
  return rustRuntimeCallableTargetType(protocol.lifetime, protocol.parameters,
    rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([protocol.result, protocol.error])));
}

export function rustNativeStorageErasedFieldCallable(input: RustNativeStorageCarrierInput, origin: SourceStorageSubject, current: TargetTypeRef): TargetTypeRef | undefined {
  const component = origin.projection.length === 1 ? origin.projection[0] : undefined;
  if (origin.kind !== "receiver" || component?.kind !== "member") return undefined;
  const binding = input.frames.bindingFor(component.declaration);
  const declared = binding === undefined ? input.records.runtimeCarrier.get(component.declaration)?.carrier : binding.carrier;
  const carrier = rustOptionElementCarrier(declared) ?? declared;
  return carrier?.kind === "target-named" && carrier.id === rustCallableTargetId &&
    rustCallableInvocationSignaturesMatch(current, carrier) ? rustCallablePhysicalCarrier(carrier) : undefined;
}

// Binds the free type parameters of a producer signature from the destination signature it is stored at.
export function rustNativeStorageInstanceTypeBindings(producer: TargetTypeRef, destination: TargetTypeRef): ReadonlyMap<string, TargetTypeRef> | undefined {
  const source = rustCallableProtocol(producer);
  const target = rustCallableProtocol(destination);
  if (source === undefined || target === undefined || source.parameters.length !== target.parameters.length) return undefined;
  const pattern: TargetTypeRef = { kind: "tuple", elements: [...source.parameters, source.result] };
  const actual: TargetTypeRef = { kind: "tuple", elements: [...target.parameters, target.result] };
  const typeIdentities = new Set(rustTargetGenericReferences(pattern).typeIdentities);
  if (typeIdentities.size === 0) return undefined;
  const inferred = inferRustTargetGenericBindings(pattern, actual,
    { typeIdentities, lifetimeIdentities: new Set(), constIdentities: new Set() });
  return inferred === undefined || inferred.types.size !== typeIdentities.size ? undefined : inferred.types;
}

export function rustNativeStorageFrameInstanceBindings(producer: TargetTypeRef, destination: TargetTypeRef): ReadonlyMap<string, TargetTypeRef> | undefined {
  const source = rustFrameCallableValue(producer);
  const target = rustFrameCallableValue(destination);
  if (source?.owner.kind !== "class" || target?.owner.kind !== "class" ||
    closedMetadataKey(source.owner.origin) !== closedMetadataKey(target.owner.origin)) return undefined;
  const typeIdentities = new Set(rustTargetGenericReferences(producer).typeIdentities);
  if (typeIdentities.size === 0) return undefined;
  const inferred = inferRustTargetGenericBindings(producer, destination,
    { typeIdentities, lifetimeIdentities: new Set(), constIdentities: new Set() });
  return inferred === undefined || inferred.types.size !== typeIdentities.size ? undefined : inferred.types;
}
