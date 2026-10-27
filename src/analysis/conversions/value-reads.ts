import { rustCaughtErrorPhysicalView } from "../errors/catching-try.js";
import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustValueReadProducer } from "../program/records/storage/value-read.js";
import type { RustValueProjectionProducer } from "../program/records/objects/value-projection.js";
import type { RustConversionEmissionProducer } from "../program/records/operations/conversion-emission.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectUpcastFact } from "../../target-model/records/objects/value-projections.js";
import type { RustValueProjection } from "../../target-model/records/objects/value-projection.js";
import { isRustOptionCarrier, isRustUnitCarrier, isRustNeverCarrier, rustOptionElementCarrier, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { rustCompilerOwnedContextualConversionMatches, rustContextualRuntimeConversionContract } from "../../policy/conversions/contextual.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustProjectUpcastSourceMatches } from "./value-carrier-queries.js";
import { admitRustConversionEmission } from "./emission.js";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustCallableAdapterValues } from "../../policy/conversions/callable-values.js";
import type { RustCallableValueAdapter } from "../../target-model/records/callables/callable-adapters.js";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, Node_Operand } from "@tsonic/target-api/source";
import { rustUnparenthesizedExpression } from "../../target-model/syntax/expressions.js";
import { rustUnionEntryTransferIssue } from "../../policy/conversions/union-injection.js";
import type { RustValueReadOwnership } from "../../target-model/records/storage/ownership.js";
import type { RustProviderReadSelection } from "../operations/provider-forms.js";

