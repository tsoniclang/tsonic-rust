import type { Node } from "@tsonic/tsts";
import { createSourceStorageBudget, defaultSourceStorageLimits, type SourceStorageBindings,
  type SourceStorageBoundActivation, type SourceStorageLimits, type SourceStorageQueries,
  type SourceStorageSubject, type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { RustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import type { RustFinalizedNativeResultLoans, RustFinalizedValueConversion } from "../../target-model/records/finalized-operation.js";
import type { RustNativeInputPlace } from "../../target-model/records/ownership.js";
import type { RustCallableEmissionContexts, RustEmissionProviderOperation,
  RustPhysicalEmissionContext } from "../../target-model/records/physical-emission-contexts.js";
import type { RustNativeResultLoan, RustNativeResultLoanOrigin } from "../../target-model/operations/result-loans.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

export interface RustNativeResultPlaceLoan {
  readonly declaration: RustNativeResultLoan;
  readonly resultPath: readonly string[];
  readonly origins: readonly { readonly declaration: RustNativeResultLoanOrigin; readonly input: RustNativeInputPlace;
    readonly kind: "borrow" | "carried" }[];
}

export type RustNativeResultPlaceSelection =
  | { readonly kind: "resolved"; readonly node: Node; readonly operation: RustEmissionProviderOperation;
      readonly context: RustPhysicalEmissionContext; readonly carrier: TargetTypeRef;
      readonly native: RustFinalizedNativeResultLoans; readonly loans: readonly RustNativeResultPlaceLoan[] }
  | { readonly kind: "unavailable"; readonly node: Node; readonly reasons: readonly string[] };

export type RustResultLoanSourceSelection =
  | { readonly kind: "resolved"; readonly context: RustPhysicalEmissionContext;
      readonly alternatives: readonly { readonly activation: SourceStorageBoundActivation;
        readonly loans: readonly { readonly native: RustNativeResultPlaceLoan;
          readonly origins: readonly { readonly native: RustNativeResultPlaceLoan["origins"][number];
            readonly subject: SourceStorageSubject; readonly sources: readonly SourceStorageSubject[] }[] }[] }[] }
  | { readonly kind: "unavailable"; readonly node: Node; readonly reasons: readonly string[] };

export function selectRustResultLoanSources(
  selected: Extract<RustNativeResultPlaceSelection, { readonly kind: "resolved" }>,
  bindings: SourceStorageBindings,
  input: { readonly storage: SourceStorageQueries; readonly limits?: Partial<SourceStorageLimits> },
): RustResultLoanSourceSelection {
  const unavailable = (...reasons: readonly string[]): RustResultLoanSourceSelection =>
    Object.freeze({ kind: "unavailable", node: selected.node, reasons: Object.freeze([...reasons]) });
  if (selected.loans.length === 0) return Object.freeze({ kind: "resolved", context: selected.context,
    alternatives: Object.freeze([]) });
  const budget = createSourceStorageBudget({ ...defaultSourceStorageLimits, ...input.limits });
  const subjects = new Map<RustNativeInputPlace, SourceStorageSubject>();
  for (const loan of selected.loans) for (const origin of loan.origins) {
    if (subjects.has(origin.input)) continue;
    if (!budget.node() || !budget.step() || !budget.row()) return unavailable(budget.failure()!);
    const subject = input.storage.subjectFor(origin.input.node);
    if (subject.kind === "unresolved") return unavailable(subject.reason);
    subjects.set(origin.input, subject.subject);
  }
  const activation = input.storage.boundActivationsFor(selected.context.declaration, bindings);
  if (activation.kind === "unresolved") return unavailable(activation.reason);
  if (activation.activations.length === 0) return unavailable("The returned native loan has no original owning source activation.");
  const alternatives: Extract<RustResultLoanSourceSelection, { readonly kind: "resolved" }>["alternatives"][number][] = [];
  for (const actual of activation.activations) {
    if (!budget.step() || !budget.row()) return unavailable(budget.failure()!);
    if (actual.declaration !== selected.context.declaration)
      return unavailable("A native result loan source requires the original owning source activation.");
    const sources = new Map<SourceStorageSubject, readonly SourceStorageSubject[]>();
    const loans: typeof alternatives[number]["loans"][number][] = [];
    for (const loan of selected.loans) {
      const origins: typeof loans[number]["origins"][number][] = [];
      for (const native of loan.origins) {
        if (!budget.step() || !budget.row()) return unavailable(budget.failure()!);
        const subject = subjects.get(native.input)!;
        let selectedSources = sources.get(subject);
        if (selectedSources === undefined) {
          const origins = input.storage.boundOriginsFor(subject, actual.bindings);
          if (origins.kind === "unresolved") return unavailable(origins.reason);
          for (const source of origins.subjects) {
            if (!budget.row() || !budget.step()) return unavailable(budget.failure()!);
            if (source === undefined) return unavailable("A native loan source requires a dense original source-subject selection.");
          }
          selectedSources = origins.subjects;
          sources.set(subject, selectedSources);
        }
        origins.push(Object.freeze({ native, subject, sources: selectedSources }));
      }
      loans.push(Object.freeze({ native: loan, origins: Object.freeze(origins) }));
    }
    alternatives.push(Object.freeze({ activation: actual, loans: Object.freeze(loans) }));
  }
  return Object.freeze({ kind: "resolved", context: selected.context, alternatives: Object.freeze(alternatives) });
}

export function selectRustNativeResultPlaces(
  node: Node, operation: RustEmissionProviderOperation, contextUse: TargetUseSiteRef,
  input: { readonly physicalEmissionContexts: RustCallableEmissionContexts;
    readonly nativePlaces: ReadonlyMap<TargetUseSiteRef, RustNativeInputPlace>; readonly definitions: RustTypeDefinitions },
): RustNativeResultPlaceSelection {
  const unavailable = (...reasons: readonly string[]): RustNativeResultPlaceSelection =>
    Object.freeze({ kind: "unavailable", node, reasons: Object.freeze([...reasons]) });
  const context = input.physicalEmissionContexts.contextFor(contextUse);
  const occurrence = input.physicalEmissionContexts.sourceFor(node, operation);
  if (context === undefined || occurrence === undefined || occurrence.operation !== operation || occurrence.node !== node)
    return unavailable("The returned-loan relation requires its original operation and exact physical context.");
  const result = operation.abi.result;
  const native = result.resultLoans;
  if (native === undefined) return unavailable("The native declaration has no published result/formal lifetime correspondence.");
  if (native.contract.kind === "unavailable") return unavailable(...native.contract.reasons);
  const sourceCarrier = result.kind === "sync" ? result.carrier : result.awaitedCarrier;
  const carrier = input.physicalEmissionContexts.carrierFor(contextUse, sourceCarrier);
  if (carrier === undefined) return unavailable("The returned-loan relation has no actual selected result carrier.");
  const conversion = result.kind === "sync" ? result.conversion : result.awaitedConversion;
  const places = new Map<RustFinalizedNativeResultLoans["loans"][number]["origins"][number]["input"], RustNativeInputPlace[]>();
  for (const place of input.nativePlaces.values()) {
    const origin = place.operand.origin;
    if (origin.kind !== "call-input" || origin.operationNode !== node || origin.operation !== operation ||
      place.operand.context !== context) continue;
    const values = places.get(place.input) ?? [];
    values.push(place);
    places.set(place.input, values);
  }
  const loans: RustNativeResultPlaceLoan[] = [];
  for (const selected of native.loans) {
    const path = convertedResultPath(selected.loan.resultPath, conversion, input.definitions);
    if (path === undefined) return unavailable("The selected native result conversion has no established returned-loan path transport.");
    if (path === null) continue;
    const origins: RustNativeResultPlaceLoan["origins"][number][] = [];
    for (const origin of selected.origins) {
      const actual = places.get(origin.input);
      if (actual?.length !== 1) return unavailable("A returned native loan has no unique original input-use place in this physical context.");
      const kind = inputLoanKind(origin.origin.kind, origin.input.conversion, input.definitions);
      if (kind === undefined)
        return unavailable("The native input conversion does not establish that the returned loan refers to the authored source place.");
      origins.push(Object.freeze({ declaration: origin.origin, input: actual[0]!, kind }));
    }
    loans.push(Object.freeze({ declaration: selected.loan, resultPath: path, origins: Object.freeze(origins) }));
  }
  return Object.freeze({ kind: "resolved", node, operation, context, carrier, native, loans: Object.freeze(loans) });
}

function inputLoanKind(kind: "borrow" | "carried", conversion: RustFinalizedValueConversion,
  definitions: RustTypeDefinitions): "borrow" | "carried" | undefined {
  if (conversion.kind === "identity") return kind;
  if (conversion.kind === "sequence") {
    let selected: "borrow" | "carried" | undefined = kind;
    for (let index = conversion.steps.length - 1; index >= 0; index -= 1) {
      if (selected === undefined) return undefined;
      selected = inputLoanKind(selected, conversion.steps[index]!, definitions);
    }
    return selected;
  }
  const contract = rustValueConversionContract(conversion.conversion, definitions);
  return contract?.lowering === "identity" ? kind
    : contract?.lowering === "borrowed-str-from-owned-string" || contract?.lowering === "borrowed-str-from-optional-string"
      ? "borrow" : undefined;
}

function convertedResultPath(path: readonly string[], conversion: RustFinalizedValueConversion,
  definitions: RustTypeDefinitions): readonly string[] | null | undefined {
  if (conversion.kind === "identity") return path;
  if (conversion.kind === "sequence") {
    let selected: readonly string[] | null | undefined = path;
    for (const step of conversion.steps) {
      if (selected === null || selected === undefined) return selected;
      selected = convertedResultPath(selected, step, definitions);
    }
    return selected;
  }
  const contract = rustValueConversionContract(conversion.conversion, definitions);
  return contract === undefined ? undefined : contractResultPath(path, contract);
}

function contractResultPath(path: readonly string[], contract: RustValueConversionContract): readonly string[] | null | undefined {
  switch (contract.lowering) {
    case "identity": return path;
    case "owned-string-from-borrowed-str": return null;
    case "copy-from-reference":
      return path.length === 1 && path[0] === "reference" ? null
        : path[0] === "referent" ? Object.freeze(path.slice(1)) : undefined;
    case "option-map": {
      if (path[0] !== "argument:0") return undefined;
      const selected = contractResultPath(path.slice(1), contract.element);
      return selected === null || selected === undefined ? selected : Object.freeze(["argument:0", ...selected]);
    }
    default: return undefined;
  }
}
