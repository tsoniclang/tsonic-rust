import type { Node } from "@tsonic/tsts";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { SourceStorageBindings, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustCallableConversion } from "../../target-model/conversions/callable.js";
import type { RustCallablePhysicalAdapter, RustCallableValueAdapter } from "../../target-model/records/callable-adapters.js";
import { rustCallableConversionPhysical, rustCallablePhysicalSignature, type RustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";
import { substituteRustCallableConversion } from "../../target-model/conversions/substitution.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { rustCallableInvocationSignaturesMatch } from "../../target-model/conversions/callable-input.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustCallableTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { isRustAbsenceCarrier } from "../../target-model/types/carriers/native.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustPhysicalPayloadFor } from "../../target-model/types/physical-payloads.js";
import { rustLifetimeOutlives } from "../../target-model/lifetimes/index.js";
import { rustEnclosingStorageContract } from "../../policy/ownership/suspended-storage.js";
import { rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";
import { rustNativeCallablePhysicalSource } from "./native-conversions.js";
import { rustNativeCallableAbi } from "../../policy/types/model/native-type-selection.js";
import { rustCallableInvocationResult } from "./results.js";
import { selectRustSourceMethodInvocation, type RustNativeStorageGenericSelection } from "./native-storage-generics.js";
import { rustStructuralMethodConstructionFor } from "./structural-method-storage.js";
import type { RustNativeCallableInput } from "./native-inputs.js";
import type { RustCallablePhysicalAdapterPreparation, RustNativeStorageQueryInput, RustNativeStorageSelection } from "./native-storage.js";

type RustNativeCallableStorageVisitor = (current: TargetTypeRef, selectedSubject: SourceStorageSubject,
  bindings: SourceStorageBindings, depth: number, permitsAbsence: boolean, position?: "value" | "input") => TargetTypeRef | undefined;

export function createRustNativeCallableStorageSelection(input: RustNativeStorageQueryInput & {
  readonly visit: RustNativeCallableStorageVisitor;
  readonly ownerFor: (node: Node) => Node | undefined;
  readonly genericsFor: (declaration: Node | undefined, bindings: SourceStorageBindings, depth: number) => RustNativeStorageGenericSelection;
  readonly logicalCarrierFor: (subject: SourceStorageSubject, bindings: SourceStorageBindings) => TargetTypeRef | undefined;
  readonly step: (depth: number) => boolean;
  readonly fail: (message: string) => undefined;
  readonly formalCarrier: (candidate: RustNativeCallableInput, current: TargetTypeRef) => TargetTypeRef | undefined;
  readonly selectedInputs: Set<RustNativeCallableInput>;
  readonly callableAdapters: RustCallablePhysicalAdapterPreparation[];
  readonly inputs: ReadonlyMap<SourceStorageSubject, RustNativeCallableInput>;
  readonly boundaries: readonly SourceStorageSubject[];
  readonly boundaryFailure: string | undefined;
}): RustNativeCallableStorageVisitor {
  const { visit, ownerFor, genericsFor, logicalCarrierFor, step, fail, formalCarrier,
    selectedInputs, callableAdapters, inputs, boundaries, boundaryFailure } = input;
  const physicalAdapter = (node: Node, selection: RustCallableConversion, conversion: RustCallableConversion,
    origin: Extract<RustCallablePhysicalAdapter["origin"], { readonly kind: "expression" | "return" }>, source: NonNullable<ReturnType<typeof rustNativeCallablePhysicalSource>>,
    nativeOwnerFileName: string): TargetTypeRef | undefined => {
    const physical = rustCallableConversionPhysical(conversion, source.signature, nativeOwnerFileName,
      input.definitions, rustCallablePhysicalSignature);
    if (physical === undefined) return fail("Native callable conversion storage has no exact physical adaptation contract.");
    const previous = callableAdapters.find(adapter => adapter.node === node && adapter.selection === selection);
    if (previous !== undefined && (previous.sourceInput !== source.input?.subject ||
      !(previous.origin.kind === "expression" && origin.kind === "expression" && previous.origin.subject === origin.subject ||
        previous.origin.kind === "return" && origin.kind === "return" && previous.origin.declaration === origin.declaration) || !rustTargetTypeRefEquals(previous.sourceCarrier, source.carrier) ||
      !closedMetadataEquals(previous.conversion, physical)))
      return fail("One native callable adapter requires its exact single selected physical source and conversion.");
    if (previous === undefined) callableAdapters.push(Object.freeze({ node, selection, origin,
      joinOwnerFileName: nativeOwnerFileName, sourceCarrier: source.carrier, sourceInput: source.input?.subject, conversion: physical }));
    return physical.carrier;
  };
  const helperValue = (node: Node, adapter: RustCallableValueAdapter, physical: TargetTypeRef,
    origin: Extract<RustCallablePhysicalAdapter["origin"], { readonly kind: "return" }>,
    nativeOwnerFileName: string, bindings: RustTargetGenericBindings, depth: number): TargetTypeRef | undefined => {
    if (!step(depth)) return undefined;
    const apply = (carrier: TargetTypeRef): TargetTypeRef => substituteRustTargetGenerics(carrier,
      bindings.types, bindings.lifetimes, bindings.consts);
    if (adapter.kind === "identity" || adapter.kind === "call-scoped-lifetime") return physical;
    if (adapter.kind === "option-some" || adapter.kind === "option-map") {
      const source = adapter.kind === "option-map" ? rustOptionElementCarrier(physical) : physical;
      const target = apply(adapter.targetCarrier);
      const selected = source === undefined ? undefined : helperValue(node, adapter.element, source, origin, nativeOwnerFileName, bindings, depth + 1);
      if (selected === undefined || target.kind !== "target-named" || rustOptionElementCarrier(target) === undefined)
        return fail("A native helper result requires its exact selected optional source and destination payload.");
      return Object.freeze({ ...target, genericArguments: Object.freeze([Object.freeze({ kind: "type" as const, type: selected })]) });
    }
    if (adapter.kind !== "conversion" || adapter.conversion.kind !== "callable-adapter")
      return fail("A callable-bearing native helper result requires its original admitted adapter contract.");
    const conversion = substituteRustCallableConversion(adapter.conversion, bindings.types, bindings.lifetimes, bindings.consts);
    const source = rustNativeCallablePhysicalSource(conversion.source,
      { kind: "selected", carrier: physical, inputs: [...selectedInputs] }, input.definitions, apply);
    return source === undefined ? fail("A native helper result has no exact original physical source signature.")
      : physicalAdapter(node, adapter.conversion, conversion, origin, source, nativeOwnerFileName);
  };
  const methodResult = (origin: SourceStorageSubject, bindings: SourceStorageBindings,
    current: TargetTypeRef, depth: number): TargetTypeRef | undefined => {
    const caller = genericsFor(ownerFor(origin.node), bindings, depth + 1);
    if (caller.kind === "unresolved") return fail(caller.reason);
    const selected = selectRustSourceMethodInvocation({ ...input, logicalCarrierFor }, origin.node, bindings, caller.bindings);
    if (selected?.kind !== "resolved") return fail(selected?.diagnostics[0]?.message ??
      "A native method result requires its original checked dispatch and helper adaptation.");
    let result: TargetTypeRef | undefined;
    for (const row of selected.value) {
      const logical = rustCallableInvocationResult(input.records, row.body.declaration);
      const subject = input.storage.subject(row.body.declaration, "return");
      if (logical === undefined || subject.kind !== "resolved")
        return fail("A native helper result requires its original implementation return subject and logical ABI.");
      const { types, lifetimes, consts } = row.implementationBindings;
      const physical = visit(substituteRustTargetGenerics(logical, types, lifetimes, consts), subject.subject,
        row.activation, depth + 1, false);
      const adapted = physical === undefined ? undefined : helperValue(row.adapter.contract, row.adapter.resultAdapter, physical,
        Object.freeze({ kind: "return", declaration: row.body.declaration }), row.body.concrete.fileName, row.receiverBindings, depth + 1);
      const target = substituteRustTargetGenerics(row.adapter.returnCarrier, row.receiverBindings.types,
        row.receiverBindings.lifetimes, row.receiverBindings.consts);
      const payload = adapted === undefined ? undefined : rustPhysicalPayloadFor(target, adapted, current, input.definitions);
      if (payload === undefined) return fail("A native helper result lost its exact selected contract payload.");
      if (result !== undefined && !rustTargetTypeRefEquals(result, payload))
        return fail("A native method result has distinct actual physical helper alternatives requiring a sealed join.");
      result = payload;
    }
    return result ?? fail("A native method result has no exact selected helper activation.");
  };

  return (current, selectedSubject, bindings, depth, permitsAbsence, position = "value") => {
    if (boundaryFailure !== undefined) return fail(boundaryFailure);
    const selected = input.storage.boundValueFrontierFor(selectedSubject, bindings, boundaries, position);
    if (selected.kind === "unresolved") return fail(selected.reason);
    const destinationLifetime = rustCallableProtocol(current)?.lifetime;
    const contract = rustEnclosingStorageContract(selectedSubject.node, input.ast, input.lifetimes);
    let physical: TargetTypeRef | undefined;
    for (const frontier of selected.frontier) {
      if (!step(depth)) return undefined;
      const origin = frontier.subject;
      let candidatePhysical: TargetTypeRef | undefined;
      if (frontier.kind === "boundary") {
        const operation = input.records.targetOperation.get(origin.node);
        if (origin.projection.length === 0 && operation?.kind === "source-call" && operation.target.form === "method" &&
          operation.target.dispatch !== undefined && input.records.contextualValueConversion.get(origin.node)?.conversion.kind !== "callable-adapter") {
          candidatePhysical = methodResult(origin, frontier.bindings, current, depth + 1);
          if (candidatePhysical === undefined) return undefined;
        } else {
        const fact = input.records.contextualValueConversion.get(origin.node);
        if (origin.projection.length !== 0 || fact?.conversion.kind !== "callable-adapter" ||
          !rustTargetTypeRefEquals(fact.sourceCarrier, rustValueCarrierBeforeContextualConversion(input.records, origin.node)))
          return fail("Native callable conversion storage requires its exact finalized source and destination contract.");
        const generics = genericsFor(ownerFor(origin.node), frontier.bindings, depth + 1);
        if (generics.kind === "unresolved") return fail(generics.reason);
        const { types, lifetimes, consts } = generics.bindings;
        const conversion = substituteRustCallableConversion(fact.conversion, types, lifetimes, consts);
        const target = callableValueCarrier(conversion.target);
        if (target === undefined || !rustCallableInvocationSignaturesMatch(current, target))
          return fail("Native callable conversion storage conflicts with its selected activation signature.");
        const operand = visit(conversion.source, origin, frontier.bindings, depth + 1, false, "input");
        const physicalInputs = operand === undefined ? [] : [...selectedInputs].filter(candidate =>
          rustTargetTypeRefEquals(candidate.implementation, operand));
        const sourceCarrier = physicalInputs.length === 0 ? conversion.source : physicalInputs.length === 1 &&
          rustCallableInvocationSignaturesMatch(conversion.source, physicalInputs[0]!.carrier)
          ? physicalInputs[0]!.carrier : undefined;
        const source = operand === undefined || sourceCarrier === undefined ? undefined : rustNativeCallablePhysicalSource(sourceCarrier,
          { kind: "selected", carrier: operand, inputs: [...selectedInputs] }, input.definitions,
          carrier => substituteRustTargetGenerics(carrier, types, lifetimes, consts));
        const file = input.ast.getSourceFile(origin.node);
        if (source === undefined || file === undefined)
          return fail("Native callable conversion storage has no exact physical adaptation contract.");
        candidatePhysical = physicalAdapter(origin.node, fact.conversion, conversion,
          Object.freeze({ kind: "expression", subject: origin }), source, input.ast.getFileName(file));
        if (candidatePhysical === undefined) return undefined;
        }
      } else {
        const candidate = inputs.get(origin);
        if (candidate !== undefined) candidatePhysical = formalCarrier(candidate, current);
        else {
          const originCarrier = origin.projection.length === 0
            ? input.records.receiverIndependentMethod.get(origin.node)?.carrier ?? input.records.runtimeCarrier.get(origin.node)?.carrier
            : undefined;
          if (permitsAbsence && isRustAbsenceCarrier(originCarrier)) continue;
          const generics = genericsFor(sourceEnclosingCallable(input.ast.parent(origin.node), input.ast), frontier.bindings, depth + 1);
          if (generics.kind === "unresolved") return fail(generics.reason);
          const { types, lifetimes, consts } = generics.bindings;
          const boundCarrier = originCarrier === undefined ? undefined
            : callableValueCarrier(substituteRustTargetGenerics(originCarrier, types, lifetimes, consts));
          const construction = rustStructuralMethodConstructionFor(origin.node, input);
          if (construction.kind === "unresolved") return fail(construction.reason);
          const produced = originCarrier === undefined || boundCarrier === undefined || !rustCallableInvocationSignaturesMatch(current, boundCarrier)
            ? undefined : construction.kind === "selected" ? construction.carrier : input.producers.physicalFor(origin.node, originCarrier);
          candidatePhysical = produced === undefined ? undefined : substituteRustTargetGenerics(produced, types, lifetimes, consts);
        }
        if (candidatePhysical === undefined)
          return fail("Native callable storage has a producer without a sealed physical implementation.");
      }
      if (candidatePhysical.kind === "target-named" && candidatePhysical.id === rustCallableTargetId &&
        destinationLifetime !== undefined && destinationLifetime.kind !== "placeholder") {
        const sourceLifetime = candidatePhysical.genericArguments?.[0];
        if (sourceLifetime?.kind !== "lifetime" ||
          !rustLifetimeOutlives(sourceLifetime.lifetime, destinationLifetime, contract))
          return fail("Native callable storage cannot retain a producer beyond its selected destination lifetime.");
        candidatePhysical = Object.freeze({ ...candidatePhysical, genericArguments: Object.freeze([
          Object.freeze({ kind: "lifetime" as const, lifetime: destinationLifetime }),
          ...candidatePhysical.genericArguments!.slice(1),
        ]) });
      }
      if (physical !== undefined && !rustTargetTypeRefEquals(physical, candidatePhysical))
        return fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
      physical = candidatePhysical;
    }
    return physical ?? fail("Native callable storage has no selected physical input implementation.");
  };
}

export function prepareRustNativeCallableStorageAdapter(input: Pick<RustNativeStorageQueryInput,
  "ast" | "records" | "definitions" | "parameterFor"> & {
    readonly nodes: ReadonlySet<Node>;
    readonly returnFor: (declaration: Node) => RustNativeStorageSelection;
  }, node: Node, conversion: RustCallableConversion,
  origin: Exclude<RustCallablePhysicalAdapter["origin"], { readonly kind: "expression" }>,
  bindings: RustTargetGenericBindings, nativeOwnerFileName: string): TargetStageResult<RustCallablePhysicalAdapterPreparation> {
  const reject = (message: string): TargetStageResult<RustCallablePhysicalAdapterPreparation> => rejectedTargetStage([{
    code: "RUST_NATIVE_CALLABLE_ADAPTER_NOT_PROVEN", category: "error", source: "tsonic-rust", sourceNode: node,
    message, evidence: ["target.capability=rust.callable-value.exact-implementation"],
  }]);
  if (!input.nodes.has(node) || origin.kind === "return" && !input.nodes.has(origin.declaration))
    return reject("A generated callable adaptation requires its original checked helper and selected ABI slot.");
  const sourceFile = input.ast.getSourceFile(node);
  if (sourceFile === undefined || nativeOwnerFileName.length === 0)
    return reject("A generated callable adaptation requires its exact source join owner and native emission owner.");
  const apply = (carrier: TargetTypeRef): TargetTypeRef => substituteRustTargetGenerics(carrier,
    bindings.types, bindings.lifetimes, bindings.consts);
  const selected = substituteRustCallableConversion(conversion, bindings.types, bindings.lifetimes, bindings.consts);
  let source: ReturnType<typeof rustNativeCallablePhysicalSource>;
  let sourceSignatureFor: (carrier: TargetTypeRef) => RustCallablePhysicalSignature | undefined;
  if (origin.kind === "return") {
    const logical = rustCallableInvocationResult(input.records, origin.declaration);
    const returned = input.returnFor(origin.declaration);
    if (logical === undefined || returned === undefined || returned.kind === "unresolved")
      return reject("A generated result adaptation requires its exact already-prepared implementation return ABI.");
    const physical = rustPhysicalPayloadFor(apply(logical), apply(returned.carrier), selected.source, input.definitions);
    if (physical === undefined) return reject("A generated result adaptation lost its exact bound physical return payload.");
    source = rustNativeCallablePhysicalSource(selected.source,
      { kind: "selected", carrier: physical, inputs: returned.kind === "identity" ? [] : returned.inputs }, input.definitions, apply);
    sourceSignatureFor = rustCallablePhysicalSignature;
  } else if (origin.kind === "parameter" && origin.source.kind === "original-formal") {
    const parameter = origin.source.parameter;
    const abi = input.records.sourceParameterAbi.get(parameter);
    const parameterStorage = input.parameterFor(parameter);
    if (!input.ast.parameters(node).includes(parameter) || abi === undefined ||
      abi.form !== origin.abi.form || abi.mode !== origin.abi.mode ||
      !rustTargetTypeRefEquals(apply(abi.valueCarrier), apply(origin.abi.valueCarrier)) ||
      !rustTargetTypeRefEquals(apply(abi.parameterCarrier), apply(origin.abi.parameterCarrier)) ||
      parameterStorage.kind === "unresolved")
      return reject("A generated dispatch adaptation requires its exact original contract formal and prepared parameter ABI.");
    const physical = rustPhysicalPayloadFor(apply(abi.parameterCarrier), apply(parameterStorage.carrier),
      selected.source, input.definitions);
    if (physical === undefined) return reject("A generated dispatch adaptation lost its exact physical formal payload.");
    source = rustNativeCallablePhysicalSource(selected.source,
      { kind: "selected", carrier: physical, inputs: parameterStorage.kind === "identity" ? [] : parameterStorage.inputs },
      input.definitions, apply);
    sourceSignatureFor = rustCallablePhysicalSignature;
  } else if (origin.kind === "field") {
    return reject("A generated field adaptation requires its original selected final native field ABI and exact emission context.");
  } else {
    if (origin.kind !== "parameter" || origin.source.kind !== "generated-abi")
      return reject("A generated callable input requires its explicitly selected generated ABI role.");
      const signature = rustNativeCallableAbi({ kind: "logical", carrier: selected.source });
    if (signature === undefined) return reject("A generated input or field adaptation requires its selected native callable ABI contract.");
    source = { carrier: selected.source,
      signature: Object.freeze({ parameters: signature.parameters, result: signature.result, error: signature.error }) };
    sourceSignatureFor = carrier => {
        const nested = rustNativeCallableAbi({ kind: "logical", carrier });
      return nested === undefined ? undefined : Object.freeze({
        parameters: nested.parameters, result: nested.result, error: nested.error });
    };
  }
  if (source === undefined) return reject("A generated callable adaptation has no exact selected physical source signature.");
  const physical = rustCallableConversionPhysical(selected, source.signature, nativeOwnerFileName,
    input.definitions, sourceSignatureFor);
  return physical === undefined ? reject("A generated callable adaptation has no complete bound physical conversion.")
    : resolvedTargetStage(Object.freeze({ node, selection: conversion, origin, joinOwnerFileName: nativeOwnerFileName,
      sourceCarrier: source.carrier, sourceInput: source.input?.subject, conversion: physical }));
}

function callableValueCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier === undefined ? undefined : rustOptionElementCarrier(carrier) ?? carrier;
}
