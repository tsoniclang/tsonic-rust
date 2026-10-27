import { rustParameterModeForCarriers, selectRustSourceParameterAbi, selectRustSourceParameterBorrowCarrier, rustSourceParameterSupportsMemberWrites } from "../../../policy/ownership/source-parameter-contracts.js";
import type { RustSourceParameterAbiFact } from "../../../target-model/records/callables-and-resources.js";
import { flowStateFactKey } from "@tsonic/tsts";
import { selectRustParameterEntryConversion } from "../../../policy/ownership/parameter-entry-conversion.js";
import type { Node, Type } from "@tsonic/tsts";
import { isRustVecCarrier, isRustStringCarrier, isRustUnitCarrier, isRustNeverCarrier, rustUnitTargetType, rustOptionElementCarrier, rustSourceOptionalTargetType, isRustJsValueCarrier, rustProgramErrorTargetType, rustTsValueTargetType, rustEmptyObjectTargetType, rustObjectIdentityTargetType, rustCallableInputProtocol, rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";
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
import type { RustSourceCallableReturnFact } from "../../../target-model/records/source-declarations.js";
import type { RustRetainedEnvironment } from "../../../target-model/records/retained-environments.js";
import { selectRustPointerReturnContract } from "../ownership/pointer-return.js";
import { rustGenericCallableValueOwner } from "../../../policy/types/callables/callable-origins.js";
import { resolveRustRetainedResult } from "../../source-evidence/types/resolution/retained-results.js";
import { selectRustInferredReturn, selectRustRetainedReturn, type RustInferredReturnSelection } from "./inferred-return.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import { rustUnionPayloadAdmission } from "../../../policy/conversions/union-injection.js";
import { rustAbsenceTargetType } from "../../../target-model/types/carriers/native.js";
import { requireRustRecord } from "../../program/records/required-records.js";
import { rustSourceCallableReturnFactEquals } from "../../../target-model/records/equality.js";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustLifetimeIndex } from "../../../target-model/lifetimes/index.js";
import type { SourceCallableNativeContract, SourceCallableSourceContract } from "../../../target-model/records/source-callable-contract.js";
import type { RustImplicitConstructorParameter } from "../../../target-model/records/construction.js";

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
  const borrowedParameter = walk.context.sourceCallables.borrowedReturnParameter(declaration);
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
      ...(borrowedParameter !== undefined && borrowedAbi?.mode === "ref" && borrowedAbi.inputLifetime !== undefined &&
        rustTargetTypeRefEquals(borrowedAbi.valueCarrier, carrier) ? { borrowedParameter } : {}),
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

export type RustSourceParameterAbiSelection =
  | { readonly kind: "resolved"; readonly abi: RustSourceParameterAbiFact }
  | { readonly kind: "rejected"; readonly reason: string };

