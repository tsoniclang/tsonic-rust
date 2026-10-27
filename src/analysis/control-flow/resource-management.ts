import { KindVariableDeclaration } from "@tsonic/target-api/source";
import { appendRustDiagnostic, rustOperationContext, type RustFactWalk } from "../program/walk.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import type { RustOperationPolicyContext } from "../../policy/model/operation-context.js";

import type {
  Node,
  ResolvedSourceResourceManagementInfo,
} from "@tsonic/tsts";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { Node_Type } from "@tsonic/target-api/source";
import type { RustResourceDisposalTarget, RustResourceManagementFact } from "../../target-model/records/callables/callables-and-resources.js";
import {
  isRustUnitCarrier,
  rustFutureOutputCarrier,
  rustOptionElementCarrier,
} from "../../target-model/types/index.js";
import type { RustOperationsProviderOptions } from "../operations/members/index.js";
import {
  isProjectSourceDeclaration,
  resolveSelectedProviderDeclaration,
} from "../../policy/identities/selected-source.js";
import { selectRustProviderOperation } from "../../policy/operations/provider-selection.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { rustProjectCallableTargetName } from "../names/source-member-name.js";
import { finalizeRustProviderOperationAbi } from "../../policy/operations/members/abi/finalize.js";
import { isRustFinalizedSourceInput } from "../../target-model/operations/finalized-inputs.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import { rustOperationAbiInvocationIsFallible, rustOperationAbiAwaitIsFallible } from "../../policy/operations/members/native-contracts.js";

export interface RustProjectDisposerEffects {
  readonly selfMode: { readonly mode: "ref" | "mut-ref" };
  readonly async: boolean;
  readonly fallible: boolean;
}

export type RustResourceManagementSelection =
  | {
      readonly kind: "selected";
      readonly source: ResolvedSourceResourceManagementInfo;
      readonly fact: RustResourceManagementFact;
      readonly projectDisposerDeclarations: readonly Node[];
    }
  | { readonly kind: "rejected"; readonly reason: string };

export function selectRustResourceManagement(
  declaration: Node,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  projectDisposerEffects: (declaration: Node) => RustProjectDisposerEffects | undefined,
): RustResourceManagementSelection {
  const source = context.semanticsFor(declaration)
    .operations.resourceManagement(declaration);
  if (source === undefined) {
    return rejected("TSTS did not retain exact checked resource-management evidence for this declaration.");
  }
  if (source.disposal.kind !== "selected") {
    return rejected("Untyped dynamic resource disposal has no closed Rust target operation.");
  }
  const selectedAlternatives = source.disposal.alternatives.map((alternative) =>
    selectDisposalAlternative(
      alternative,
      context,
      options,
      projectDisposerEffects,
    ));
  const rejectedAlternative = selectedAlternatives.find((alternative) =>
    alternative.kind === "rejected");
  if (rejectedAlternative?.kind === "rejected") {
    return rejected(rejectedAlternative.reason);
  }
  const alternatives = selectedAlternatives as readonly SelectedDisposalAlternative[];
  const [first] = alternatives;
  if (first === undefined || alternatives.some((alternative) =>
      !rustTargetTypeRefEquals(alternative.resourceCarrier, first.resourceCarrier) ||
      alternative.disposal.kind !== first.disposal.kind ||
      alternative.disposal.fallible !== first.disposal.fallible ||
      !resourceDisposalTargetsEqual(alternative.disposal.target, first.disposal.target))) {
    return rejected("Rust resource alternatives must resolve to one identical carrier and disposal operation.");
  }
  const storageCarrier = context.records.runtimeCarrier.get(declaration)?.carrier;
  if (storageCarrier === undefined) {
    return rejected("The exact selected resource has no closed Rust storage carrier.");
  }
  const nullableElement = rustOptionElementCarrier(storageCarrier);
  const directStorageCarrier = nullableElement ?? storageCarrier;
  if (!rustTargetTypeRefEquals(directStorageCarrier, first.resourceCarrier)) {
    return rejected("The selected Rust resource carrier does not match its exact storage carrier.");
  }
  return {
    kind: "selected",
    source,
    projectDisposerDeclarations: Object.freeze([
      ...new Set(alternatives.flatMap((alternative) =>
        alternative.projectDisposerDeclaration === undefined
          ? []
          : [alternative.projectDisposerDeclaration])),
    ]),
    fact: {
      declarationKind: source.declarationKind,
      storageCarrier,
      resourceCarrier: first.resourceCarrier,
      nullable: nullableElement !== undefined,
      disposal: first.disposal,
    },
  };
}

interface SelectedDisposalAlternative {
  readonly kind: "selected";
  readonly resourceCarrier: TargetTypeRef;
  readonly disposal: RustResourceManagementFact["disposal"];
  readonly projectDisposerDeclaration?: Node;
}