export function analyzeRustValueReads(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[],
  providerReads: readonly RustProviderReadSelection[], producer: RustValueReadProducer,
  projections: RustValueProjectionProducer, conversions: RustConversionEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  const rejectedEntries = new Set<Node>();
  const providerClones = new Set(providerReads.filter(selection => selection.bodies.some(context => context.read === "clone"))
    .map(selection => selection.node));
  const entry = (node: Node, source: TargetTypeRef, target: TargetTypeRef,
    read: RustValueReadOwnership["kind"] | undefined): void => {
    if (rejectedEntries.has(node)) return;
    const root = program.records.locationStorageRoot.get(node);
    const declaration = root === undefined || root === null
      ? program.records.sourceBinding.get(node)?.sourceDeclaration : root.declaration;
    const stored = declaration !== undefined && (program.records.bindingStorage.get(declaration) !== undefined ||
      program.records.moduleBinding.get(declaration)?.storage === "module-cell");
    const issue = rustUnionEntryTransferIssue(source, target, read,
      stored || program.records.nativeArrayStorage.get(node)?.kind === "reference", program.typeDefinitions);
    if (issue !== undefined) {
      rejectedEntries.add(node);
      issues.push({ code: "RUST_UNION_ENTRY_STORAGE_IDENTITY_NOT_PRESERVED", category: "error", source: "tsonic-rust", sourceNode: node,
        message: `${issue} Node kind: ${program.source.ast.kindName(node)}.`,
        evidence: ["target.capability=rust.analysis.union-entry-storage-identity"] });
    }
  };
  const convertedEntry = (node: Node | undefined, conversion: RustValueConversion | undefined): void => {
    if (node === undefined || conversion === undefined) return;
    const contract = admitRustConversionEmission(conversions, conversion, program.typeDefinitions);
    const read = providerClones.has(node) ? "clone" : program.records.readOwnership.get(node)?.source.kind;
    if (contract.sourceMode === "value" && contract.lowering !== "identity" || read === "clone")
      entry(node, contract.source, contract.target, read);
  };
  const upcast = (node: Node, fact: RustProjectUpcastFact): void => {
    if (projections.records.projectUpcastEmission.get(fact) !== undefined) return;
    if (!rustProjectUpcastSourceMatches(fact, program.typeDefinitions)) {
      refuse(node, "rust.backend.project-upcast", "Project-type upcast has no exact finalized source variant correspondence."); return;
    }
    if (fact.sourceVariants !== undefined) {
      const variants = fact.sourceVariants.map(variant => ({ name: variant.name, fact: { sourceCarrier: variant.carrier, targetCarrier: fact.targetCarrier } }));
      for (const variant of variants) upcast(node, variant.fact);
      projections.upcast(fact, { kind: "union", variants: Object.freeze(variants) });
    } else {
      const owner = program.projectTypes.definitionForCarrier(fact.targetCarrier);
      const relation = owner === undefined ? undefined : program.projectTypes.relationship(fact.sourceCarrier, owner);
      if (relation?.kind !== "related" || !rustTargetTypeRefEquals(relation.targetType, fact.targetCarrier)) {
        refuse(node, "rust.backend.project-upcast", "Project-type upcast conflicts with the exact finalized source and target heritage carriers."); return;
      }
      projections.upcast(fact, { kind: "object", structural: rustStructuralObjectCarrierValue(fact.sourceCarrier) !== undefined });
    }
  };
  const adapter = (node: Node, value: RustCallableValueAdapter): void => {
    if (value.kind === "project-upcast") upcast(node, { sourceCarrier: value.sourceCarrier, targetCarrier: value.targetCarrier });
    else if (value.kind === "conversion") {
      if (value.upcast !== undefined) upcast(node, value.upcast);
      if (value.conversion.kind === "project-union-map") for (const arm of value.conversion.arms) if (arm.upcast !== null) upcast(node, arm.upcast);
    } else if (value.kind === "option-map" || value.kind === "option-some") adapter(node, value.element);
  };
  // A constructor value's forwarders (its construction and static methods) adapt their results the same way.
  for (const view of program.classValues.constructorViewImplementations)
    for (const callable of [view.construction, ...view.fields.map(field => field.callable)])
      if (callable !== undefined) for (const value of rustCallableAdapterValues(callable)) adapter(callable.declaration, value);
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    for (const callable of program.records.projectCallableAdapters.get(node) ?? []) for (const value of rustCallableAdapterValues(callable)) adapter(node, value);
    for (const callable of program.records.objectLiteralMethodAdapter.get(node)?.dispatches ?? [])
      for (const value of rustCallableAdapterValues(callable)) adapter(node, value);
    // Class values forward construction and static callable fields through the same callable adapters.
    for (const view of program.classValues.forDeclaration(node)?.views ?? [])
      for (const callable of [view.construction, ...view.fields.map(field => field.callable)])
        if (callable !== undefined) for (const value of rustCallableAdapterValues(callable)) adapter(node, value);
  }
  // Each emitted constructor view forwards its construction and static callables through callable adapters.
  for (const view of program.classValues.constructorViewImplementations)
    for (const callable of [view.construction, ...view.fields.map(field => field.callable)])
      if (callable !== undefined) for (const value of rustCallableAdapterValues(callable)) adapter(view.declaration, value);
  // The planner binds an optional chain guard as `Some(optional_receiver)` and reads it with the chain's present carrier.
  const presentGuards = new Map<Node, TargetTypeRef>();
  for (const node of nodes) {
    const chain = program.records.optionalChainEmission.get(node);
    if (chain !== undefined) presentGuards.set(chain.fact.guard, chain.structuralGuard?.selectedStorageCarrier ?? chain.fact.selectedGuardCarrier);
  }
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const source = program.records.runtimeCarrier.get(node)?.carrier;
    const flow = program.records.flowReadProjection.get(node);
    const conversion = program.records.conversion.get(node);
    const cast = program.records.projectUpcast.get(node);
    const downcast = program.records.projectDowncast.get(node);
    const lifetime = program.records.callScopedLifetimeReconciliation.get(node);
    const object = program.records.objectReferenceView.get(node);
    const indexed = program.records.indexedFieldKeyArgument.get(node);
    const contextual = program.records.contextualValueConversion.get(node);
    const optional = program.records.optionProjection.get(node);
    const physicalView = rustCaughtErrorPhysicalView(program.source.ast, program.records, node);
    const contextualInput = lifetime?.selectedCarrier ?? downcast?.targetCarrier ?? cast?.targetCarrier ?? conversion?.convertedType ?? physicalView ?? flow?.selectedCarrier ?? source;
    const optionInput = contextual?.targetCarrier ?? indexed?.carrier ?? object?.targetCarrier ?? contextualInput;
    const value = optional?.resultCarrier ?? optionInput;
    if (source === undefined && value === undefined) continue;
    const compilerOwned = contextual !== undefined && (contextual.conversion.kind === "native-trait-object-upcast" ||
      contextual.conversion.kind === "reference-reborrow" || contextual.conversion.kind === "callable-adapter");
    if (compilerOwned && !rustCompilerOwnedContextualConversionMatches(contextual.sourceCarrier, contextual.targetCarrier, contextual.conversion, program.typeDefinitions))
      refuse(node, "rust.backend.contextual-value-conversion", "Compiler-owned contextual Rust conversion is not an exact closed carrier transition.");
    const referenceReborrow = contextual?.conversion.kind === "reference-reborrow" ? contextual.conversion : undefined;
    producer.publish(node, { source, value, contextualInput, optionInput, referenceReborrow,
      strictEquality: isRustOptionCarrier(source) ? source : optional !== undefined && isRustOptionCarrier(optional.resultCarrier) ? optional.sourceCarrier : value });
    if (cast !== undefined && downcast !== undefined) {
      refuse(node, "rust.backend.project-cast-conflict", "One source expression cannot carry both finalized project upcast and downcast facts."); continue;
    }
    if (cast !== undefined) upcast(node, cast);
    if (contextual?.conversion.kind === "project-union-map") for (const arm of contextual.conversion.arms) if (arm.upcast !== null) upcast(node, arm.upcast);
    const runtime = contextual === undefined ? undefined : rustContextualRuntimeConversionContract(contextual.conversion, program.typeDefinitions);
    if (runtime !== undefined) {
      const contract = admitRustConversionEmission(conversions, contextual!.conversion as RustValueConversion, program.typeDefinitions);
      if (!rustTargetTypeRefEquals(contract.target, contextual!.targetCarrier))
        refuse(node, "rust.backend.contextual-value-conversion", "Contextual Rust value conversion has no exact finalized target carrier.");
    }
    const transitions = [
      ...(flow === undefined ? [] : [{ input: flow.sourceCarrier, output: physicalView ?? flow.selectedCarrier, kind: "flow" as const }]),
      ...(cast === undefined && downcast === undefined ? [] : [{ input: (cast ?? downcast)!.sourceCarrier, output: (cast ?? downcast)!.targetCarrier, kind: "cast" as const }]),
      ...(lifetime === undefined ? [] : [{ input: lifetime.sourceCarrier, output: lifetime.selectedCarrier, kind: "lifetime" as const }]),
      ...(object === undefined ? [] : [{ input: object.sourceCarrier, output: object.targetCarrier, kind: "object" as const }]),
      ...(contextual === undefined ? [] : [{ input: contextual.sourceCarrier, output: contextual.targetCarrier, kind: "contextual" as const }]),
      ...(optional === undefined ? [] : [{ input: optional.sourceCarrier, output: optional.resultCarrier, kind: "option" as const }]),
    ];
    const input = transitions[0]?.input ?? source;
    const fused = flow?.kind === "union-map" && contextual?.conversion.kind === "project-union-map" && rustTargetTypeRefEquals(flow.selectedCarrier, contextual.sourceCarrier) &&
      cast === undefined && downcast === undefined && lifetime === undefined && object === undefined ? flow : undefined;
    const ownership = program.records.readOwnership.get(node);
    const operation = program.records.targetOperation.get(node);
    let resultNode = rustUnparenthesizedExpression(program.source.ast, node);
    let resultOperation = program.records.targetOperation.get(resultNode);
    let forwardsRead = resultNode !== node;
    while (resultOperation?.kind === "identity-expression" || resultOperation?.kind === "non-null-expression" &&
      rustTargetTypeRefEquals(resultOperation.sourceCarrier, resultOperation.resultCarrier) ||
      resultOperation?.kind === "source-conversion" && resultOperation.conversion === undefined &&
      program.records.projectUpcast.get(resultNode) === undefined && program.records.projectDowncast.get(resultNode) === undefined) {
      forwardsRead = true;
      const operand = program.source.ast.is.IsPrefixUnaryExpression(resultNode)
        ? Node_Operand(program.source.ast, resultNode) : Node_Expression(program.source.ast, resultNode);
      if (operand === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted identity result requires its exact source operand.", resultNode);
      resultNode = rustUnparenthesizedExpression(program.source.ast, operand);
      resultOperation = program.records.targetOperation.get(resultNode);
    }
    const sourceConversion = resultOperation?.kind === "source-conversion" ? resultOperation : undefined;
    forwardsRead ||= sourceConversion !== undefined;
    const resultContract = sourceConversion?.conversion === undefined ? undefined
      : admitRustConversionEmission(conversions, sourceConversion.conversion, program.typeDefinitions);
    const ownsResult = resultContract?.sourceMode === "value" && resultContract.lowering !== "identity";
    const entrySource = contextual?.sourceCarrier ?? contextualInput;
    const entryRead = ownsResult ? "move" : providerClones.has(node) && ownership !== undefined && ownership.source.kind !== "borrow"
      ? "clone" : ownership?.source.kind;
    if (entrySource !== undefined && value !== undefined &&
      (runtime?.sourceMode === "value" && runtime.lowering !== "identity" || optional?.kind === "some" ||
        entryRead === "clone" && !forwardsRead))
      entry(node, entrySource, value, entryRead);
    if (operation?.kind === "source-conversion") {
      convertedEntry(Node_Expression(program.source.ast, node) ?? Node_Operand(program.source.ast, node), operation.conversion);
    } else if (operation?.kind === "operator-call" || operation?.kind === "operator-token") {
      convertedEntry(BinaryExpression_Left(program.source.ast, node) ?? Node_Operand(program.source.ast, node), operation.leftConversion);
      convertedEntry(BinaryExpression_Right(program.source.ast, node), operation.rightConversion);
    }
    const borrowable = ownership?.value.kind !== "move" && flow !== undefined && ((flow.kind === "source-union" || flow.kind === "runtime-union") && flow.project === undefined ||
      flow.kind === "option-value" && rustOptionalStorageValue(flow.sourceCarrier) === undefined) && rustOptionElementCarrier(flow.selectedCarrier) === undefined &&
      cast === undefined && downcast === undefined && lifetime === undefined && optional === undefined && object === undefined;
    const borrowedOptionIdentity = ownership?.value.kind === "borrow" && !ownership.value.mutable && flow?.kind === "option-value" &&
      optional?.kind === "some" && rustTargetTypeRefEquals(source, flow.sourceCarrier) &&
      rustTargetTypeRefEquals(flow.selectedCarrier, optional.sourceCarrier) &&
      rustTargetTypeRefEquals(flow.sourceCarrier, optional.resultCarrier) &&
      cast === undefined && downcast === undefined && lifetime === undefined && contextual === undefined && conversion === undefined &&
      object === undefined && indexed === undefined && program.records.callableJoinWrite.get(node) === undefined;
    const plans: { readonly carrier: TargetTypeRef | undefined; readonly value: RustValueProjection }[] = [];
    const candidates = [undefined, input, ...transitions.flatMap(transition => [transition.input, transition.output]), presentGuards.get(node)];
    const seen = new Set<string>();
    for (const carrier of candidates) {
      const identity = carrier === undefined ? "default" : closedMetadataKey(carrier);
      if (seen.has(identity)) continue;
      seen.add(identity);
      let current = carrier ?? input;
      const applied = new Set<(typeof transitions)[number]["kind"]>();
      let failed = false;
      for (const [index, transition] of transitions.entries()) {
        if (rustTargetTypeRefEquals(current, transition.input)) { applied.add(transition.kind); current = transition.output; }
        else if (!rustTargetTypeRefEquals(current, transition.output) && !transitions.slice(index + 1).some(later =>
          rustTargetTypeRefEquals(current, later.input) || rustTargetTypeRefEquals(current, later.output))) {
          if (carrier === undefined) refuse(node, projectionDiagnostics[transition.kind].capability, projectionDiagnostics[transition.kind].message);
          failed = true; break;
        }
      }
      if (failed) continue;
      plans.push({ carrier, value: Object.freeze({ exits: program.records.expressionExit.get(node) !== undefined || isRustNeverCarrier(source), flow: applied.has("flow") ? flow : undefined, upcast: applied.has("cast") ? cast : undefined,
        downcast: applied.has("cast") ? downcast : undefined, object: applied.has("object") ? object : undefined,
        contextual: applied.has("contextual") ? contextual : undefined, option: applied.has("option") ? optional : undefined,
        fused: applied.has("flow") && applied.has("contextual") ? fused : undefined, borrowable: borrowable && applied.has("flow"),
        borrowedOptionIdentity: borrowedOptionIdentity && applied.has("flow") && applied.has("option"),
        borrowConversion: borrowable && contextual !== undefined && rustTargetTypeRefEquals(flow?.selectedCarrier, contextual.sourceCarrier) &&
          (runtime?.sourceMode === "ref" || contextual.conversion.kind === "project-union-map"),
        referenceReborrow: referenceReborrow !== undefined,
        contextualConsumesSource: applied.has("contextual") && runtime?.sourceMode === "value", contextualIdentity: contextual?.conversion.kind === "native-trait-object-upcast" || referenceReborrow !== undefined,
        preserveAbsenceEffect: ownership?.pure !== true, absenceDiscard: isRustUnitCarrier(optional?.sourceCarrier) ? "unit" : "value" }) });
    }
    projections.publish(node, Object.freeze(plans), transitions.length === 0);
  }
  for (const occurrence of program.physicalEmissionContexts.sourceOccurrences) {
    for (const { input, slot } of occurrence.inputs) {
      if (input.conversion.kind === "semantic") convertedEntry(slot.node, input.conversion.conversion);
      else if (input.conversion.kind === "sequence") for (const step of input.conversion.steps) convertedEntry(slot.node, step.conversion);
    }
    const { result } = occurrence.operation.abi;
    if (result.kind === "sync") {
      if (result.conversion.kind === "semantic") convertedEntry(occurrence.node, result.conversion.conversion);
      else if (result.conversion.kind === "sequence") for (const step of result.conversion.steps) convertedEntry(occurrence.node, step.conversion);
      else if (providerClones.has(occurrence.node) && program.records.readOwnership.get(occurrence.node)?.source.kind !== "borrow")
        entry(occurrence.node, result.rawCarrier, result.carrier, "clone");
    }
  }
  return Object.freeze(issues);
}

const projectionDiagnostics = {
  flow: { capability: "rust.backend.flow-read-order", message: "The finalized flow-read projection is not composable with the expression's current exact carrier." },
  cast: { capability: "rust.backend.project-cast-order", message: "The finalized project cast is not composable with the expression's current exact carrier." },
  lifetime: { capability: "rust.backend.call-scoped-lifetime-reconciliation-order", message: "The finalized call-scoped lifetime reconciliation is not composable with the expression's current exact carrier." },
  object: { capability: "rust.backend.object-view-order", message: "The finalized object view does not match the current expression carrier." },
  contextual: { capability: "rust.backend.contextual-value-conversion-order", message: "The finalized contextual conversion is not composable with the expression's current exact carrier." },
  option: { capability: "rust.backend.option-projection-order", message: "The finalized Option projection is not composable with the expression's current exact carrier." },
} as const;
