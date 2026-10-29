import { rustParameterModeForCarriers, selectRustSourceParameterAbi, selectRustSourceParameterBorrowCarrier, rustSourceParameterSupportsMemberWrites } from "../../../policy/ownership/source-parameter-contracts.js";
import type { RustSourceParameterAbiFact } from "../../../target-model/records/callables/callables-and-resources.js";
import { flowStateFactKey } from "@tsonic/tsts";
import { selectRustParameterEntryConversion } from "../../../policy/ownership/parameter-entry-conversion.js";
import type { Node, Type } from "@tsonic/tsts";
import { isRustStringCarrier, isRustUnitCarrier, isRustNeverCarrier, rustUnitTargetType, rustOptionElementCarrier, rustSourceOptionalTargetType, isRustJsValueCarrier, rustProgramErrorTargetType, rustTsValueTargetType, rustEmptyObjectTargetType, rustObjectIdentityTargetType, rustCallableInputProtocol, rustStructuralObjectCarrierValue, isRustCallableCarrier, rustNativeCallableProtocol } from "../../../target-model/types/index.js";
import { isRustCopyCarrier } from "../../../policy/constraints/native-traits.js";
import { rustTargetTypeRefEquals, rustTargetTypeRefEqualsWithinLifetimeBinders } from "../../../target-model/types/equality.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";

import type { RustLifetimeBinder } from "../../../target-model/lifetimes/index.js";
import { rustParameterLaneTargetType } from "../../source-evidence/types/resolution/index.js";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "../../source-evidence/types/resolution/index.js";
import { Node_Initializer, Node_Expression, Node_Type, sourceCallableValueParameters, sourceParameterIsProperty } from "@tsonic/target-api/source";
import { resolveSelectedProviderDeclaration, resolveSelectedSourceProfileMember } from "../../../policy/identities/selected-source.js";
import { selectRustProviderOperation } from "../../../policy/operations/provider-selection.js";
import { selectJsSurfaceConstructorBySourceOwner } from "../../../policy/operations/source-profiles/js/index.js";
import { selectJsSurfaceOperation } from "../../../policy/operations/source-profiles/js/selection.js";
import { rustProviderArgumentBorrowsString } from "../../../policy/ownership/provider-argument-borrow.js";
import { rustSourceErrorConstructorOperation, selectRustSourceErrorConstructor } from "../../../policy/operations/source-profiles/error-source-profile.js";
import { rustSourceValueWrapperContains } from "../../../policy/ownership/source-value-wrappers.js";
import { rustSourceInputLifetime } from "../ownership/source-input-lifetimes.js";
import { rustLifetimesEqual } from "../../../target-model/lifetimes/index.js";
import { selectRustSourceValueConversion } from "../../../policy/conversions/selection.js";
import { closeRustRetainedParameter, rustRetainedEnvironment } from "../ownership/retained-values.js";
import { rustHasOpenOwnedStorage } from "../../../policy/ownership/retained-storage.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import { retainRustStructuralInstantiation } from "../../source-evidence/types/resolution/structural-instantiations.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustSourceStorageSubjectContext } from "../../source-evidence/types/resolution/source-storage-projection.js";
import { appendRustDiagnostic, rustResolutionContext, type RustFactWalk } from "../../program/walk.js";
import type { RustSourceCallableReturnFact } from "../../../target-model/records/program/source-declarations.js";
import type { RustRetainedEnvironment } from "../../../target-model/records/callables/retained-environments.js";
import { selectRustPointerReturnContract } from "../ownership/pointer-return.js";
import { rustGenericCallableValueOwner } from "../../../policy/types/callables/callable-origins.js";
import { resolveRustRetainedResult } from "../../source-evidence/types/resolution/retained-results.js";
import { selectRustInferredReturn, selectRustRetainedReturn, type RustInferredReturnSelection } from "./inferred-return.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import { rustUnionPayloadAdmission } from "../../../policy/conversions/union-injection.js";
import { rustAbsenceTargetType } from "../../../target-model/types/carriers/native.js";
import { requireRustRecord } from "../../program/records/objects/required-records.js";
import { rustSourceCallableReturnFactEquals } from "../../../target-model/records/operations/equality.js";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustLifetimeIndex } from "../../../target-model/lifetimes/index.js";
import type { SourceCallableNativeContract, SourceCallableSourceContract } from "../../../target-model/records/callables/source-callable-contract.js";
import type { RustImplicitConstructorParameter } from "../../../target-model/records/objects/construction.js";
import { targetStronglyConnectedComponents } from "@tsonic/target-api/analysis";
import { readRustReferenceOperation } from "../../operations/reference-operations.js";
import { rustOwnedStorageChildren } from "../../../policy/types/storage/owned-storage.js";
import { rustGenericCallableProtocol } from "../../../target-model/types/carriers/generic-callables.js";
import { resolveExpressionCarrier } from "../../source-evidence/types/resolution/expression-carriers.js";
import { rustUnparenthesizedExpression } from "../../../target-model/syntax/expressions.js";
import { resolveRustExternalProjectBase } from "../../../policy/types/project/external-project-types.js";

function rustSourceDataLoanCarrier(carrier: TargetTypeRef): boolean {
  return !isRustCallableCarrier(carrier) && rustNativeCallableProtocol(carrier) === undefined &&
    rustGenericCallableProtocol(carrier) === undefined && rustOwnedStorageChildren(carrier).every(rustSourceDataLoanCarrier);
}

export function createRustSourceCallableContract(input: {
  readonly source: TargetSourceProgram;
  readonly records: RustProgramRecords;
  readonly sourceLifetimes: RustLifetimeIndex;
}, declaration: Node, returnType: TargetTypeRef): SourceCallableSourceContract | undefined {
  const parameters = sourceCallableValueParameters(input.source.ast, declaration, input.source.semantics.forNode(declaration));
  if (parameters === undefined) return undefined;
  const nativeParameters: SourceCallableSourceContract["nativeParameters"][number][] = [];
  for (const parameter of parameters) {
    const selected = input.records.sourceParameterAbi.get(parameter);
    const formal = input.records.callableParameter.get(parameter);
    if (selected === undefined || formal === undefined) return undefined;
    nativeParameters.push(Object.freeze({ sourceParameter: parameter,
      targetParameter: Object.freeze({ ...selected, parameterCarrier: formal.carrier }) }));
  }
  const sourceReturn = input.records.sourceCallableReturn.get(declaration);
  if (sourceReturn === undefined && !input.source.ast.is.IsConstructorDeclaration(declaration)) return undefined;
  return Object.freeze({ kind: "source", sourceDeclaration: declaration,
    parameters: Object.freeze([...parameters]), nativeParameters: Object.freeze(nativeParameters), returnType,
    nativeSignature: Object.freeze({ genericParameters: Object.freeze([
      ...(input.sourceLifetimes.contractFor(declaration)?.parameters ?? []),
      ...(input.records.nativeGenerics.get(declaration)?.implicitLifetimes ?? []),
    ]), sourceReturn }) });
}

