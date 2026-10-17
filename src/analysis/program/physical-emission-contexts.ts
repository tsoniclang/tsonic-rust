import type { SourceFile } from "@tsonic/tsts";
import { targetUseSiteRef, type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustInitializationErrorRecords, RustInitializerSelection, RustModuleErrorInitializer } from "../../target-model/records/error-regions.js";
import type { RustCallableEmissionContexts, RustEmissionProviderOperation, RustPhysicalEmissionContext,
  RustPhysicalEmissionOperand, RustPhysicalTargetGenericArgument } from "../../target-model/records/physical-emission-contexts.js";
import type { RustFinalizedOperationAbi } from "../../target-model/records/finalized-operation.js";
import { selectRustNativeCallTypeCarrier, type RustNativeTypeSelectionInput } from "../../policy/types/model/native-type-selection.js";
import type { Node } from "@tsonic/tsts";
import { prepareRustCallableEmissionContexts, prepareRustEmissionContextRequests, rustEmissionIdentityBindings,
  type RustCallableEmissionPreparation, type RustCallableEmissionPreparationInput, type RustEmissionContextRequest,
  type RustPhysicalEmissionContextPreparation, type RustPhysicalEmissionOperandPreparation } from "../callables/emission-contexts.js";

export interface RustPhysicalEmissionPreparationInput extends RustCallableEmissionPreparationInput {
  readonly sourceFiles: readonly SourceFile[];
  readonly initialization: RustInitializationErrorRecords;
}

export function prepareRustPhysicalEmissionContexts(
  input: RustPhysicalEmissionPreparationInput,
): TargetStageResult<RustCallableEmissionPreparation> {
  const callable = prepareRustCallableEmissionContexts(input);
  if (callable.kind === "rejected") return callable;
  const bindings = rustEmissionIdentityBindings([])!;
  const requests: RustEmissionContextRequest[] = [];
  const modules = new Map<SourceFile, { readonly module: RustModuleErrorInitializer;
    readonly initializers: readonly RustInitializerSelection[] }>();
  for (const initializer of [input.initialization.root, ...input.initialization.workers.map(worker => worker.initializer)])
    for (const module of initializer.modules) {
      const selected = modules.get(module.sourceFile);
      if (selected !== undefined && selected.module !== module) return rejectedTargetStage([{
        code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust", sourceNode: module.sourceFile,
        message: "One source module requires its original selected initializer descriptor." }]);
      modules.set(module.sourceFile, { module, initializers: Object.freeze([...selected?.initializers ?? [], initializer]) });
    }
  for (const [sourceFile, { module, initializers }] of modules) {
    requests.push({ use: targetUseSiteRef(sourceFile, "module-initializer", module.identity), declaration: sourceFile,
      nativeOwnerFileName: input.ast.getFileName(sourceFile),
      source: { kind: "module", module, initializers },
      bindings, returnDestination: Object.freeze({ kind: "none" }),
      error: Object.freeze({ kind: "region", owner: sourceFile, region: module.region }), sourceCarriers: [],
      physicalCarriers: module.region.sources.map(source => source.errorType),
      demands: input.emissionRequests.filter(demand => demand.owner === sourceFile) });
  }
  for (const worker of input.initialization.workers) {
    requests.push({ use: targetUseSiteRef(worker.sourceFile, "worker-initializer", input.ast.getFileName(worker.sourceFile)),
      nativeOwnerFileName: input.ast.getFileName(worker.sourceFile),
      source: { kind: "worker", initializer: worker.initializer },
      declaration: worker.sourceFile, bindings, returnDestination: Object.freeze({ kind: "none" }), demands: [],
      error: Object.freeze({ kind: "initializer", owner: worker.sourceFile, initializer: worker.initializer }), sourceCarriers: [],
      physicalCarriers: worker.initializer.modules.flatMap(module => module.region.sources.map(source => source.errorType)) });
  }
  const initialization = prepareRustEmissionContextRequests(input, requests);
  if (initialization.kind === "rejected") return initialization;
  const parts = [callable.value, initialization.value];
  const contexts = parts.flatMap(part => part.contexts.contexts);
  const operands = parts.flatMap(part => part.contexts.operands);
  const contextIndex = new Map<TargetUseSiteRef, RustPhysicalEmissionContextPreparation>();
  const operandIndex = new Map<TargetUseSiteRef, RustPhysicalEmissionOperandPreparation>();
  const owners = new Map<TargetUseSiteRef, RustCallableEmissionPreparation>();
  for (const part of parts) {
    for (const context of part.contexts.contexts) {
      if (contextIndex.has(context.use)) return rejectedTargetStage([{ code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED",
        category: "error", source: "tsonic-rust", sourceNode: context.declaration,
        message: "One physical emission use has more than one canonical owner." }]);
      contextIndex.set(context.use, context);
      owners.set(context.use, part);
    }
    for (const operand of part.contexts.operands) {
      operandIndex.set(operand.use, operand);
      owners.set(operand.use, part);
    }
  }
  return resolvedTargetStage(Object.freeze({
    physicalOperands: Object.freeze([...new Set(parts.flatMap(part => part.physicalOperands))]),
    contexts: Object.freeze({ contexts: Object.freeze(contexts), operands: Object.freeze(operands), sourceOccurrences: input.sourceOccurrences,
      contextFor: (use: TargetUseSiteRef) => contextIndex.get(use),
      operandFor: (use: TargetUseSiteRef) => operandIndex.get(use),
      carrierFor: (use: TargetUseSiteRef, carrier: Parameters<RustCallableEmissionPreparation["contexts"]["carrierFor"]>[1]) =>
        owners.get(use)?.contexts.carrierFor(use, carrier),
      sourceOriginFor: (use: TargetUseSiteRef, occurrence: Parameters<RustCallableEmissionPreparation["contexts"]["sourceOriginFor"]>[1]) =>
        owners.get(use)?.contexts.sourceOriginFor(use, occurrence),
      sourceFor: (node: Node, operation: RustEmissionProviderOperation) => callable.value.contexts.sourceFor(node, operation) }),
  }));
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
    contexts.set(prepared.use, Object.freeze({ ...context, targetGenericArguments: Object.freeze(argumentsByAbi) }));
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  const operands = new Map<TargetUseSiteRef, RustPhysicalEmissionOperand>();
  for (const prepared of preparation.contexts.operands) {
    const context = contexts.get(prepared.context.use);
    if (context === undefined) return rejectedTargetStage([{
      code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust",
      sourceNode: prepared.node, message: "A final native operand requires its original prepared physical context.",
    }]);
    operands.set(prepared.use, Object.freeze({ ...prepared, context }));
  }
  return resolvedTargetStage(Object.freeze({ ...preparation.contexts,
    contexts: Object.freeze([...contexts.values()]), operands: Object.freeze([...operands.values()]),
    contextFor: (use: TargetUseSiteRef) => contexts.get(use),
    operandFor: (use: TargetUseSiteRef) => operands.get(use),
  }));
}