export interface RustSourceCallableAbiResolver {
  canUseSharedBorrow(
    parameter: Node,
    context: RustTargetTypeResolutionContext,
    options: RustTargetTypeResolutionOptions,
  ): boolean;
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
}): RustSourceCallableAbiResolver {
  const cache = new WeakMap<Node, RustSourceParameterAbiFact>();

  return {
    canUseSharedBorrow(parameter, context, options) {
      return parameterCanUseSharedBorrow(parameter, context, options, input.isNativeCallableExpression);
    },
    resolveParameterAbi(parameter, context, options, contextualValueCarrier) {
      const finalized = input.parameterAbiFor(parameter);
      if (finalized !== undefined) return contextualValueCarrier === undefined ||
        rustTargetTypeRefEquals(finalized.valueCarrier, contextualValueCarrier)
        ? Object.freeze({ kind: "resolved" as const, abi: finalized }) : undefined;
      const owner = context.ast.parent(parameter);
      if (owner === undefined || sourceCallableValueParameters(context.ast, owner,
        context.currentSemantics, { kind: "declaration" })?.includes(parameter) !== true) return undefined;
      const cached = contextualValueCarrier === undefined ? cache.get(parameter) : undefined;
      if (cached !== undefined) {
        return Object.freeze({ kind: "resolved" as const, abi: cached });
      }
      const typeNode = Node_Type(context.ast, parameter);
      let base = contextualValueCarrier ?? (typeNode === undefined
        ? resolveRustTargetTypeRef(parameter, context, options)
        : resolveRustTargetTypeRef(typeNode, context, options));
      if (base === undefined) {
        return undefined;
      }
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
      if (form === "required" &&
        (isRustJsValueCarrier(base) || rustTargetTypeRefEquals(base, rustTsValueTargetType()) ||
          rustTargetTypeRefEquals(base, rustEmptyObjectTargetType()) ||
          rustTargetTypeRefEquals(base, rustObjectIdentityTargetType())) &&
        parameterOnlyForwardsThrownValue(parameter, context)) {
        base = rustProgramErrorTargetType();
      }
      const native = validateRustSourceParameterMemberWrites(parameter, base, context, options);
      if (native === undefined || native.kind === "rejected") return native;
      const requiresOwnedValue = parameterUsesFlowState(
        parameter,
        "moved",
        context,
      ) || (isRustVecCarrier(base) || isRustStringCarrier(base)) && parameterRetainsWholeValue(parameter, context);
      const parameterLaneCarrier = form === "required"
        ? requiresOwnedValue || typeNode === undefined
          ? base
          : rustParameterLaneTargetType(base, typeNode, context, options)
        : undefined;
      const borrowCarrier = requiresOwnedValue ? undefined : selectRustSourceParameterBorrowCarrier(base, parameterLaneCarrier);
      const selectedParameterCarrier = borrowCarrier !== undefined &&
        parameterCanUseSharedBorrow(parameter, context, options, input.isNativeCallableExpression)
        ? borrowCarrier : parameterLaneCarrier;
      const abi = selectRustSourceParameterAbi(form, base, selectedParameterCarrier);
      if (abi === undefined) {
        return undefined;
      }
      const named = finalizeRustSourceParameterStorage(parameter, abi, context, options);
      if (named !== undefined && contextualValueCarrier === undefined) cache.set(parameter, named);
      return named === undefined ? undefined : Object.freeze({ kind: "resolved" as const, abi: named });
    },
  };
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
): RustSourceParameterAbiSelection | undefined {
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
  if (abi.form === "required" && abi.entryConversion === undefined && owner !== undefined &&
    !isRustCopyCarrier(abi.valueCarrier) && context.sourceCallables.borrowedReturnParameter(owner) === parameter &&
    !parameterUsesFlowState(parameter, "moved", context)) {
    const lifetime = rustSourceInputLifetime(parameter, context);
    if (lifetime !== undefined) return { ...abi, mode: "ref", inputLifetime: lifetime,
      parameterCarrier: { kind: "reference", referent: abi.valueCarrier, mutable: false, lifetime } };
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

function parameterRetainsWholeValue(parameter: Node, context: RustTargetTypeResolutionContext): boolean {
  if (sourceParameterIsProperty(context.ast, parameter)) return true;
  const callable = enclosingCallable(context.ast.parent(parameter), context);
  if (callable !== undefined && (context.ast.hasModifierKind(callable, "async") ||
    context.semanticsFor(callable).operations.generator(callable) !== undefined)) return true;
  const summary = context.source.navigation.parameterUseSummary(parameter);
  return summary === undefined || summary.uses.some(use => !use.throughMember &&
    (use.captured || use.role === "return" || use.role === "yield" || use.role === "storage" &&
      context.source.navigation.expressionValueFlow(use.reference).escapes));
}

function parameterCanUseSharedBorrow(
  parameter: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  isNativeCallableExpression: (expression: Node) => boolean,
): boolean {
  const { ast } = context;
  const pending = [parameter];
  const visited = new Set<Node>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const name = ast.name(current);
    if (name === undefined || context.source.navigation.sourceReferenceFor(name)?.declaration !== current ||
      ast.body(enclosingCallable(ast.parent(current), context)) === undefined ||
      parameterUsesFlowState(current, "moved", context) || parameterRetainsWholeValue(current, context)) return false;
    const summary = context.source.navigation.parameterUseSummary(current);
    if (summary === undefined || summary.bindingWritten || summary.memberWritten || summary.captured) return false;
    for (const { reference, role, throughMember } of summary.uses) {
      const flow = context.source.sourceFacts.getFact(reference, flowStateFactKey);
      if (flow?.state === "borrowed-shared" || throughMember || role === "receiver" ||
        role === "comparison" || role === "condition" || role === "type-only") continue;
      let operand = reference;
      let call = ast.parent(operand);
      while (call !== undefined && rustSourceValueWrapperContains(call, operand, ast)) {
        const sourceFile = ast.getSourceFile(call);
        if (sourceFile === undefined || !isRustStringCarrier(resolveRustTargetTypeRef(call, {
          ...context,
          currentSourceFile: sourceFile,
          currentSemantics: context.semanticsFor(call),
        }, options))) return false;
        operand = call;
        call = ast.parent(call);
      }
      if (call === undefined || !ast.is.IsCallExpression(call) && !ast.is.IsNewExpression(call)) return false;
      const semantics = context.semanticsFor(call);
      const selected = semantics.operations.call(call);
      if (selected === undefined || selected.sourceArguments.some(argument =>
        ast.is.IsSpreadElement(argument.expression))) return false;
      const argumentIndex = selected.sourceArguments.findIndex(argument => argument.expression === operand);
      const declaration = semantics.declarations.signatureDeclaration(selected.selectedSignature);
      const member = resolveSelectedSourceProfileMember(context, declaration, options.sourceProfiles);
      const errorConstructor = selectRustSourceErrorConstructor(member, ast.is.IsNewExpression(call));
      if (argumentIndex >= 0 && errorConstructor !== undefined) {
        const sourceFile = ast.getSourceFile(call);
        if (sourceFile === undefined) return false;
        const callContext = { ...context, currentSourceFile: sourceFile, currentSemantics: semantics };
        const operation = rustSourceErrorConstructorOperation(errorConstructor, selected.sourceArguments.map(argument =>
          resolveRustTargetTypeRef(argument.expression, callContext, options)));
        if (operation === undefined || !rustProviderArgumentBorrowsString(operation, argumentIndex)) return false;
        continue;
      }
      if (argumentIndex >= 0 && member?.profile === "js") {
        if (!options.jsEnabled) return false;
        const sourceFile = ast.getSourceFile(call);
        if (sourceFile === undefined) return false;
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
        if (operation?.fact.kind !== "provider-operation" ||
          !rustProviderArgumentBorrowsString(operation.fact, argumentIndex)) return false;
        continue;
      }
      const provider = resolveSelectedProviderDeclaration(context, declaration, [
        { subject: selected.selectedSignature, precision: "exact" },
      ]);
      if (argumentIndex >= 0 && provider.kind === "selected") {
        const operation = selectRustProviderOperation(options.providerRows, provider.identity,
          ast.is.IsNewExpression(call) ? "constructor" : "method");
        if (operation.kind !== "selected" || !rustProviderArgumentBorrowsString(operation.row, argumentIndex)) return false;
        continue;
      }
      if (provider.kind === "conflict") return false;
      const sourceFile = ast.getSourceFile(call);
      const callback = argumentIndex < 0 || sourceFile === undefined ? undefined : rustCallableInputProtocol(resolveRustTargetTypeRef(
        selected.sourceCallee.expression, rustSourceStorageSubjectContext({ ...context,
          currentSourceFile: sourceFile, currentSemantics: semantics }, undefined), options));
      if (callback !== undefined) {
        const input = callback.parameters[argumentIndex];
        if (input?.kind !== "reference" || input.mutable ||
          selectRustSourceParameterBorrowCarrier(input.referent, input.referent) === undefined) return false;
        continue;
      }
      const implementation = declaration === undefined ? undefined : context.source.navigation.callableImplementation(declaration);
      if (argumentIndex < 0 || implementation?.kind !== "resolved" ||
        !(ast.is.IsFunctionDeclaration(implementation.implementation.declaration) ||
          isNativeCallableExpression(implementation.implementation.declaration))) return false;
      const parameters = sourceCallableValueParameters(ast, implementation.implementation.declaration,
        context.semanticsFor(implementation.implementation.declaration));
      if (parameters === undefined) return false;
      const destination = parameters[argumentIndex];
      const parameterSyntax = destination === undefined ? undefined : ast.as.AsParameterDeclaration(destination);
      if (destination === undefined || parameterSyntax === undefined || parameterSyntax.DotDotDotToken !== undefined ||
        ast.questionToken(destination) !== undefined || Node_Initializer(ast, destination) !== undefined) return false;
      const destinationFile = ast.getSourceFile(destination);
      if (destinationFile === undefined) return false;
      const carrier = resolveRustTargetTypeRef(Node_Type(ast, destination) ?? destination, {
        ...context,
        currentSourceFile: destinationFile,
        currentSemantics: context.semanticsFor(destination),
      }, options);
      if (carrier === undefined || selectRustSourceParameterBorrowCarrier(carrier, carrier) === undefined) return false;
      pending.push(destination);
    }
  }
  return true;
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