export function createRustNativeConstructorContract(input: {
  readonly parameters: readonly RustImplicitConstructorParameter[];
  readonly sourceDeclaration: Node | undefined;
  readonly returnType: TargetTypeRef;
}): SourceCallableNativeContract {
  return Object.freeze({ kind: "native", ...(input.sourceDeclaration === undefined ? {} : { sourceDeclaration: input.sourceDeclaration }),
    nativeParameters: Object.freeze(input.parameters.map(parameter => Object.freeze({ sourceParameter: parameter.declaration,
      targetParameter: Object.freeze({ name: parameter.name, type: parameter.carrier, passingMode: "by-value" as const }) }))),
    returnType: input.returnType, nativeSignature: Object.freeze({ genericParameters: Object.freeze([]) }) });
}

export function selectedSourceCallableReturn(walk: RustFactWalk, declaration: Node): Type | undefined {
  const semantics = walk.context.semanticsFor(declaration);
  const signature = semantics.types.declarationSignatureInfo(declaration);
  return signature !== undefined && semantics.declarations.signatureDeclaration(signature.signature) === declaration
    ? signature.returnType : undefined;
}

export interface RustSourceCallableReturnSelection {
  readonly fact: RustSourceCallableReturnFact;
  readonly retainedEnvironment?: RustRetainedEnvironment;
}

export function selectRustCallableLogicalReturn(
  walk: RustFactWalk, declaration: Node, selectedCarrier?: TargetTypeRef,
): RustInferredReturnSelection {
  const generator = walk.context.records.generator.get(declaration);
  const asynchronous = walk.context.records.asyncFunction.get(declaration);
  const authoredReturn = Node_Type(walk.context.ast, declaration);
  const context = rustSourceStorageSubjectContext(rustResolutionContext(walk, declaration, "return"), undefined);
  const baseline = selectedCarrier ?? generator?.resultCarrier ?? asynchronous?.outputCarrier ?? resolveRustTargetTypeRef(
    authoredReturn ?? selectedSourceCallableReturn(walk, declaration), context, walk.operationOptions);
  return selectedCarrier !== undefined || generator !== undefined || asynchronous !== undefined
    ? baseline === undefined ? { kind: "pending" as const } : { kind: "complete" as const, carrier: baseline }
    : selectRustInferredReturn(walk, declaration, baseline);
}