type ResolvedSourceDisposalAlternative = Extract<
  ResolvedSourceResourceManagementInfo["disposal"],
  { readonly kind: "selected" }
>["alternatives"][number];

function selectDisposalAlternative(
  alternative: ResolvedSourceDisposalAlternative,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  projectDisposerEffects: (declaration: Node) => RustProjectDisposerEffects | undefined,
): SelectedDisposalAlternative | Extract<RustResourceManagementSelection, { readonly kind: "rejected" }> {
  const resourceCarrier = resolveRustTargetTypeRef(
    alternative.sourceType,
    context,
    options,
  );
  if (resourceCarrier === undefined) {
    return rejected("An exact selected resource alternative has no closed Rust carrier.");
  }
  if (isProjectSourceDeclaration(context, alternative.selectedDeclaration)) {
    const declaration = alternative.selectedDeclaration;
    const name = context.ast.name(declaration);
    const wellKnown = name === undefined
      ? undefined
      : context.semanticsFor(declaration).operations.wellKnownSymbol(name);
    const expectedKind = alternative.kind === "sync" ? "dispose" : "async-dispose";
    const effects = projectDisposerEffects(declaration);
    const targetName = rustProjectCallableTargetName(declaration, context);
    const owner = options.projectTypes.definitionContainingDeclaration(declaration);
    if (wellKnown?.kind !== expectedKind || effects === undefined ||
      targetName === undefined || owner === undefined ||
      effects.async !== (alternative.kind === "async")) {
      return rejected("The selected project-source disposer has no exact Rust well-known method contract.");
    }
    const polymorphic = options.projectTypes.isPolymorphic(owner);
    const relationship = polymorphic
      ? options.projectTypes.relationship(resourceCarrier, owner)
      : undefined;
    const dispatchVariant = polymorphic
      ? options.projectMethodDispatch.variantForMember(declaration, [])
      : undefined;
    if (polymorphic && (relationship?.kind !== "related" || dispatchVariant === undefined)) {
      return rejected("The selected project-source disposer has no exact Rust dispatch contract.");
    }
    const dispatch = relationship?.kind === "related" && dispatchVariant !== undefined
      ? {
          virtualSlot: dispatchVariant.virtualSlot,
          ownerCarrier: relationship.targetType,
        }
      : undefined;
    const sourceResult = resolveRustTargetTypeRef(
      Node_Type(context.ast, declaration),
      context,
      options,
    );
    const output = effects.async
      ? rustFutureOutputCarrier(sourceResult)
      : sourceResult;
    if (!isRustUnitCarrier(output)) {
      return rejected("The selected project-source disposer must have an exact void result.");
    }
    return {
      kind: "selected",
      resourceCarrier,
      projectDisposerDeclaration: declaration,
      disposal: {
        kind: alternative.kind,
        fallible: effects.fallible,
        target: {
          form: "source-method",
          name: targetName,
          receiverMode: effects.selfMode.mode,
          errorBoundary: effects.fallible ? "source-program" : "none",
          ...(dispatch === undefined ? {} : { dispatch }),
        },
      },
    };
  }

  const provider = resolveSelectedProviderDeclaration(
    context,
    alternative.selectedDeclaration,
    [{ subject: alternative.selectedSymbol, precision: "exact" }],
  );
  if (provider.kind !== "selected") {
    return rejected(provider.kind === "conflict"
      ? "The selected resource disposer carries conflicting provider identities."
      : "The selected resource disposer has no project-source or provider identity.");
  }
  const selected = selectRustProviderOperation(
    options.providerRows,
    provider.identity,
    "method",
  );
  if (selected.kind !== "selected") {
    return rejected(selected.kind === "ambiguous"
      ? "The selected provider resource disposer maps to multiple Rust operation rows."
      : "The selected provider resource disposer has no Rust operation row.");
  }
  const row = selected.row;
  if ((row.parameterCarriers?.length ?? 0) !== 0 ||
    (row.isAsync === true) !== (alternative.kind === "async") ||
    !providerDisposalTargetIsSupported(row.target)) {
    return rejected("The selected provider resource disposer has no exact zero-argument Rust receiver operation.");
  }
  if (!isRustUnitCarrier(row.resultCarrier)) {
    return rejected("The selected provider resource disposer must have an exact void result.");
  }
  const dispatchInputs = (row.dispatchInputs ?? []).map(input => options.dispatchContextInputFor(input));
  if (dispatchInputs.some(input => input === undefined)) return rejected("The selected provider disposer requires its exact native dispatch context inputs.");
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "method", form: row.target,
    sourceReceiver: { kind: "runtime", carrier: resourceCarrier,
      ...(row.receiverCarrier === undefined ? {} : { declaredCarrier: row.receiverCarrier }) },
    sourceArgumentCarriers: [], declaredSourceArgumentCarriers: row.parameterCarriers,
    resultCarrier: row.resultCarrier, resultConversion: row.resultConversion,
    targetGenericArguments: row.targetGenericArguments, dispatchInputs: dispatchInputs.filter(input => input !== undefined),
    isAsync: row.isAsync === true, isFallible: row.isFallible === true,
    errorBoundary: row.isFallible === true ? row.errorBoundary : undefined,
    errorCarrier: row.isFallible === true && row.errorBoundary === "provider-native" ? row.errorCarrier : undefined,
    ...(Object.prototype.hasOwnProperty.call(row, "nativeErrorCarriers") ? { nativeErrorCarriers: row.nativeErrorCarriers } : {}), isUnsafe: row.isUnsafe,
    evaluation: row.evaluation,
  }, context.typeDefinitions);
  if (abi === undefined) return rejected("The selected provider resource disposer has no complete finalized Rust operation ABI.");
  const receiverInput = abi.targetReceiver.kind === "input" ? abi.targetReceiver.input
    : abi.targetArguments.find(input => isRustFinalizedSourceInput(input) && input.source.kind === "receiver");
  if (receiverInput === undefined || !isRustFinalizedSourceInput(receiverInput)) {
    return rejected("The selected provider resource disposer has no exact native resource input.");
  }
  const conversion = receiverInput.conversion.kind === "sequence" ? receiverInput.conversion.steps[0] : receiverInput.conversion;
  const receiverMode = conversion?.kind === "semantic"
    ? rustValueConversionContract(conversion.conversion, context.typeDefinitions)?.sourceMode
    : conversion?.kind === "identity" ? receiverInput.mode : undefined;
  if (receiverMode === undefined) return rejected("The selected provider disposer has no exact pre-conversion resource mode.");
  const target = { form: "provider" as const, abi, receiverMode };
  const fallible = rustOperationAbiInvocationIsFallible(abi) || rustOperationAbiAwaitIsFallible(abi);
  return {
    kind: "selected",
    resourceCarrier,
    disposal: { kind: alternative.kind, fallible, target },
  };
}

