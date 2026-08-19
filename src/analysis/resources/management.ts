import type {
  Node,
  ResolvedSourceResourceManagementInfo,
} from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../policy/operations/contracts.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import type { TargetTypeRef } from "../../policy/types/model.js";
import { closedMetadataEquals } from "../../policy/model/closed-data.js";
import { Node_Type } from "@tsonic/target-api/source";
import type {
  RustResourceDisposalTarget,
  RustResourceManagementFact,
} from "../facts/keys.js";
import {
  isRustUnitCarrier,
  rustFutureOutputCarrier,
  rustOptionElementCarrier,
} from "../../policy/types/target-types.js";
import type { RustOperationsProviderOptions } from "../operations/provider/index.js";
import {
  isProjectSourceDeclaration,
  resolveSelectedProviderDeclaration,
} from "../../policy/evidence/selected-source.js";
import { selectRustProviderOperation } from "../../policy/operations/provider-selection.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";

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
    }
  | { readonly kind: "rejected"; readonly reason: string };

export function selectRustResourceManagement(
  declaration: Node,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  projectDisposerEffects: (declaration: Node) => RustProjectDisposerEffects | undefined,
): RustResourceManagementSelection {
  const source = context.semanticsFor(declaration)
    .getResolvedResourceManagementInfo(declaration);
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
      alternative.disposal.errorBoundary !== first.disposal.errorBoundary ||
      !optionalCarrierEquals(alternative.disposal.errorCarrier, first.disposal.errorCarrier) ||
      !resourceDisposalTargetsEqual(alternative.disposal.target, first.disposal.target))) {
    return rejected("Rust resource alternatives must resolve to one identical carrier and disposal operation.");
  }
  const storageCarrier = context.facts.getRuntimeCarrierFact(declaration)?.carrier;
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
      : context.semanticsFor(declaration).getResolvedWellKnownSymbolInfo(name);
    const expectedKind = alternative.kind === "sync" ? "dispose" : "async-dispose";
    const effects = projectDisposerEffects(declaration);
    if (wellKnown?.kind !== expectedKind || effects === undefined ||
      effects.async !== (alternative.kind === "async")) {
      return rejected("The selected project-source disposer has no exact Rust well-known method contract.");
    }
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
      disposal: effects.fallible ? {
        kind: alternative.kind,
        fallible: true,
        errorBoundary: "source-program",
        target: {
          form: "source-method",
          name: alternative.kind === "sync" ? "dispose" : "dispose_async",
          receiverMode: effects.selfMode.mode,
        },
      } : {
        kind: alternative.kind,
        fallible: false,
        errorBoundary: "none",
        target: {
          form: "source-method",
          name: alternative.kind === "sync" ? "dispose" : "dispose_async",
          receiverMode: effects.selfMode.mode,
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
  const target = { form: "provider" as const, target: row.target };
  const disposal: RustResourceManagementFact["disposal"] = row.isFallible !== true
    ? {
        kind: alternative.kind,
        fallible: false,
        errorBoundary: "none",
        target,
      }
    : row.errorBoundary === "provider-native"
      ? {
          kind: alternative.kind,
          fallible: true,
          errorBoundary: "provider-native",
          errorCarrier: row.errorCarrier,
          target,
        }
      : {
          kind: alternative.kind,
          fallible: true,
          errorBoundary: row.errorBoundary,
          target,
        };
  return {
    kind: "selected",
    resourceCarrier,
    disposal,
  };
}

function optionalCarrierEquals(
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && rustTargetTypeRefEquals(left, right);
}

function providerDisposalTargetIsSupported(
  target: import("../../policy/operations/model.js").RustProviderOperationForm,
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
    return left.name === right.name && left.receiverMode === right.receiverMode;
  }
  return left.form === "provider" && right.form === "provider" &&
    closedMetadataEquals(left.target, right.target);
}

function rejected(reason: string): Extract<RustResourceManagementSelection, { readonly kind: "rejected" }> {
  return { kind: "rejected", reason };
}