export function selectRustSourceCallableReturn(
  walk: RustFactWalk,
  declaration: Node,
  selectedCarrier?: TargetTypeRef,
): RustSourceCallableReturnSelection | undefined {
  const generator = walk.context.records.generator.get(declaration);
  const asynchronous = walk.context.records.asyncFunction.get(declaration);
  if (walk.context.semanticsFor(declaration).operations.generator(declaration) !== undefined
    ? generator === undefined
    : asynchronous === undefined && walk.context.ast.hasModifierKind(declaration, "async")) return undefined;
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const inference = selectRustCallableLogicalReturn(walk, declaration, selectedCarrier);
  if (inference.kind === "pending") return undefined;
  const selected = inference.carrier;
  const pointer = selectRustPointerReturnContract(declaration, rustResolutionContext(walk, declaration), walk.operationOptions);
  if (selectedCarrier !== undefined && pointer !== undefined &&
    !rustTargetTypeRefEquals(selectedCarrier, pointer.returnCarrier)) return undefined;
  const rawCarrier = pointer?.returnCarrier ?? rustGenericCallableValueOwner(walk.context.ast, declaration, selected);
  const parameters = sourceCallableValueParameters(walk.context.ast, declaration, walk.context.semanticsFor(declaration));
  if (parameters === undefined) return undefined;
  const parameterCarriers = parameters.map(parameter =>
    parameter === undefined ? undefined : walk.context.records.sourceParameterAbi.get(parameter)?.parameterCarrier);
  if (parameterCarriers.some(parameter => parameter === undefined)) return undefined;
  const candidate = walk.context.sourceCallables.borrowedReturn(declaration);
  let physicalBorrow = false;
  if (candidate !== undefined) {
    const previousCallable = walk.currentCallableDeclaration;
    walk.currentCallableDeclaration = declaration;
    try {
      const borrowedResult = (expression: Node): boolean | undefined => {
        const sourceFile = walk.context.ast.getSourceFile(expression);
        if (sourceFile === undefined || resolveExpressionCarrier(walk, expression, sourceFile, rawCarrier) === undefined) return undefined;
        const node = rustUnparenthesizedExpression(walk.context.ast, expression);
        const operation = walk.context.records.targetOperation.get(node);
        if (walk.context.ast.is.IsIdentifier(node)) {
          const binding = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
          if (binding === candidate.parameter) return true;
          const initializer = binding === undefined ? undefined : Node_Initializer(walk.context.ast, binding);
          return initializer === undefined ? undefined : borrowedResult(initializer);
        }
        if (operation?.kind === "identity-expression" || operation?.kind === "non-null-expression" &&
          rustTargetTypeRefEquals(operation.sourceCarrier, operation.resultCarrier) || operation?.kind === "source-conversion" &&
          operation.conversion === undefined && walk.context.records.projectUpcast.get(node) === undefined &&
          walk.context.records.projectDowncast.get(node) === undefined) {
          const operand = Node_Expression(walk.context.ast, node);
          return operand === undefined ? undefined : borrowedResult(operand);
        }
        if (operation === undefined) return undefined;
        if (operation.kind === "provider-operation") {
          const { abi } = operation;
          if (abi.target.form !== "field" && abi.target.form !== "index" || abi.result.kind !== "sync" ||
            abi.result.conversion.kind !== "identity" || !rustTargetTypeRefEquals(abi.result.rawCarrier, abi.result.carrier) ||
            abi.targetReceiver.kind !== "input" || abi.targetReceiver.input.source.kind !== "receiver" ||
            abi.targetReceiver.input.mode !== "ref" || abi.targetReceiver.input.conversion.kind !== "identity" ||
            abi.targetReceiver.input.parameterCarrier.kind !== "reference" || abi.targetReceiver.input.parameterCarrier.mutable) return false;
          const optional = walk.context.records.optionalChain.get(node);
          if (optional !== undefined && (optional.guardDepth !== 1 ||
            !rustTargetTypeRefEquals(optional.sourceGuardCarrier, optional.resultCarrier) ||
            !rustTargetTypeRefEquals(optional.innerResultCarrier, abi.result.carrier))) return false;
        } else if (operation.kind !== "source-field" && operation.kind !== "source-indexed-field" &&
          operation.kind !== "tuple-index" && operation.kind !== "fixed-index") return false;
        const receiver = Node_Expression(walk.context.ast, node);
        return receiver === undefined ? undefined : borrowedResult(receiver);
      };
      const returns = candidate.returns.map(borrowedResult);
      if (returns.some(selected => selected === undefined)) return undefined;
      physicalBorrow = returns.every(selected => selected === true);
    } finally {
      walk.currentCallableDeclaration = previousCallable;
    }
  }
  const nativeReturn = rawCarrier === undefined || asynchronous !== undefined || generator !== undefined ? undefined
    : selectRustRetainedReturn(walk, declaration, rawCarrier);
  if (nativeReturn?.kind === "pending") return undefined;
  const retained = nativeReturn?.kind !== "complete" ? undefined
    : resolveRustRetainedResult(declaration, sourceReturn, nativeReturn.carrier, parameterCarriers,
        rustResolutionContext(walk, declaration, "return"), walk.operationOptions);
  const carrier = asynchronous !== undefined || generator !== undefined ? rawCarrier : retained?.carrier;
  if (carrier === undefined) return undefined;
  let retainedEnvironment = retained?.environment;
  if (asynchronous === undefined && generator === undefined && retainedEnvironment === undefined &&
    parameterCarriers.some(parameter => parameter !== undefined && rustHasOpenOwnedStorage(parameter) &&
      rustTargetGenericReferences(parameter).lifetimes.length !== 0)) {
    const inputRetention = rustRetainedEnvironment(declaration, parameterCarriers, walk.context);
    if (inputRetention.kind === "unresolved") {
      appendRustDiagnostic(walk, "RUST_RETAINED_ENVIRONMENT_NOT_EXACT", inputRetention.reason, declaration,
        ["target.capability=rust.callable.retained-environment"]);
      return undefined;
    }
    if (inputRetention.kind === "selected") retainedEnvironment = inputRetention.environment;
  }
  const borrowedParameter = walk.context.sourceCallables.borrowedReturn(declaration)?.parameter;
  const borrowedAbi = borrowedParameter === undefined ? undefined
    : walk.context.records.sourceParameterAbi.get(borrowedParameter);
  const completion = walk.context.semanticsFor(declaration).operations.callableCompletion(declaration);
  const absence = rustOptionElementCarrier(carrier) !== undefined || rustOptionalStorageValue(carrier) !== undefined ||
    rustUnionPayloadAdmission(rustAbsenceTargetType(), carrier, walk.context.typeDefinitions) !== undefined;
  const implementationResult = asynchronous !== undefined || generator !== undefined || sourceReturn === undefined
    ? undefined : resolveRustTargetTypeRef(sourceReturn, rustResolutionContext(walk, declaration), walk.operationOptions);
  return {
    fact: {
      returnCarrier: carrier,
      ...(physicalBorrow && borrowedParameter !== undefined && borrowedAbi?.mode === "ref" && borrowedAbi.inputLifetime !== undefined &&
        !isRustCopyCarrier(carrier) && rustSourceDataLoanCarrier(carrier)
        ? { borrowedReturn: Object.freeze({ parameter: borrowedParameter,
          carrier: rustTargetTypeRefEquals(borrowedAbi.valueCarrier, carrier) ? borrowedAbi.parameterCarrier
            : Object.freeze({ kind: "reference" as const, referent: carrier, mutable: false,
              lifetime: borrowedAbi.inputLifetime }) }) } : {}),
      ...(isRustUnitCarrier(implementationResult) ? { implementationCompletion: "absence" as const }
        : isRustNeverCarrier(implementationResult) ? { implementationCompletion: "diverging" as const } : {}),
      ...(completion === undefined ? {} : { canFallThrough: completion.canFallThrough }),
      ...(absence || pointer?.undefinedReturn ? { undefinedReturn: true } : {}),
      ...(absence && completion?.canFallThrough || pointer?.fallthroughUndefined ? { fallthroughUndefined: true } : {}),
    },
    ...(retainedEnvironment === undefined ? {} : { retainedEnvironment }),
  };
}

export function recordRustSourceCallableReturn(walk: RustFactWalk, declaration: Node, logical: TargetTypeRef): boolean {
  const { records, ast } = walk.context;
  if (!ast.is.IsSetAccessorDeclaration(declaration)) return records.sourceCallableReturns.resolve(walk, declaration, logical);
  requireRustRecord(walk.context.requiredRecords, "sourceCallableReturn", declaration,
    "setter", "finalizeRustCallableSignature");
  const existing = records.sourceCallableReturn.get(declaration);
  if (existing === undefined) records.sourceCallableReturns.setter(declaration);
  else if (!rustSourceCallableReturnFactEquals(existing, { returnCarrier: rustUnitTargetType() }))
    failTargetAnalysisInvariant("tsonic-rust",
      "Conflicting Rust semantic plan 'tsonic.rust.sourceCallableReturn' for one exact source subject.", declaration);
  return true;
}

export type RustContextualParameterAbiSelection =
  | { readonly kind: "resolved"; readonly abi: RustSourceParameterAbiFact }
  | { readonly kind: "rejected"; readonly reason: string };

export interface RustSourceParameterResourceError {
  readonly kind: "resource-error";
  readonly parameter: Node;
  readonly declaration: Node;
  readonly dimension: "parameter-contract-steps";
  readonly limit: number;
  readonly reason: string;
}

export type RustSourceParameterAbiSelection = RustContextualParameterAbiSelection | RustSourceParameterResourceError;

export interface RustSourceCallableAbiResolver {
  canUseSharedBorrow(parameter: Node): boolean;
  resolveParameterAbi(
    parameter: Node,
    context: RustTargetTypeResolutionContext,
    options: RustTargetTypeResolutionOptions,
    contextualValueCarrier?: TargetTypeRef,
  ): RustSourceParameterAbiSelection | undefined;
}

