import type { AstReader, Node } from "@tsonic/tsts";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { SourceStorageBindings, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustNativeStorageConstruction, RustNativeStorageQueries } from "../storage/native-storage.js";
import type { RustNativeStorageSelection } from "../../../target-model/records/native/native-storage.js";
import type { RustOperationAttempt } from "../../program/operation-attempts.js";
import type { RustValueDomainCarrierHost } from "../../objects/value-domain-carriers.js";
import { rustSourceStorageProjectedCarrier } from "../../objects/value-domain-carriers.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";
import { rustJsArrayLikeElementTargetType } from "../../../target-model/types/carriers/js.js";
import { rustNamedTypeCarrierValue } from "../../../target-model/types/carriers/native.js";
import { rustCallableTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustPhysicalPayloadFor } from "../../../policy/conversions/physical-payloads.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";

export function selectRustNativeCallbackParameterStorage(input: {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
  readonly carrierHost: RustValueDomainCarrierHost;
  readonly operationAttempts: Pick<WeakMap<Node, RustOperationAttempt>, "get">;
}, subject: SourceStorageSubject, bindings: SourceStorageBindings,
selectSource: (subject: SourceStorageSubject, carrier: TargetTypeRef, bindings: SourceStorageBindings) => RustNativeStorageSelection,
): RustNativeStorageSelection | undefined {
  if (subject.kind !== "input" || !input.ast.is.IsParameterDeclaration(subject.node)) return undefined;
  const owner = input.ast.parent(subject.node);
  if (owner === undefined) return undefined;
  const parameters = sourceCallableValueParameters(input.ast, owner, input.storage.source.semantics.forNode(owner));
  const index = parameters?.indexOf(subject.node);
  const unresolved = (reason: string): Extract<RustNativeStorageSelection, { readonly kind: "unresolved" }> =>
    Object.freeze({ kind: "unresolved", reason });
  if (index === undefined || index < 0) return unresolved("A native callback parameter requires its exact checked declaration slot.");
  const activations = input.storage.boundActivationsFor(owner, bindings);
  if (activations.kind === "unresolved") return activations;
  let selected: Extract<RustNativeStorageSelection, { readonly kind: "selected" }> | undefined;
  let unmapped = false;
  for (const activation of activations.activations) {
    if (activation.kind !== "declaration" || activation.nativeEntry === undefined) {
      unmapped = true;
      continue;
    }
    const entry = activation.nativeEntry;
    const attempt = input.operationAttempts.get(entry.invocation);
    if (attempt?.kind !== "checked-call" || attempt.prepared?.value.callback.parameterSources === undefined) {
      unmapped = true;
      continue;
    }
    const callback = attempt.prepared.value.callback;
    const source = callback.parameterSources?.[index];
    if (entry.argument.binding.sourceArgumentIndex !== callback.sourceArgumentIndex || source === undefined)
      return unresolved("A native callback parameter has no exact selected input-component correspondence.");
    const operation = input.records.targetOperation.get(entry.invocation);
    if (operation?.kind !== "provider-operation")
      return unresolved("A native callback parameter requires its completed selected provider ABI.");
    const expression = source.kind === "receiver" ? attempt.request.source.sourceReceiver?.expression
      : attempt.request.source.sourceArguments[source.sourceIndex]?.expression;
    const sourceInput = source.kind === "receiver" ? operation.abi.sourceReceiver
      : operation.abi.sourceArguments.find(argument => argument.sourceIndex === source.sourceIndex);
    const logical = expression === undefined ? undefined : rustEffectiveValueCarrier(input.records, expression);
    if (expression === undefined || logical === undefined || sourceInput === undefined || !("carrier" in sourceInput) ||
      sourceInput.disposition !== "runtime")
      return unresolved("A native callback parameter lost its exact runtime source input.");
    const root = input.storage.subjectFor(expression);
    if (root.kind === "unresolved") return root;
    const physical = selectSource(root.subject, logical, entry.callerBindings);
    if (physical.kind === "unresolved") return physical;
    let logicalComponent: TargetTypeRef | undefined = sourceInput.carrier;
    let physicalComponent = rustPhysicalPayloadFor(logical, physical.carrier, sourceInput.carrier, input.definitions);
    for (const component of source.projection) {
      logicalComponent = logicalComponent === undefined ? undefined : component === "array-element"
        ? rustJsArrayLikeElementTargetType(logicalComponent) : rustTargetTypeChildren(logicalComponent)[component];
      physicalComponent = physicalComponent === undefined ? undefined : component === "array-element"
        ? rustJsArrayLikeElementTargetType(physicalComponent) : rustTargetTypeChildren(physicalComponent)[component];
    }
    const abi = input.records.sourceParameterAbi.get(subject.node);
    if (logicalComponent === undefined || physicalComponent === undefined || abi === undefined ||
      !rustTargetTypeRefEquals(logicalComponent, abi.valueCarrier))
      return unresolved("A native callback parameter conflicts with its exact logical source-component identity.");
    const carrier = rustSourceStorageProjectedCarrier(input.carrierHost, { subject, bindings }, physicalComponent);
    if (carrier === undefined)
      return unresolved("A native callback parameter requires its exact projected physical component.");
    if (selected !== undefined && !rustTargetTypeRefEquals(selected.carrier, carrier))
      return unresolved("A native callback parameter has distinct physical input alternatives without a selected native contract.");
    selected = Object.freeze({ kind: "selected", carrier,
      inputs: Object.freeze([...new Set([...(selected?.inputs ?? []), ...(physical.kind === "selected" ? physical.inputs : [])])]),
      sources: Object.freeze([...new Set([...(selected?.sources ?? []), ...physical.sources])]),
      ...(rustNamedTypeCarrierValue(carrier)?.id === rustCallableTargetId ? { erased: true as const } : {}) });
  }
  if (selected !== undefined && unmapped)
    return unresolved("A native callback parameter requires exact input correspondence for every active entry.");
  return selected;
}

export function finalizeRustNativeParameterStorage(input: {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly records: RustProgramRecords;
}, queries: RustNativeStorageQueries): RustNativeStorageConstruction {
  const parameters = new Map<Node, RustNativeStorageSelection>();
  for (const node of input.nativeNodes) {
    const abi = input.records.sourceParameterAbi.get(node);
    if (abi === undefined || !input.ast.is.IsParameterDeclaration(node)) continue;
    const owner = input.ast.parent(node);
    if (owner === undefined || sourceCallableValueParameters(input.ast, owner, input.storage.source.semantics.forNode(owner))?.includes(node) !== true) continue;
    const subject = input.storage.subject(node, "input");
    parameters.set(node, subject.kind === "unresolved" ? subject
      : queries.subjectFor(subject.subject, abi.parameterCarrier, owner));
  }
  return Object.freeze({ ...queries,
    parameterFor: sealRustNativeParameterStorage(parameters).get });
}

import { sealRustNativeParameterStorage } from "../../program/records/native/native-parameters.js";