function providerDisposalTargetIsSupported(
  target: import("../../target-model/operations/model.js").RustProviderOperationForm,
): boolean {
  return target.form === "method" ||
    target.form === "receiver-method" ||
    target.form === "free-call";
}

function resourceDisposalTargetsEqual(
  left: RustResourceDisposalTarget,
  right: RustResourceDisposalTarget,
): boolean {
  if (left.form !== right.form) {
    return false;
  }
  if (left.form === "source-method" && right.form === "source-method") {
    return left.name === right.name && left.receiverMode === right.receiverMode &&
      left.errorBoundary === right.errorBoundary &&
      (left.dispatch === undefined ? right.dispatch === undefined
        : right.dispatch !== undefined && left.dispatch.virtualSlot === right.dispatch.virtualSlot &&
          rustTargetTypeRefEquals(left.dispatch.ownerCarrier, right.dispatch.ownerCarrier));
  }
  return left.form === "provider" && right.form === "provider" &&
    left.receiverMode === right.receiverMode && closedMetadataEquals(left.abi, right.abi);
}

function rejected(reason: string): Extract<RustResourceManagementSelection, { readonly kind: "rejected" }> {
  return { kind: "rejected", reason };
}

export function recordResourceManagementFacts(walk: RustFactWalk): void {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  for (const declaration of walk.context.nativeNodes) {
    if (ast.kindName(declaration) !== KindVariableDeclaration) continue;
    const declarationKind = ast.variableDeclarationKind(declaration);
    if (declarationKind !== "using" && declarationKind !== "await using") continue;
    requireRustRecord(walk.context.requiredRecords, "resourceManagement", declaration,
      declarationKind, "recordResourceManagementFacts");
    const selected = walk.context.records.resourceManagementPlans.select(
      declaration,
      rustOperationContext(walk, declaration),
      walk.operationOptions,
      (method) => {
        const selfMode = walk.context.records.selfMode.get(method);
        if (selfMode === undefined) return undefined;
        return {
          selfMode,
          async: walk.context.records.asyncFunction.get(method) !== undefined,
          fallible: walk.context.records.fallible.get(method) !== undefined,
        };
      },
    );
    if (selected.kind === "rejected") {
      appendRustDiagnostic(
        walk,
        "RUST_RESOURCE_MANAGEMENT_NOT_PROVEN",
        selected.reason,
        declaration,
        ["target.capability=rust.resource-management.selected-disposer"],
      );
      continue;
    }
    walk.context.generatedDeclarationUses.record(declaration, selected.projectDisposerDeclarations);
  }
}