export function createRustSourceCallableAbiResolver(input: {
  readonly isNativeCallableExpression: (expression: Node) => boolean;
  readonly parameterAbiFor: (parameter: Node) => RustSourceParameterAbiFact | undefined;
  readonly maximumParameterContractSteps?: number;
}): RustSourceCallableAbiResolver {
  const maximumSteps = input.maximumParameterContractSteps ?? 4_194_304;
  if (!Number.isSafeInteger(maximumSteps) || maximumSteps <= 0) {
    throw new TypeError("Parameter contract analysis requires a positive finite work budget.");
  }
  const cache = new WeakMap<Node, RustSourceParameterAbiFact>();
  const resourceFailures = new WeakMap<Node, RustSourceParameterResourceError>();
  const requirements = new WeakMap<Node, RustParameterBorrowRequirements>();
  const active = new Set<Node>();
  const complete = (parameter: Node, context: RustTargetTypeResolutionContext,
    options: RustTargetTypeResolutionOptions, contextualValueCarrier?: TargetTypeRef): RustSourceParameterAbiSelection | undefined => {
      const finalized = input.parameterAbiFor(parameter);
      if (finalized !== undefined) return contextualValueCarrier === undefined ||
        rustTargetTypeRefEquals(finalized.valueCarrier, contextualValueCarrier)
        ? Object.freeze({ kind: "resolved" as const, abi: finalized }) : undefined;
      const owner = context.ast.parent(parameter);
      if (owner === undefined || sourceCallableValueParameters(context.ast, owner,
        context.currentSemantics, { kind: "declaration" })?.includes(parameter) !== true) return undefined;
      const resourceFailure = resourceFailures.get(parameter);
      if (resourceFailure !== undefined) return resourceFailure;
      const cached = cache.get(parameter);
      if (cached !== undefined) {
        return contextualValueCarrier === undefined || rustTargetTypeRefEquals(cached.valueCarrier, contextualValueCarrier)
          ? Object.freeze({ kind: "resolved" as const, abi: cached }) : undefined;
      }
      if (active.has(parameter)) return undefined;
      const candidates = new Map<Node, RustSourceParameterCandidate>();
      const pending = [parameter];
      const entered = new Set<Node>();
      let steps = 0;
      const account = (): boolean => ++steps <= maximumSteps;
      const exhausted = (): RustSourceParameterResourceError => {
        const failure: RustSourceParameterResourceError = Object.freeze({ kind: "resource-error", parameter,
          declaration: owner, dimension: "parameter-contract-steps", limit: maximumSteps,
          reason: "Declared parameter contract analysis exceeds its finite work budget." });
        resourceFailures.set(parameter, failure);
        return failure;
      };
      try {
        while (pending.length !== 0) {
          if (!account()) return exhausted();
          const current = pending.pop()!;
          if (candidates.has(current) || input.parameterAbiFor(current) !== undefined || cache.has(current)) continue;
          if (active.has(current)) return undefined;
          active.add(current);
          entered.add(current);
          const sourceFile = context.ast.getSourceFile(current);
          if (sourceFile === undefined) return undefined;
          const currentContext = { ...context, currentSourceFile: sourceFile, currentSemantics: context.semanticsFor(current) };
          const selected = selectRustSourceParameterCandidate(current, currentContext, options,
            current === parameter ? contextualValueCarrier : undefined);
          if (selected === undefined || selected.kind === "rejected") return selected;
          let local = requirements.get(current);
          if (local === undefined) {
            local = selected.borrowCarrier === undefined || isRustCopyCarrier(selected.abi.valueCarrier)
              ? { shared: false, dependencies: Object.freeze([]) }
              : selectRustParameterBorrowRequirements(current, currentContext, options, input.isNativeCallableExpression);
            if (local === undefined) return undefined;
            requirements.set(current, local);
          }
          candidates.set(current, { ...selected, context: currentContext, requirements: local });
          for (const dependency of local.dependencies) {
            if (!account()) return exhausted();
            pending.push(dependency);
          }
        }
        const components = targetStronglyConnectedComponents(new Set(candidates.keys()),
          current => candidates.get(current)!.requirements.dependencies, account);
        if (components.kind === "unresolved") return exhausted();
        const completed = new Map<Node, RustSourceParameterAbiFact>();
        for (const component of components.components) {
          const members = new Set(component);
          const borrowed = component.every(current => {
            const candidate = candidates.get(current)!;
            return candidate.borrowCarrier !== undefined && candidate.requirements.shared &&
              candidate.requirements.dependencies.every(dependency => {
                if (members.has(dependency)) return true;
                const abi = completed.get(dependency) ?? input.parameterAbiFor(dependency) ?? cache.get(dependency);
                return abi?.parameterCarrier.kind === "reference" && !abi.parameterCarrier.mutable;
              });
          });
          const selections = component.map(current => {
            const candidate = candidates.get(current)!;
            const selected = borrowed ? selectRustSourceParameterAbi(candidate.abi.form,
              candidate.abi.valueCarrier, candidate.borrowCarrier) : candidate.abi;
            return selected === undefined ? undefined
              : finalizeRustSourceParameterStorage(current, selected, candidate.context, options);
          });
          if (selections.some(selection => selection === undefined)) return undefined;
          component.forEach((current, index) => completed.set(current, selections[index]!));
        }
        for (const [current, abi] of completed) cache.set(current, abi);
        const result = completed.get(parameter);
        return result === undefined ? undefined : Object.freeze({ kind: "resolved" as const, abi: result });
      } finally {
        for (const current of entered) active.delete(current);
      }
  };
  return {
    canUseSharedBorrow(parameter) {
      const abi = input.parameterAbiFor(parameter) ?? cache.get(parameter);
      return abi?.parameterCarrier.kind === "reference" && !abi.parameterCarrier.mutable;
    },
    resolveParameterAbi: complete,
  };
}

interface RustParameterBorrowRequirements {
  readonly shared: boolean;
  readonly dependencies: readonly Node[];
}

interface RustSourceParameterCandidate {
  readonly kind: "candidate";
  readonly abi: RustSourceParameterAbiFact;
  readonly borrowCarrier: TargetTypeRef | undefined;
  readonly context: RustTargetTypeResolutionContext;
  readonly requirements: RustParameterBorrowRequirements;
}

