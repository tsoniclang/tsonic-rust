import type { AstReader, Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { createSourceOwnershipQuery, createSourceStorageBudget, defaultSourceStorageLimits,
  type SourceOwnershipPremises, type SourceOwnershipUnresolved, type SourceRetentionSelection,
  type SourceStorageBindings, type SourceStorageQueries, type SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceExpressionResultDisposition, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustPromiseResult, RustPromiseResults, RustPromiseResultUses } from "../../target-model/records/promise-results.js";
import { mapRustAwaitSelection, rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/index.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustLifetimesEqual, type RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import { classifyCarrierRequirements, rustFinalContractSupportsStatic,
  type RustStaticRequirementEvidence } from "../declarations/generic-carrier-requirements.js";
import type { AnalyzeRustDeclarationGenericRequirementsResult, RustGenericRequirement } from "../declarations/generic-requirements.js";
import { rustEnclosingStorageContract } from "../../policy/ownership/suspended-storage.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";

export function analyzeRustPromiseResultUses(ast: AstReader, nodes: readonly Node[]): RustPromiseResultUses {
  return new Map(nodes.filter(node => ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node))
    .map(node => [node, sourceExpressionResultDisposition(ast, node)]));
}

export function analyzeRustPromiseResults(input: {
  readonly ast: AstReader;
  readonly source: TargetSourceProgram;
  readonly storage: SourceStorageQueries;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly uses: RustPromiseResultUses;
  readonly definitions: RustTypeDefinitions;
  readonly nativeStorage: RustNativeStoragePlan;
  readonly native: Pick<RustNativeCallableInputPlan, "callFor">;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly requirements: AnalyzeRustDeclarationGenericRequirementsResult;
  readonly retentionIssues: readonly RustSourceCallableSpecializationIssue[];
  readonly families: Pick<RustSourceTypeFamilyRegistry, "implementation">;
  readonly evidence: Omit<RustStaticRequirementEvidence, "lifetimeContract">;
}): { readonly results: RustPromiseResults; readonly diagnostics: readonly TargetDiagnostic[] } {
  const results = new Map<Node, RustPromiseResult>();
  const diagnostics: TargetDiagnostic[] = [];
  const budget = createSourceStorageBudget(defaultSourceStorageLimits);
  const unresolved = (at: Node, reason: string): SourceOwnershipUnresolved => Object.freeze({ kind: "unresolved", at, reason });
  const carrierFor = (subject: SourceStorageSubject, bindings: SourceStorageBindings): TargetTypeRef | SourceOwnershipUnresolved => {
    const logical = input.nativeStorage.logicalCarrierFor(subject, bindings);
    if (logical === undefined) return unresolved(subject.node, "Async retention requires its completed bound native storage carrier.");
    const selected = input.nativeStorage.boundSubjectFor(subject, logical, bindings);
    return selected.kind === "unresolved" ? unresolved(subject.node, selected.reason) : selected.carrier;
  };
  const retentionFor: SourceOwnershipPremises["retentionFor"] = (value, bindings) => {
    if (!budget.step()) return unresolved(value.node, budget.failure()!);
    const checked = input.storage.typeFor(value);
    if (checked.kind === "unresolved") return unresolved(value.node, checked.reason);
    const evidence = { value, contractDeclaration: value.node, checkedType: checked.type };
    const operation = value.projection.length === 0 ? input.records.targetOperation.get(value.node) : undefined;
    if (operation?.kind === "reference-operation" &&
      (operation.operation === "shared-reference" || operation.operation === "mutable-reference")) {
      const owner = input.storage.subjectFor(operation.operandExpression);
      if (owner.kind === "unresolved") return unresolved(value.node, owner.reason);
      const region = input.storage.enclosingRegionFor(owner.subject.node);
      if (region === undefined) return unresolved(value.node, "A native source reference requires its actual owner's checked execution region.");
      return Object.freeze({ kind: "resolved", premises: Object.freeze([input.ast.is.IsSourceFile(region)
        ? Object.freeze({ ...evidence, kind: "retained", reason: "module-owner" })
        : Object.freeze({ ...evidence, kind: "scoped-borrowed", owner: owner.subject, region,
          mode: operation.operation === "shared-reference" ? "shared" : "mutable" })]) });
    }
    const carrier = carrierFor(value, bindings);
    if (carrier.kind === "unresolved") return carrier;
    const owner = value.kind === "receiver" ? value.node : value.kind === "input"
      ? input.ast.parent(value.node) : sourceEnclosingCallable(value.node, input.ast);
    if (carrier.kind === "reference" && carrier.lifetime?.kind !== "static") {
      const lifetime = carrier.lifetime;
      if (lifetime === undefined) return unresolved(value.node, "A retained native reference requires its completed physical lifetime evidence.");
      if (owner === undefined || value.kind !== "receiver" &&
        (value.kind !== "input" || !input.ast.parameters(owner).includes(value.node))) {
        return unresolved(value.node, "A retained native reference requires its concrete source owner or exact formal input contract.");
      }
      const abi = value.kind === "input" ? input.records.sourceParameterAbi.get(value.node) : undefined;
      if (value.kind === "input" && abi?.parameterCarrier.kind === "reference" && abi.inputLifetime !== undefined &&
        rustLifetimesEqual(lifetime, abi.inputLifetime) &&
        rustLifetimesEqual(abi.parameterCarrier.lifetime, abi.inputLifetime)) {
        return Object.freeze({ kind: "resolved", premises: Object.freeze([Object.freeze({ ...evidence,
          kind: "formal-borrowed", executionOwner: owner, mode: carrier.mutable ? "mutable" : "shared",
          region: Object.freeze({ kind: "input-duration", parameter: value.node }) })]) });
      }
      const semantics = input.source.semantics.forNode(value.node);
      for (const binding of semantics.types.typeArgumentBindings(checked.type) ?? []) {
        const symbol = semantics.declarations.typeSymbol(binding.argumentType);
        for (const declaration of symbol === undefined ? [] : semantics.declarations.symbolDeclarations(symbol)) {
          const parameter = input.sourceLifetimes.parameterFor(declaration);
          if (parameter?.kind !== "lifetime" || !rustLifetimesEqual(parameter.lifetime, lifetime)) continue;
          return Object.freeze({ kind: "resolved", premises: Object.freeze([Object.freeze({ ...evidence,
            kind: "formal-borrowed", executionOwner: owner, mode: carrier.mutable ? "mutable" : "shared",
            region: Object.freeze({ kind: "type-argument", binding, declaration }) })]) });
        }
      }
      return unresolved(value.node, "The actual native reference has no corresponding checked formal region argument.");
    }
    if (input.requirements.kind === "rejected" || input.retentionIssues.length !== 0) {
      return unresolved(value.node, "Native result retention awaits the existing rejected generic requirement contract.");
    }
    const contract = owner === undefined ? undefined : input.requirements.index.contractFor(owner);
    const nativeEvidence = { ...input.evidence,
      lifetimeContract: rustEnclosingStorageContract(value.node, input.ast, input.sourceLifetimes) };
    const staticStorage = contract === undefined
      ? classifyCarrierRequirements(carrier, ["static"], new Set<string>(), new Map<string, Set<RustGenericRequirement>>(),
        () => false, input.definitions, nativeEvidence)
      : rustFinalContractSupportsStatic(contract, carrier, input.families, input.definitions, nativeEvidence);
    if (staticStorage.kind !== "supported") return unresolved(value.node, staticStorage.reason);
    const selection: SourceRetentionSelection = Object.freeze({ kind: "resolved",
      premises: Object.freeze([Object.freeze({ ...evidence, kind: "retained", reason: "owned-value" })]) });
    return selection;
  };
  const premises: SourceOwnershipPremises = {
    retentionFor,
    completionFor(call, selected) {
      const declaration = input.source.semantics.forNode(call).declarations.signatureDeclaration(selected.selectedSignature);
      if (declaration === undefined) return unresolved(call, "Async result-use requires its exact checked source signature.");
      const operation = input.records.targetOperation.get(call);
      const carrier = operation?.kind === "source-call" && operation.asyncBody !== undefined
        ? operation.asyncBody.logicalResultCarrier : rustEffectiveValueCarrier(input.records, call);
      const selection = rustAwaitSelection(carrier, input.definitions);
      if (selection === undefined) return unresolved(call, "Async result-use requires its completed native completion carrier.");
      const futures = rustAwaitSelectionLeaves(selection).flatMap(leaf => leaf.future === undefined ? [] : [leaf.future]);
      return futures.length === 0 ? { kind: "not-async" }
        : { kind: "async", contractDeclaration: declaration, checkedType: selected.sourceResultType,
          resultPolicy: futures.every(future => rustJsPromiseOutputTargetType(future.futureCarrier) !== undefined)
            ? "observe-rejection" : "must-observe" };
    },
    suspensionFor(value, bindings) {
      const isCall = input.ast.is.IsCallExpression(value.node) || input.ast.is.IsNewExpression(value.node);
      const operation = input.records.targetOperation.get(value.node);
      const selected = isCall ? input.source.semantics.forNode(value.node).operations.call(value.node) : undefined;
      const declaration = selected?.sourceSelectedSignatureKind === "resolved"
        ? input.source.semantics.forNode(value.node).declarations.signatureDeclaration(selected.selectedSignature) : undefined;
      if (isCall && declaration !== undefined && input.ast.body(declaration) !== undefined) return undefined;
      const checked = input.storage.typeFor(value);
      if (checked.kind === "unresolved") return unresolved(value.node, checked.reason);
      const carrier = carrierFor(value, bindings);
      if (carrier.kind === "unresolved") return carrier;
      const awaited = rustAwaitSelection(carrier, input.definitions);
      if (awaited === undefined) return undefined;
      const future = rustAwaitSelectionLeaves(awaited).some(leaf => leaf.future !== undefined);
      const nativeCall = input.native.callFor(value.node);
      const nativeOperation = operation?.kind === "provider-operation" || operation?.kind === "reference-operation" ||
        operation?.kind === "flow-marker" || operation?.kind === "typed-location";
      if (isCall && nativeCall === undefined && !nativeOperation) return undefined;
      if (!isCall && !future) return undefined;
      return Object.freeze({ kind: future ? "may-suspend" : "never", value,
        contractDeclaration: declaration ?? value.node, checkedType: checked.type });
    },
  };
  const ownership = createSourceOwnershipQuery({ source: input.source, storage: input.storage, budget, premises });
  for (const node of input.nodes) {
    if (!input.ast.is.IsCallExpression(node) && !input.ast.is.IsNewExpression(node)) continue;
    const selection = rustAwaitSelection(rustEffectiveValueCarrier(input.records, node), input.definitions);
    if (selection === undefined) continue;
    const leaves = rustAwaitSelectionLeaves(selection);
    if (!leaves.some(leaf => leaf.future !== undefined)) continue;
    const disposition = input.uses.get(node);
    if (disposition === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An indexed async producer requires its original source result-use selection.", node);
    const native = leaves.some(leaf => leaf.future !== undefined &&
      rustJsPromiseOutputTargetType(leaf.future.futureCarrier) === undefined);
    if (input.ast.is.IsCallExpression(node) && (!native || disposition.kind === "discarded")) {
      const selected = ownership.forCall(node);
      if (selected.kind === "resolved" && selected.decision === "rejected" ||
        selected.kind === "unresolved" && input.requirements.kind === "resolved" && input.retentionIssues.length === 0) {
        diagnostics.push(Object.freeze({ code: selected.kind === "resolved" && selected.decision === "rejected"
          ? selected.diagnostic.code : "RUST_ASYNC_RESULT_USE_NOT_PROVEN", category: "error", source: "tsonic-rust",
          sourceNode: node, message: selected.kind === "resolved" && selected.decision === "rejected" ? selected.diagnostic.message
            : selected.kind === "unresolved" ? selected.reason : "The native result-use decision was not proven.",
          evidence: ["target.capability=rust.async.native-result-use"] }));
        continue;
      }
    }
    const discard = disposition.kind === "discarded" && !native
      ? mapRustAwaitSelection(selection, leaf => Object.freeze({ observe: leaf.future !== undefined })) : undefined;
    results.set(node, Object.freeze({ disposition, ...(discard === undefined ? {} : { discard }) }));
  }
  return Object.freeze({ results, diagnostics: Object.freeze(diagnostics) });
}
