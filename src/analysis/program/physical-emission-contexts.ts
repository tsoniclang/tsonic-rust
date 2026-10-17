import type { SourceFile } from "@tsonic/tsts";
import { targetUseSiteRef, type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustInitializationErrorRecords, RustInitializerSelection, RustModuleErrorInitializer } from "../../target-model/records/error-regions.js";
import type { RustCallableEmissionContexts, RustPhysicalEmissionContext, RustPhysicalEmissionOperand,
  RustPhysicalTargetGenericArgument, RustPhysicalEmissionRole } from "../../target-model/records/physical-emission-contexts.js";
import type { RustFinalizedOperationAbi } from "../../target-model/records/finalized-operation.js";
import { selectRustNativeTypeCarrier, selectRustNativeCallTypeCarrier, type RustNativeTypeSelectionInput } from "../../policy/types/model/native-type-selection.js";
import { prepareRustCallableEmissionRequests, prepareRustEmissionContextRequests, rustEmissionIdentityBindings,
  type RustCallableEmissionPreparation, type RustCallableEmissionPreparationInput, type RustEmissionContextRequest } from "../callables/emission-contexts.js";
import type { RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCallablePhysicalConversion, RustCallablePhysicalValueConversion, RustCallablePhysicalConversionPreparation,
  RustCallablePhysicalValueConversionPreparation } from "../../target-model/conversions/callable-physical.js";
import type { RustEmissionErrorContext } from "../../target-model/records/physical-emission-contexts.js";
import { publishRustErrorRegion, publishRustNativeErrorSources } from "../errors/regions.js";
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
      physicalCarriers: module.region.sources.map(source => source.errorType),
      demands: input.emissionRequests.filter(demand => demand.owner === sourceFile) });
  }
  for (const worker of input.initialization.workers) {
    requests.push({ use: targetUseSiteRef(worker.sourceFile, "worker-initializer", input.ast.getFileName(worker.sourceFile)), role: "worker-initializer",
      specialization: Object.freeze({ kind: "ordinary" }),
      nativeOwnerFileName: input.ast.getFileName(worker.sourceFile),
      source: { kind: "worker", initializer: worker.initializer },
      declaration: worker.sourceFile, bindings, returnDestination: Object.freeze({ kind: "none" }), demands: [],
      error: Object.freeze({ kind: "initializer", owner: worker.sourceFile, initializer: worker.initializer }), sourceCarriers: [],
      physicalCarriers: worker.initializer.modules.flatMap(module => module.region.sources.map(source => source.errorType)) });
  }
  return prepareRustEmissionContextRequests(input, requests);
}

export function publishRustPhysicalEmissionContexts(
  preparation: RustCallableEmissionPreparation,
  nativeTypeInputFor: (fileName: string) => RustNativeTypeSelectionInput,
): TargetStageResult<RustCallableEmissionContexts> {
  const contexts = new Map<TargetUseSiteRef, RustPhysicalEmissionContext>();
  const diagnostics: import("@tsonic/target-api/artifacts").TargetDiagnostic[] = [];
  for (const prepared of preparation.contexts.contexts) {
    const argumentsByAbi = new Map<RustFinalizedOperationAbi, readonly RustPhysicalTargetGenericArgument[]>();
    const input = nativeTypeInputFor(prepared.nativeOwnerFileName);
    let error: RustEmissionErrorContext;
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
    const { nativeOwnerFileName: _nativeOwnerFileName, nativeOperations: _nativeOperations, ...context } = prepared;
    contexts.set(prepared.use, Object.freeze({ ...context, error, targetGenericArguments: Object.freeze(argumentsByAbi) }));
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
    const callableAdapters: RustPhysicalEmissionOperand["callableAdapters"][number][] = [];
    for (const adapter of prepared.callableAdapters) {
      const conversion = publishRustCallablePhysicalConversion(adapter.conversion, prepared.node, input);
      if (conversion.kind === "rejected") diagnostics.push(...conversion.diagnostics);
      else callableAdapters.push(Object.freeze({ ...adapter, conversion: conversion.value }));
    }
    operands.set(prepared.use, Object.freeze({ ...prepared, context, sourceErrorRegions: Object.freeze(sourceErrorRegions),
      genericInvocation, callableAdapters: Object.freeze(callableAdapters) }));
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