function selectRustSourceParameterCandidate(parameter: Node, context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions, contextualValueCarrier?: TargetTypeRef):
  Omit<RustSourceParameterCandidate, "context" | "requirements"> |
  Extract<RustSourceParameterAbiSelection, { readonly kind: "rejected" }> | undefined {
  const typeNode = Node_Type(context.ast, parameter);
  let base = contextualValueCarrier ?? resolveRustTargetTypeRef(typeNode ?? parameter, context, options);
  const declaration = context.ast.as.AsParameterDeclaration(parameter);
  if (base === undefined || declaration === undefined) return undefined;
  const form = declaration.DotDotDotToken !== undefined ? "rest" as const
    : Node_Initializer(context.ast, parameter) !== undefined ? "default" as const
      : context.ast.questionToken(parameter) !== undefined ? "optional" as const : "required" as const;
  if (form === "required" && (isRustJsValueCarrier(base) || rustTargetTypeRefEquals(base, rustTsValueTargetType()) ||
    rustTargetTypeRefEquals(base, rustEmptyObjectTargetType()) || rustTargetTypeRefEquals(base, rustObjectIdentityTargetType())) &&
    parameterOnlyForwardsThrownValue(parameter, context)) base = rustProgramErrorTargetType();
  const native = validateRustSourceParameterMemberWrites(parameter, base, context, options);
  if (native === undefined || native.kind === "rejected") return native;
  const owned = parameterUsesFlowState(parameter, "moved", context) ? true
    : parameterRetainsWholeValue(parameter, context, options);
  if (owned === undefined) return undefined;
  const lane = form !== "required" ? undefined : owned || typeNode === undefined
    ? base : rustParameterLaneTargetType(base, typeNode, context, options);
  const abi = selectRustSourceParameterAbi(form, base, lane);
  if (abi === undefined) return undefined;
  const owner = context.ast.parent(parameter);
  const returned = owner !== undefined && context.sourceCallables.borrowedReturn(owner)?.parameter === parameter;
  const borrowCarrier = owned || form !== "required" ? undefined
    : returned && !isRustCopyCarrier(base) && rustSourceDataLoanCarrier(base)
      ? { kind: "reference" as const, referent: base, mutable: false }
      : selectRustSourceParameterBorrowCarrier(base, lane);
  return { kind: "candidate", abi, borrowCarrier };
}

function validateRustSourceParameterMemberWrites(
  parameter: Node,
  carrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): { readonly kind: "resolved" } |
  Extract<RustSourceParameterAbiSelection, { readonly kind: "rejected" }> | undefined {
  const optional = rustOptionElementCarrier(carrier);
  if (optional !== undefined) return validateRustSourceParameterMemberWrites(parameter, optional, context, options);
  const owner = context.ast.parent(parameter);
  const structural = rustStructuralObjectCarrierValue(carrier);
  if (structural === undefined || structural.representation === "value" ||
    !structural.fields.some(field => field.method === true) ||
    owner === undefined || context.ast.body(owner) === undefined)
    return { kind: "resolved" };
  const shape = options.sourceTypes.structuralObjectForCarrier(carrier);
  if (shape === undefined) return undefined;
  const demand = context.sourceStorage.formalMemberWriteDemand(owner, parameter);
  if (demand.kind === "unresolved") return Object.freeze({ kind: "rejected", reason: demand.reason });
  if (demand.members.length === 0) return { kind: "resolved" };
  const writableFields = new Set<number>();
  for (const member of demand.members) {
    const fields = shape.fields.filter(field => field.declarations.includes(member));
    if (fields.length !== 1 || fields[0]!.symbols.length === 0)
      return Object.freeze({ kind: "rejected", reason:
        "Formal member-write demand requires one exact original checked native field correspondence." });
    writableFields.add(fields[0]!.storageIndex);
  }
  if (!rustSourceParameterSupportsMemberWrites(carrier, writableFields)) return Object.freeze({ kind: "rejected", reason:
    "Formal member-write demand requires an actually writable native member at every selected field." });
  return { kind: "resolved" };
}

export function resolveRustContextualParameterAbi(
  parameter: Node,
  selectedParameterCarrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  lifetimeBinders?: {
    readonly authored: RustLifetimeBinder;
    readonly selected: RustLifetimeBinder;
  },
  contextualValueCarrier?: TargetTypeRef,
): RustContextualParameterAbiSelection | undefined {
  const declaration = context.ast.as.AsParameterDeclaration(parameter);
  if (declaration === undefined) {
    return undefined;
  }
  const form = declaration.DotDotDotToken !== undefined
    ? "rest" as const
    : Node_Initializer(context.ast, parameter) !== undefined
      ? "default" as const
      : context.ast.questionToken(parameter) !== undefined
        ? "optional" as const
        : "required" as const;
  const authoredType = Node_Type(context.ast, parameter);
  const authoredCarrier = authoredType === undefined
    ? resolveRustTargetTypeRef(parameter, context, options)
    : resolveRustTargetTypeRef(authoredType, context, options);
  const authoredSemanticType = authoredType === undefined
    ? undefined
    : context.currentSemantics.types.authoredType(authoredType);
  const authoredTypeAcceptsContextualCarrier = authoredSemanticType !== undefined &&
    (context.currentSemantics.types.isAny(authoredSemanticType) ||
      context.currentSemantics.types.isUnknown(authoredSemanticType));
  const carriersEqual = lifetimeBinders === undefined
    ? rustTargetTypeRefEquals
    : (left: TargetTypeRef | undefined, right: TargetTypeRef | undefined): boolean =>
        rustTargetTypeRefEqualsWithinLifetimeBinders(
          left,
          right,
          lifetimeBinders.authored,
          lifetimeBinders.selected,
        );
  const selectedValueCarrier = form === "optional"
    ? selectedParameterCarrier
    : form === "default"
      ? rustOptionElementCarrier(selectedParameterCarrier)
      : contextualValueCarrier !== undefined
        ? contextualValueCarrier
      : selectedParameterCarrier.kind === "reference"
        ? authoredCarrier
        : selectedParameterCarrier;
  if (selectedValueCarrier === undefined) {
    return undefined;
  }
  const native = validateRustSourceParameterMemberWrites(parameter, selectedValueCarrier, context, options);
  if (native === undefined || native.kind === "rejected") return native;
  const authoredValue = authoredCarrier === undefined ? undefined
    : form === "optional" ? rustSourceOptionalTargetType(authoredCarrier) : authoredCarrier;
  if (authoredType !== undefined && !authoredTypeAcceptsContextualCarrier &&
    (authoredValue === undefined || !carriersEqual(authoredValue, selectedValueCarrier))) {
    if (form === "required" && authoredCarrier !== undefined) {
      const conversion = selectRustParameterEntryConversion(selectedParameterCarrier, authoredCarrier, context.typeDefinitions);
      if (conversion !== undefined) {
        return Object.freeze({ kind: "resolved" as const, abi: {
          form, valueCarrier: authoredCarrier, parameterCarrier: selectedParameterCarrier,
          mode: "value" as const, entryConversion: conversion,
        } });
      }
    }
    return undefined;
  }
  const mode = form === "required"
    ? rustParameterModeForCarriers(
        selectedValueCarrier,
        selectedParameterCarrier,
        carriersEqual,
      )
    : "value" as const;
  if (mode === undefined) {
    return undefined;
  }
  const finalized = finalizeRustSourceParameterStorage(parameter, {
    form,
    valueCarrier: selectedValueCarrier,
    parameterCarrier: selectedParameterCarrier,
    mode,
  }, context, options);
  return finalized === undefined ? undefined : Object.freeze({ kind: "resolved" as const, abi: finalized });
}

