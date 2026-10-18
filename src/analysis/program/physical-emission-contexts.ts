import type { SourceFile } from "@tsonic/tsts";
import { targetUseSiteRef, type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustInitializationErrorRecords, RustInitializerSelection, RustModuleErrorInitializer } from "../../target-model/records/error-regions.js";
import type { RustCallableEmissionContexts, RustPhysicalEmissionContext, RustPhysicalEmissionOperand,
  RustPhysicalTargetGenericArgument, RustPhysicalEmissionRole } from "../../target-model/records/physical-emission-contexts.js";
import type { RustFinalizedOperationAbi } from "../../target-model/records/finalized-operation.js";
import { selectRustNativeTypeCarrier, selectRustNativeCallTypeCarrier, rustNativeCallableAbi, type RustNativeTypeSelectionInput } from "../../policy/types/model/native-type-selection.js";
import type { RustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";
import { rustProgramErrorOwner } from "../../target-model/types/carriers/program-errors.js";
import { prepareRustCallableEmissionRequests } from "../callables/emission-context-requests.js";
import { prepareRustEmissionContextRequests, rustEmissionIdentityBindings,
  type RustCallableEmissionPreparation, type RustCallableEmissionPreparationInput, type RustEmissionContextRequest } from "../callables/emission-contexts.js";
import type { RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCallablePhysicalConversion, RustCallablePhysicalValueConversion, RustCallablePhysicalConversionPreparation,
  RustCallablePhysicalValueConversionPreparation } from "../../target-model/conversions/callable-physical.js";
import type { RustEmissionErrorContext, RustNativeStorageBinding } from "../../target-model/records/physical-emission-contexts.js";
import type { RustNativeCallableFieldBinding } from "../declarations/native-forms.js";
import { completeRustNativeCallableStorageAdapter } from "../callables/native-storage-adapters.js";
import { publishRustErrorRegion, publishRustNativeErrorSources, selectRustNativeInvocationErrorPropagation } from "../errors/regions.js";
import { publishRustInitializerSelection } from "../errors/initialization.js";

export interface RustPhysicalEmissionPreparationInput extends RustCallableEmissionPreparationInput {
  readonly sourceFiles: readonly SourceFile[];
  readonly initialization: RustInitializationErrorRecords<RustNativeErrorSource<TargetTypeRef>>;
}

export function prepareRustPhysicalEmissionContexts(
  input: RustPhysicalEmissionPreparationInput,
): TargetStageResult<RustCallableEmissionPreparation> {
  const callable = prepareRustCallableEmissionRequests(input);
  if (callable.kind === "rejected") return callable;
  const bindings = rustEmissionIdentityBindings([])!;
  const requests: RustEmissionContextRequest[] = [...callable.value];
  const modules = new Map<SourceFile, { readonly module: RustModuleErrorInitializer<RustNativeErrorSource<TargetTypeRef>>;
    readonly initializers: readonly RustInitializerSelection<RustNativeErrorSource<TargetTypeRef>>[] }>();
  for (const initializer of [input.initialization.root, ...input.initialization.workers.map(worker => worker.initializer)])
    for (const module of initializer.modules) {
      const selected = modules.get(module.sourceFile);
      if (selected !== undefined && selected.module !== module) return rejectedTargetStage([{
        code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust", sourceNode: module.sourceFile,
        message: "One source module requires its original selected initializer descriptor." }]);
      modules.set(module.sourceFile, { module, initializers: Object.freeze([...selected?.initializers ?? [], initializer]) });
    }
  for (const [sourceFile, { module, initializers }] of modules) {
    requests.push({ use: targetUseSiteRef(sourceFile, "module-initializer", module.identity), role: "module-initializer",
      specialization: Object.freeze({ kind: "ordinary" }), declaration: sourceFile,
      nativeOwnerFileName: input.ast.getFileName(sourceFile),
      source: { kind: "module", module, initializers },
      bindings, returnDestination: Object.freeze({ kind: "none" }),
      error: Object.freeze({ kind: "region", owner: sourceFile, region: module.region }), sourceCarriers: [],
      callableAdapterInputs: [], nativeCaptureInputs: [],
      physicalCarriers: module.region.sources.map(source => source.errorType),
      demands: input.emissionRequests.filter(demand => demand.owner === sourceFile) });
  }
  for (const worker of input.initialization.workers) {
    requests.push({ use: targetUseSiteRef(worker.sourceFile, "worker-initializer", input.ast.getFileName(worker.sourceFile)), role: "worker-initializer",
      specialization: Object.freeze({ kind: "ordinary" }),
      nativeOwnerFileName: input.ast.getFileName(worker.sourceFile),
      source: { kind: "worker", initializer: worker.initializer },
      declaration: worker.sourceFile, bindings, returnDestination: Object.freeze({ kind: "none" }), demands: [],
      callableAdapterInputs: [], nativeCaptureInputs: [],
      error: Object.freeze({ kind: "initializer", owner: worker.sourceFile, initializer: worker.initializer }), sourceCarriers: [],
      physicalCarriers: worker.initializer.modules.flatMap(module => module.region.sources.map(source => source.errorType)) });
  }
  return prepareRustEmissionContextRequests(input, requests);
}

export function publishRustPhysicalEmissionContexts(
  preparation: RustCallableEmissionPreparation,
  nativeTypeInputFor: (fileName: string) => RustNativeTypeSelectionInput,
  completion: { readonly fieldBindings: readonly RustNativeCallableFieldBinding[];
    readonly nativeBindings: readonly RustNativeStorageBinding[] },
): TargetStageResult<RustCallableEmissionContexts> {
  const contexts = new Map<TargetUseSiteRef, RustPhysicalEmissionContext>();
  const diagnostics: import("@tsonic/target-api/artifacts").TargetDiagnostic[] = [];
  for (const prepared of preparation.contexts.contexts) {
    const argumentsByAbi = new Map<RustFinalizedOperationAbi, readonly RustPhysicalTargetGenericArgument[]>();
    const input = nativeTypeInputFor(prepared.nativeOwnerFileName);
    const callableAdapters: RustPhysicalEmissionContext["callableAdapters"][number][] = [];
    for (const adapter of prepared.callableAdapters) {
      const completed = completeRustNativeCallableStorageAdapter(adapter, completion.fieldBindings, prepared.use);
      if (completed.kind === "rejected") { diagnostics.push(...completed.diagnostics); continue; }
      const conversion = publishRustCallablePhysicalConversion(completed.value.conversion, adapter.node, input);
      if (conversion.kind === "rejected") diagnostics.push(...conversion.diagnostics);
      else callableAdapters.push(Object.freeze({ ...completed.value, conversion: conversion.value }));
    }
    let error: RustEmissionErrorContext;
    const frameEntries: RustPhysicalEmissionContext["frameEntries"][number][] = [];
    for (const entry of prepared.frameEntries) {
      const signature = publishRustCallableNativeSignature(entry, prepared.declaration, input);
      if (signature.kind === "rejected") diagnostics.push(...signature.diagnostics);
      else frameEntries.push(Object.freeze({ entry: entry.entry, ...signature.value }));
    }
    if (prepared.error.kind === "region") {
      const region = publishRustErrorRegion(prepared.error.region, prepared.error.owner, input);
      if (region.kind === "rejected") { diagnostics.push(...region.diagnostics); continue; }
      error = Object.freeze({ ...prepared.error, region: region.value });
    } else if (prepared.error.kind === "initializer") {
      const initializer = publishRustInitializerSelection(prepared.error.initializer, sourceFile => {
        const original = preparation.contexts.contextForOwner(sourceFile, "module-initializer");
        const selected = original === undefined ? undefined : contexts.get(original.use);
        const module = prepared.error.kind === "initializer"
          ? prepared.error.initializer.modules.find(module => module.sourceFile === sourceFile) : undefined;
        return selected?.error.kind !== "region" || module === undefined ? undefined
          : Object.freeze({ ...module, region: selected.error.region });
      });
      if (initializer.kind === "rejected") { diagnostics.push(...initializer.diagnostics); continue; }
      error = Object.freeze({ ...prepared.error, initializer: initializer.value });
    } else error = prepared.error;
    for (const [abi, operation] of prepared.nativeOperations) {
      const arguments_: RustPhysicalTargetGenericArgument[] = [];
      for (const argument of operation.arguments) {
        if (argument.kind === "lifetime") continue;
        if (argument.kind === "const") { arguments_.push(argument); continue; }
        const selected = selectRustNativeCallTypeCarrier(argument.type, input);
        if (selected.kind === "rejected") {
          diagnostics.push({ code: "RUST_PROVIDER_TARGET_GENERIC_ARGUMENT_NOT_REPRESENTABLE", category: "error",
            source: "tsonic-rust", sourceNode: operation.node, message: selected.reason,
            evidence: ["target.capability=rust.native-provider.target-generic-arguments"] });
        } else arguments_.push(selected.kind === "inferred" ? Object.freeze({ kind: "infer" })
          : Object.freeze({ kind: "type", nativeCarrier: selected.carrier }));
      }
      argumentsByAbi.set(abi, Object.freeze(arguments_));
    }
    const { nativeOwnerFileName: _nativeOwnerFileName, nativeOperations: _nativeOperations,
      nativeBindingRequests: _nativeBindingRequests, ...context } = prepared;
    contexts.set(prepared.use, Object.freeze({ ...context, error, callableAdapters: Object.freeze(callableAdapters),
      nativeBindings: Object.freeze(completion.nativeBindings.filter(binding => binding.contextUse === prepared.use)),
      frameEntries: Object.freeze(frameEntries),
      targetGenericArguments: Object.freeze(argumentsByAbi) }));
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  const operands = new Map<TargetUseSiteRef, RustPhysicalEmissionOperand>();
  for (const prepared of preparation.contexts.operands) {
    const context = contexts.get(prepared.context.use);
    if (context === undefined) return rejectedTargetStage([{
      code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust",
      sourceNode: prepared.node, message: "A final native operand requires its original prepared physical context.",
    }]);
    const input = nativeTypeInputFor(prepared.context.nativeOwnerFileName);
    const sourceErrorRegions: RustPhysicalEmissionOperand["sourceErrorRegions"][number][] = [];
    for (const source of prepared.sourceErrorRegions) {
      const selection = publishRustErrorRegion(source.selection.operand, prepared.node, input);
      if (selection.kind === "rejected") diagnostics.push(...selection.diagnostics);
      else sourceErrorRegions.push(Object.freeze({ edge: source.edge,
        selection: Object.freeze({ ...source.selection, operand: selection.value }) }));
    }
    let genericInvocation: RustPhysicalEmissionOperand["genericInvocation"];
    if (prepared.genericInvocation !== undefined) {
      const invocation = publishRustNativeErrorSources(prepared.genericInvocation.invocation, prepared.node, input);
      const awaiting = publishRustNativeErrorSources(prepared.genericInvocation.awaiting, prepared.node, input);
      if (invocation.kind === "rejected") diagnostics.push(...invocation.diagnostics);
      if (awaiting.kind === "rejected") diagnostics.push(...awaiting.diagnostics);
      if (invocation.kind === "resolved" && awaiting.kind === "resolved") genericInvocation = Object.freeze({
        ...prepared.genericInvocation, invocation: invocation.value, awaiting: awaiting.value });
    }
    let nativeCallResult: RustPhysicalEmissionOperand["nativeCallResult"] = Object.freeze({ kind: "none" });
    if (prepared.nativeCallResult.kind !== "none") {
      const carrier = selectRustNativeTypeCarrier(prepared.nativeCallResult.carrier, input, "general");
      if (carrier.kind === "rejected") {
        diagnostics.push({ code: "RUST_NATIVE_CALL_RESULT_NOT_PROVEN", category: "error", source: "tsonic-rust",
          sourceNode: prepared.node, message: carrier.reason });
        continue;
      }
      let signature: RustCallablePhysicalSignature | undefined;
      if (prepared.nativeCallResult.kind === "frame") {
        const selected = publishRustCallableNativeSignature(prepared.nativeCallResult.signature, prepared.node, input);
        if (selected.kind === "rejected") { diagnostics.push(...selected.diagnostics); continue; }
        signature = selected.value;
      } else signature = rustNativeCallableAbi({ kind: "physical", carrier: carrier.carrier });
      if (signature === undefined) {
        diagnostics.push({ code: "RUST_NATIVE_CALL_RESULT_NOT_PROVEN", category: "error", source: "tsonic-rust",
          sourceNode: prepared.node, message: "A retained invocation requires its exact selected native argument tuple, result and error ABI." });
        continue;
      }
      const frameOwner = prepared.nativeCallResult.kind === "frame"
        ? rustProgramErrorOwner(prepared.nativeCallResult.signature.error) : undefined;
      if (frameOwner?.kind === "logical") {
        diagnostics.push({ code: "RUST_NATIVE_CALL_RESULT_NOT_PROVEN", category: "error", source: "tsonic-rust",
          sourceNode: prepared.node, message: "A native frame invocation requires its actual defining physical error owner." });
        continue;
      }
      const propagation = selectRustNativeInvocationErrorPropagation(prepared.node, signature.error,
        context.error, sourceErrorRegions, frameOwner, input);
      if (propagation.kind === "rejected") { diagnostics.push(...propagation.diagnostics); continue; }
      nativeCallResult = Object.freeze({ kind: "result", nativeCarrier: carrier.carrier, signature, propagation: propagation.value });
    }
    operands.set(prepared.use, Object.freeze({ ...prepared, context, sourceErrorRegions: Object.freeze(sourceErrorRegions),
      genericInvocation, nativeCallResult }));
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  return resolvedTargetStage(Object.freeze({ ...preparation.contexts,
    contexts: Object.freeze([...contexts.values()]), operands: Object.freeze([...operands.values()]),
    contextFor: (use: TargetUseSiteRef) => contexts.get(use),
    contextForOwner: (subject: object, role: RustPhysicalEmissionRole) => {
      const prepared = preparation.contexts.contextForOwner(subject, role);
      return prepared === undefined ? undefined : contexts.get(prepared.use);
    },
    bodyContextFor: (enclosingUse: TargetUseSiteRef, declaration: import("@tsonic/tsts").Node) => {
      const prepared = preparation.contexts.bodyContextFor(enclosingUse, declaration);
      return prepared === undefined ? undefined : contexts.get(prepared.use);
    },
    operandFor: (use: TargetUseSiteRef) => operands.get(use),
    sourceErrorOperandFor: (use: TargetUseSiteRef, node: import("@tsonic/tsts").Node) => {
      const prepared = preparation.contexts.sourceErrorOperandFor(use, node);
      return prepared === undefined ? undefined : operands.get(prepared.use);
    },
  }));
}

function publishRustCallableNativeSignature(
  signature: RustCallablePhysicalSignature,
  node: import("@tsonic/tsts").Node,
  input: RustNativeTypeSelectionInput,
): TargetStageResult<RustCallablePhysicalSignature> {
  const diagnostics: import("@tsonic/target-api/artifacts").TargetDiagnostic[] = [];
  const parameters: TargetTypeRef[] = [];
  const reject = (reason: string): void => {
    diagnostics.push({ code: "RUST_FRAME_CALLABLE_ABI_NOT_PROVEN", category: "error", source: "tsonic-rust",
      sourceNode: node, message: reason, evidence: ["target.capability=rust.callable-value.exact-implementation"] });
  };
  for (const parameter of signature.parameters) {
    const selected = selectRustNativeTypeCarrier(parameter, input, "general");
    if (selected.kind === "rejected") reject(selected.reason);
    else parameters.push(selected.carrier);
  }
  const result = selectRustNativeTypeCarrier(signature.result, input, "general");
  const error = selectRustNativeTypeCarrier(signature.error, input, "general");
  if (result.kind === "rejected") reject(result.reason);
  if (error.kind === "rejected") reject(error.reason);
  if (diagnostics.length !== 0 || result.kind === "rejected" || error.kind === "rejected") return rejectedTargetStage(diagnostics);
  return resolvedTargetStage(Object.freeze({ parameters: Object.freeze(parameters), result: result.carrier, error: error.carrier }));
}

export function publishRustCallablePhysicalConversion(
  prepared: RustCallablePhysicalConversionPreparation,
  node: import("@tsonic/tsts").Node,
  input: RustNativeTypeSelectionInput,
): TargetStageResult<RustCallablePhysicalConversion<RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }>> {
  type Part = RustCallablePhysicalValueConversion<RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }>;
  const part = (selected: RustCallablePhysicalValueConversionPreparation): TargetStageResult<Part> => {
    if (selected.kind !== "callable") return resolvedTargetStage(selected);
    const conversion = publishRustCallablePhysicalConversion(selected.conversion, node, input);
    return conversion.kind === "rejected" ? conversion : resolvedTargetStage(Object.freeze({ ...selected, conversion: conversion.value }));
  };
  const arguments_: Part[] = [];
  for (const selected of prepared.arguments) {
    const value = part(selected);
    if (value.kind === "rejected") return value;
    arguments_.push(value.value);
  }
  const result = part(prepared.resultPlan);
  if (result.kind === "rejected") return result;
  const errors = publishRustNativeErrorSources(prepared.errors, node, input);
  if (errors.kind === "rejected") return errors;
  const native = selectRustNativeTypeCarrier(prepared.error, input, "general");
  return native.kind === "rejected" ? rejectedTargetStage([{
    code: "RUST_NATIVE_ERROR_PAYLOAD_NOT_REPRESENTABLE", category: "error", source: "tsonic-rust",
    sourceNode: node, message: native.reason, evidence: ["target.capability=rust.native-error-payload"],
  }]) : resolvedTargetStage(Object.freeze({ ...prepared, nativeErrorType: native.carrier,
    arguments: Object.freeze(arguments_), resultPlan: result.value, errors: errors.value }));
}