function finalizeRustSourceParameterStorage(
  parameter: Node,
  abi: RustSourceParameterAbiFact,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): RustSourceParameterAbiFact | undefined {
  const owner = context.ast.parent(parameter);
  if (abi.form === "required" && abi.mode === "ref" && abi.entryConversion === undefined && owner !== undefined &&
    !isRustCopyCarrier(abi.valueCarrier) && context.sourceCallables.borrowedReturn(owner)?.parameter === parameter &&
    !parameterUsesFlowState(parameter, "moved", context)) {
    const semantics = context.semanticsFor(owner);
    const signature = semantics.types.declarationSignatureInfo(owner);
    const returned = resolveRustTargetTypeRef(Node_Type(context.ast, owner) ?? signature?.returnType,
      rustSourceStorageSubjectContext({ ...context, currentSemantics: semantics }, undefined), options);
    if (returned === undefined) return undefined;
    if (!isRustCopyCarrier(returned) && rustSourceDataLoanCarrier(returned)) {
      const lifetime = rustSourceInputLifetime(parameter, context);
      if (lifetime !== undefined) return { ...abi, mode: "ref", inputLifetime: lifetime,
        parameterCarrier: { kind: "reference", referent: abi.valueCarrier, mutable: false, lifetime } };
    }
  }
  const lifetime = abi.parameterCarrier.kind === "reference" && rustCallableInputProtocol(abi.parameterCarrier) !== undefined
    ? rustSourceInputLifetime(parameter, context) : undefined;
  if (lifetime !== undefined && abi.parameterCarrier.kind === "reference" &&
    rustLifetimesEqual(lifetime, abi.parameterCarrier.lifetime)) return { ...abi, inputLifetime: lifetime };
  if (abi.mode !== "value" || abi.entryConversion !== undefined) return abi;
  const valueCarrier = closeRustRetainedParameter(parameter, abi.valueCarrier, context);
  const parameterCarrier = valueCarrier === undefined ? undefined
    : rustTargetTypeRefEquals(abi.valueCarrier, abi.parameterCarrier) ? valueCarrier
      : closeRustRetainedParameter(parameter, abi.parameterCarrier, context);
  if (valueCarrier === undefined || parameterCarrier === undefined) return undefined;
  // Closing a retained parameter creates a new structural instantiation (its method environments now name the
  // retained environment lifetime); the closing owner registers it so structural storage stays exact.
  const typeNode = Node_Type(context.ast, parameter);
  const sourceType = typeNode === undefined ? undefined : context.currentSemantics.types.authoredType(typeNode);
  if (!rustTargetTypeRefEquals(abi.valueCarrier, valueCarrier) && (sourceType === undefined ||
    !retainRustStructuralInstantiation(sourceType, abi.valueCarrier, valueCarrier, context, options, new Set(), typeNode))) return undefined;
  return { ...abi, valueCarrier, parameterCarrier };
}

function parameterUsesFlowState(
  parameter: Node,
  state: "borrowed-shared" | "borrowed-mut" | "moved",
  context: RustTargetTypeResolutionContext,
): boolean {
  const { ast } = context;
  const name = ast.name(parameter);
  const declarationReference = context.source.navigation.sourceReferenceFor(name);
  if (name === undefined || declarationReference?.declaration !== parameter) {
    return false;
  }
  const callable = enclosingCallable(ast.parent(parameter), context);
  const body = ast.body(callable);
  if (body === undefined) {
    return false;
  }
  return context.source.navigation.declarationUses(parameter)
    .filter((use) => !use.captured)
    .some(({ reference }) => {
      const flow = context.source.sourceFacts.getFact(reference, flowStateFactKey);
      return flow?.state === state;
    });
}

function parameterReturnsNativePayload(parameter: Node, reference: Node, context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions): boolean | undefined {
  const refinement = context.source.semantics.selectValueTypeRefinement(reference);
  if (refinement.kind !== "resolved" || refinement.reference.declaration !== parameter ||
    refinement.refinement.kind === "ambiguous" || refinement.refinement.kind === "unrelated") return undefined;
  if (refinement.selectedType === refinement.declaredType) return false;
  const sourceFile = context.ast.getSourceFile(reference);
  if (sourceFile === undefined) return undefined;
  const current = { ...context, currentSourceFile: sourceFile, currentSemantics: context.semanticsFor(reference) };
  const selected = resolveRustTargetTypeRef(refinement.selectedType, current, options);
  const declared = resolveRustTargetTypeRef(Node_Type(context.ast, parameter) ?? parameter, context, options);
  if (selected === undefined || declared === undefined) return undefined;
  return !rustTargetTypeRefEquals(selected, declared) &&
    (isRustCopyCarrier(selected) || isRustStringCarrier(selected));
}

function parameterRetainsWholeValue(parameter: Node, context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions): boolean | undefined {
  if (sourceParameterIsProperty(context.ast, parameter)) return true;
  const callable = enclosingCallable(context.ast.parent(parameter), context);
  if (callable !== undefined && (context.ast.hasModifierKind(callable, "async") ||
    context.semanticsFor(callable).operations.generator(callable) !== undefined)) return true;
  const summary = context.source.navigation.parameterUseSummary(parameter);
  const returned = callable !== undefined && context.sourceCallables.borrowedReturn(callable)?.parameter === parameter;
  if (summary === undefined) return undefined;
  for (const use of summary.uses) {
    if (use.throughMember) continue;
    if (use.role === "argument" && callable !== undefined && context.ast.is.IsConstructorDeclaration(callable)) {
      const operand = rustUnparenthesizedExpression(context.ast, use.reference);
      let argument = operand;
      while (context.ast.is.IsParenthesizedExpression(context.ast.parent(argument))) argument = context.ast.parent(argument)!;
      const call = context.ast.parent(argument);
      const owner = context.ast.parent(callable);
      if (call !== undefined && context.ast.is.IsCallExpression(call) &&
        context.ast.kindName(Node_Expression(context.ast, call)) === "KindSuperKeyword") {
        if (owner === undefined || enclosingCallable(call, context) !== callable) return undefined;
        const heritage = context.source.navigation.declaredHeritage(owner);
        if (heritage.kind !== "resolved") return undefined;
        const bases = heritage.edges.flatMap(edge => {
          const base = resolveRustExternalProjectBase(edge, options.sourceProfiles);
          return base === undefined ? [] : [base];
        });
        if (bases.length > 1) return undefined;
        const base = bases[0];
        if (base !== undefined) {
          const semantics = context.semanticsFor(call);
          const selected = semantics.operations.call(call);
          const declaration = selected === undefined ? undefined : semantics.declarations.signatureDeclaration(selected.selectedSignature);
          const index = selected?.sourceArguments.findIndex(value => value.expression === argument) ?? -1;
          if (selected === undefined || declaration === undefined || !base.constructorDeclarations.includes(declaration) || index < 0) return undefined;
          const bindings = selected.sourceArgumentBindings.filter(value => value.sourceArgumentIndex === index &&
            value.sourceForm === "value" && value.sourceParameterForm === "parameter");
          if (bindings.length !== 1) return undefined;
          const fields = base.fields.filter(field => field.initializer.kind === "message" &&
            field.initializer.parameterIndex === bindings[0]!.sourceParameterIndex);
          if (fields.length !== 1) return undefined;
          const sourceFile = context.ast.getSourceFile(call);
          if (sourceFile === undefined) return undefined;
          const carrier = resolveRustTargetTypeRef(argument, { ...context, currentSemantics: semantics,
            currentSourceFile: sourceFile }, options);
          if (carrier === undefined || !rustTargetTypeRefEquals(carrier, fields[0]!.carrier) &&
            !rustTargetTypeRefEquals(rustOptionElementCarrier(carrier), fields[0]!.carrier)) return undefined;
          return true;
        }
      }
    }
    if (use.captured || use.role === "yield" || use.role === "storage" && !returned) return true;
    if (use.role !== "return" || returned) continue;
    const payload = parameterReturnsNativePayload(parameter, use.reference, context, options);
    if (payload === undefined) return undefined;
    if (!payload) return true;
  }
  return false;
}

function selectRustParameterBorrowRequirements(
  parameter: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  isNativeCallableExpression: (expression: Node) => boolean,
): RustParameterBorrowRequirements | undefined {
  const { ast } = context;
  const dependencies = new Set<Node>();
  const owned = (): RustParameterBorrowRequirements => ({ shared: false, dependencies: Object.freeze([]) });
  const current = parameter;
    const name = ast.name(current);
    if (name === undefined || context.source.navigation.sourceReferenceFor(name)?.declaration !== current ||
      ast.body(enclosingCallable(ast.parent(current), context)) === undefined ||
      parameterUsesFlowState(current, "moved", context) || parameterUsesFlowState(current, "borrowed-mut", context)) return owned();
    const retains = parameterRetainsWholeValue(current, context, options);
    if (retains === undefined) return undefined;
    if (retains) return owned();
    const summary = context.source.navigation.parameterUseSummary(current);
    if (summary === undefined) return undefined;
    if (summary.bindingWritten || summary.memberWritten || summary.captured) return owned();
    for (const { reference, role, throughMember } of summary.uses) {
      if (role === "return") {
        if (context.sourceCallables.borrowedReturn(ast.parent(parameter)!)?.parameter === parameter) continue;
        const payload = parameterReturnsNativePayload(parameter, reference, context, options);
        if (payload === undefined) return undefined;
        if (payload) continue;
      }
      const flow = context.source.sourceFacts.getFact(reference, flowStateFactKey);
      if (flow?.state === "borrowed-shared" || throughMember || role === "receiver" ||
        role === "comparison" || role === "condition" || role === "type-only") continue;
      let operand = reference;
      let call = ast.parent(operand);
      if (call !== undefined && ast.is.IsTypeOfExpression(call) && Node_Expression(ast, call) === operand) continue;
      while (call !== undefined && rustSourceValueWrapperContains(call, operand, ast)) {
        const sourceFile = ast.getSourceFile(call);
        if (sourceFile === undefined || !isRustStringCarrier(resolveRustTargetTypeRef(call, {
          ...context,
          currentSourceFile: sourceFile,
          currentSemantics: context.semanticsFor(call),
        }, options))) return owned();
        operand = call;
        call = ast.parent(call);
      }
      if (call === undefined || !ast.is.IsCallExpression(call) && !ast.is.IsNewExpression(call)) return owned();
      const semantics = context.semanticsFor(call);
      const selected = semantics.operations.call(call);
      if (selected === undefined) return undefined;
      if (selected.sourceArguments.some(argument => ast.is.IsSpreadElement(argument.expression))) return owned();
      const argumentIndex = selected.sourceArguments.findIndex(argument => argument.expression === operand);
      const referenceOperation = readRustReferenceOperation(context, call);
      if (referenceOperation?.kind === "store" && referenceOperation.valueExpression === operand) return owned();
      const declaration = semantics.declarations.signatureDeclaration(selected.selectedSignature);
      const member = resolveSelectedSourceProfileMember(context, declaration, options.sourceProfiles);
      const errorConstructor = selectRustSourceErrorConstructor(member, ast.is.IsNewExpression(call) ||
        ast.kindName(Node_Expression(ast, call)) === "KindSuperKeyword");
      if (argumentIndex >= 0 && errorConstructor !== undefined) {
        const sourceFile = ast.getSourceFile(call);
        if (sourceFile === undefined) return undefined;
        const callContext = { ...context, currentSourceFile: sourceFile, currentSemantics: semantics };
        const operation = rustSourceErrorConstructorOperation(errorConstructor, selected.sourceArguments.map(argument =>
          resolveRustTargetTypeRef(argument.expression, callContext, options)));
        if (operation === undefined) return undefined;
        if (!rustProviderArgumentBorrowsString(operation, argumentIndex)) return owned();
        continue;
      }
      if (argumentIndex >= 0 && member?.profile === "js") {
        if (!options.jsEnabled) return owned();
        const sourceFile = ast.getSourceFile(call);
        if (sourceFile === undefined) return undefined;
        const callContext = { ...context, currentSourceFile: sourceFile, currentSemantics: semantics };
        const argumentCarriers = selected.sourceArguments.map(argument =>
          resolveRustTargetTypeRef(argument.expression, callContext, options));
        const typeArguments = selected.sourceSelectedMethodTypeArguments ?? [];
        const selectedMethodTypeArgumentCarriers = typeArguments.map(argument =>
          resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, callContext, options));
        const operation = ast.is.IsNewExpression(call) ? selectJsSurfaceConstructorBySourceOwner({
          sourceOwnerName: member.ownerName,
          typeArgumentCarriers: selectedMethodTypeArgumentCarriers,
          argumentCarriers,
        }, context.typeDefinitions) : selectJsSurfaceOperation({
          ownerName: member.ownerName, memberName: member.memberName, operationKind: "call",
          receiverCarrier: selected.sourceReceiver === undefined ? undefined :
            resolveRustTargetTypeRef(selected.sourceReceiver.expression, callContext, options),
          argumentCarriers,
          selectedMethodTypeArgumentCarriers,
          authoredMethodTypeArgumentCarriers: typeArguments.map(argument => argument.explicitTypeNode === undefined
            ? undefined : resolveRustTargetTypeRef(argument.explicitTypeNode, callContext, options)),
          argumentMatchScore: (expected, actual) => actual !== undefined &&
            selectRustSourceValueConversion(actual, expected, context.typeDefinitions) !== undefined ? 1 : undefined,
        }, context.typeDefinitions);
        if (operation?.fact.kind !== "provider-operation") return undefined;
        if (!rustProviderArgumentBorrowsString(operation.fact, argumentIndex)) return owned();
        continue;
      }
      const provider = resolveSelectedProviderDeclaration(context, declaration, [
        { subject: selected.selectedSignature, precision: "exact" },
      ]);
      if (argumentIndex >= 0 && provider.kind === "selected") {
        const operation = selectRustProviderOperation(options.providerRows, provider.identity,
          ast.is.IsNewExpression(call) ? "constructor" : "method");
        if (operation.kind !== "selected") return undefined;
        if (!rustProviderArgumentBorrowsString(operation.row, argumentIndex)) return owned();
        continue;
      }
      if (provider.kind === "conflict") return undefined;
      const sourceFile = ast.getSourceFile(call);
      const callback = argumentIndex < 0 || sourceFile === undefined ? undefined : rustCallableInputProtocol(resolveRustTargetTypeRef(
        selected.sourceCallee.expression, rustSourceStorageSubjectContext({ ...context,
          currentSourceFile: sourceFile, currentSemantics: semantics }, undefined), options));
      if (callback !== undefined) {
        const input = callback.parameters[argumentIndex];
        if (input?.kind !== "reference" || input.mutable ||
          selectRustSourceParameterBorrowCarrier(input.referent, input.referent) === undefined) return owned();
        continue;
      }
      const implementation = declaration === undefined ? undefined : context.source.navigation.callableImplementation(declaration);
      if (argumentIndex < 0 || implementation?.kind !== "resolved") return undefined;
      if (!(ast.is.IsFunctionDeclaration(implementation.implementation.declaration) ||
          isNativeCallableExpression(implementation.implementation.declaration))) return owned();
      const parameters = sourceCallableValueParameters(ast, implementation.implementation.declaration,
        context.semanticsFor(implementation.implementation.declaration));
      if (parameters === undefined) return undefined;
      const bindings = selected.sourceArgumentBindings.filter(binding => binding.sourceArgumentIndex === argumentIndex &&
        binding.sourceForm === "value" && binding.sourceParameterForm === "parameter");
      const destination = bindings.length === 1 ? parameters[bindings[0]!.sourceParameterIndex] : undefined;
      const parameterSyntax = destination === undefined ? undefined : ast.as.AsParameterDeclaration(destination);
      if (destination === undefined || parameterSyntax === undefined || parameterSyntax.DotDotDotToken !== undefined ||
        ast.questionToken(destination) !== undefined || Node_Initializer(ast, destination) !== undefined) return owned();
      dependencies.add(destination);
    }
  return { shared: true, dependencies: Object.freeze([...dependencies]) };
}

function parameterOnlyForwardsThrownValue(
  parameter: Node,
  context: RustTargetTypeResolutionContext,
): boolean {
  const summary = context.source.navigation.parameterUseSummary(parameter);
  if (summary === undefined || summary.uses.length === 0 || summary.bindingWritten ||
    summary.memberWritten || summary.captured || summary.returned || summary.yielded ||
    summary.aliasedOrStored || summary.exported) return false;
  return summary.uses.every(({ reference }) => {
    let operand = reference;
    let parent = context.ast.parent(operand);
    while (parent !== undefined && context.ast.kindName(parent) === "KindParenthesizedExpression" &&
      Node_Expression(context.ast, parent) === operand) {
      operand = parent;
      parent = context.ast.parent(parent);
    }
    return parent !== undefined && context.ast.kindName(parent) === "KindThrowStatement" &&
      Node_Expression(context.ast, parent) === operand;
  });
}

function enclosingCallable(
  node: Node | undefined,
  context: RustTargetTypeResolutionContext,
): Node | undefined {
  const { ast } = context;
  let current = node;
  while (current !== undefined) {
    if (
      ast.is.IsFunctionDeclaration(current) ||
      ast.is.IsMethodDeclaration(current) ||
      ast.is.IsConstructorDeclaration(current) ||
      ast.is.IsGetAccessorDeclaration(current) ||
      ast.is.IsSetAccessorDeclaration(current) ||
      ast.is.IsFunctionExpression(current) ||
      ast.is.IsArrowFunction(current)
    ) {
      return current;
    }
    current = ast.parent(current);
  }
  return undefined;
}
