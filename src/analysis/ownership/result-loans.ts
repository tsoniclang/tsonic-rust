import type { Node } from "@tsonic/tsts";
import { createSourceStorageBudget, defaultSourceStorageLimits,
  type SourceStorageLimits, type SourceStorageQueries,
  type SourceStorageSubject, type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { RustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import type { RustFinalizedNativeResultLoans, RustFinalizedValueConversion } from "../../target-model/records/finalized-operation.js";
import type { RustNativeInputOwnership, RustNativeResultLoanIndex, RustPreparedNativeResultOwnership,
  RustNativeResultPlaceLoan, RustNativeResultPlaceSelection,
  RustResultLoanSourceSelection } from "../../target-model/records/ownership.js";
import type { RustCallableEmissionContexts, RustEmissionProviderOperation,
  RustPhysicalEmissionContext } from "../../target-model/records/physical-emission-contexts.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

export function analyzeRustNativeResultLoans(input: {
  readonly storage: SourceStorageQueries;
  readonly physicalEmissionContexts: RustCallableEmissionContexts;
  readonly nativeInputs: ReadonlyMap<TargetUseSiteRef, RustNativeInputOwnership>;
  readonly definitions: RustTypeDefinitions;
  readonly limits?: Partial<SourceStorageLimits>;
}): RustNativeResultLoanIndex<RustPreparedNativeResultOwnership> {
  const inputs = new Map<RustPhysicalEmissionContext,
    Map<RustEmissionProviderOperation, Map<Node, Map<TargetUseSiteRef, RustNativeInputOwnership>>>>();
  for (const place of input.nativeInputs.values()) {
    const origin = place.operand.origin;
    if (origin.kind !== "call-input") throw new Error("Native result inputs require original admitted call-input places.");
    const operations = inputs.get(place.operand.context) ??
      new Map<RustEmissionProviderOperation, Map<Node, Map<TargetUseSiteRef, RustNativeInputOwnership>>>();
    const nodes = operations.get(origin.operation) ?? new Map<Node, Map<TargetUseSiteRef, RustNativeInputOwnership>>();
    const places = nodes.get(origin.operationNode) ?? new Map<TargetUseSiteRef, RustNativeInputOwnership>();
    places.set(place.operand.use, place);
    nodes.set(origin.operationNode, places);
    operations.set(origin.operation, nodes);
    inputs.set(place.operand.context, operations);
  }
  const results = new Map<Node, Map<RustEmissionProviderOperation, Map<TargetUseSiteRef, RustPreparedNativeResultOwnership>>>();
  const emptyInputs: ReadonlyMap<TargetUseSiteRef, RustNativeInputOwnership> = new Map();
  for (const context of input.physicalEmissionContexts.contexts) {
    if (input.physicalEmissionContexts.contextFor(context.use) !== context)
      throw new Error("Native returned-loan admission requires each original completed physical context.");
    for (const origins of context.sourceOrigins) {
      const { occurrence } = origins;
      const { node, operation } = occurrence;
      if (origins.use !== context.use || input.physicalEmissionContexts.sourceFor(node, operation) !== occurrence ||
        input.physicalEmissionContexts.sourceOriginFor(context.use, occurrence) !== origins)
        throw new Error("Native returned-loan admission requires its original per-use operation source correspondence.");
      const operations = results.get(node) ?? new Map<RustEmissionProviderOperation, Map<TargetUseSiteRef, RustPreparedNativeResultOwnership>>();
      const contexts = operations.get(operation) ?? new Map<TargetUseSiteRef, RustPreparedNativeResultOwnership>();
      if (contexts.has(context.use)) throw new Error("Native returned-loan admission requires one row per original operation and physical context.");
      const nativeInputs = inputs.get(context)?.get(operation)?.get(node) ?? emptyInputs;
      const place = selectRustNativeResultPlaces(node, operation, context.use, {
        physicalEmissionContexts: input.physicalEmissionContexts, nativeInputs, definitions: input.definitions,
      });
      const source = place.kind === "unavailable" ? place : selectRustResultLoanSources(place, input);
      contexts.set(context.use, Object.freeze({ node, operation, context, place, source }));
      operations.set(operation, contexts);
      results.set(node, operations);
    }
  }
  return results;
}

export function selectRustResultLoanSources(
  selected: Extract<RustNativeResultPlaceSelection, { readonly kind: "resolved" }>,
  input: { readonly storage: SourceStorageQueries; readonly physicalEmissionContexts: RustCallableEmissionContexts;
    readonly limits?: Partial<SourceStorageLimits> },
): RustResultLoanSourceSelection {
  const unavailable = (...reasons: readonly string[]): RustResultLoanSourceSelection =>
    Object.freeze({ kind: "unavailable", node: selected.node, reasons: Object.freeze([...reasons]) });
  if (input.physicalEmissionContexts.contextFor(selected.context.use) !== selected.context ||
    !input.physicalEmissionContexts.contexts.includes(selected.context))
    return unavailable("A returned native loan requires its original completed physical context.");
  if (selected.loans.length === 0) return Object.freeze({ kind: "resolved", context: selected.context, sourceOrigins: undefined,
    alternatives: Object.freeze([]) });
  const occurrence = input.physicalEmissionContexts.sourceFor(selected.node, selected.operation);
  if (occurrence === undefined || occurrence.node !== selected.node || occurrence.operation !== selected.operation)
    return unavailable("A returned native loan requires its original completed operation occurrence.");
  const sourceOrigins = input.physicalEmissionContexts.sourceOriginFor(selected.context.use, occurrence);
  if (sourceOrigins === undefined || !selected.context.sourceOrigins.includes(sourceOrigins) ||
    sourceOrigins.use !== selected.context.use || sourceOrigins.occurrence !== occurrence)
    return unavailable("A returned native loan requires the exact source-origin record for its context and operation occurrence.");
  if (sourceOrigins.kind === "unavailable") return unavailable(sourceOrigins.reason);
  if (sourceOrigins.kind === "open") return unavailable("The returned native loan has an open source-origin domain.");
  if (sourceOrigins.alternatives.length === 0)
    return unavailable("The returned native loan has no original source execution alternative.");
  const budget = createSourceStorageBudget({ ...defaultSourceStorageLimits, ...input.limits });
  const subjects = new Map<RustNativeInputOwnership, SourceStorageSubject>();
  for (const loan of selected.loans) for (const origin of loan.origins) {
    if (subjects.has(origin.input)) continue;
    if (!budget.node() || !budget.step() || !budget.row()) return unavailable(budget.failure()!);
    const subject = input.storage.subjectFor(origin.input.node);
    if (subject.kind === "unresolved") return unavailable(subject.reason);
    subjects.set(origin.input, subject.subject);
  }
  const alternatives: Extract<RustResultLoanSourceSelection, { readonly kind: "resolved" }>["alternatives"][number][] = [];
  for (const origin of sourceOrigins.alternatives) {
    if (!budget.step() || !budget.row()) return unavailable(budget.failure()!);
    const bindings = origin.kind === "module" || origin.kind === "construction"
      ? origin.selection.bindings : origin.activation.bindings;
    const sources = new Map<SourceStorageSubject, readonly SourceStorageSubject[]>();
    const loans: typeof alternatives[number]["loans"][number][] = [];
    for (const loan of selected.loans) {
      const origins: typeof loans[number]["origins"][number][] = [];
      for (const native of loan.origins) {
        if (!budget.step() || !budget.row()) return unavailable(budget.failure()!);
        const subject = subjects.get(native.input)!;
        let selectedSources = sources.get(subject);
        if (selectedSources === undefined) {
          const origins = input.storage.boundOriginsFor(subject, bindings);
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
    alternatives.push(Object.freeze({ origin, bindings, loans: Object.freeze(loans) }));
  }
  return Object.freeze({ kind: "resolved", context: selected.context, sourceOrigins, alternatives: Object.freeze(alternatives) });
}

export function selectRustNativeResultPlaces(
  node: Node, operation: RustEmissionProviderOperation, contextUse: TargetUseSiteRef,
  input: { readonly physicalEmissionContexts: RustCallableEmissionContexts;
    readonly nativeInputs: ReadonlyMap<TargetUseSiteRef, RustNativeInputOwnership>; readonly definitions: RustTypeDefinitions },
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
  if (result.kind === "async" && native.contract.inputLoans.kind === "unavailable") return unavailable(...native.contract.inputLoans.reasons);
  const carrier = input.physicalEmissionContexts.carrierFor(contextUse, result.kind === "async" ? result.futureCarrier : result.carrier);
  if (carrier === undefined) return unavailable("The returned-loan relation has no actual selected result carrier.");
  const conversion = result.kind === "async" ? result.awaitedConversion : result.conversion;
  const places = new Map<RustFinalizedNativeResultLoans["loans"][number]["origins"][number]["input"], RustNativeInputOwnership[]>();
  for (const place of input.nativeInputs.values()) {
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
    const origins = bindOrigins(selected.origins);
    if (origins === undefined) return unavailable("The native input conversion does not establish each returned loan's original physical input use.");
    loans.push(Object.freeze({ kind: "value", declaration: selected.loan, resultPath: path, origins }));
  }
  if (result.kind === "async") for (const selected of native.inputLoans) {
    const origins = bindOrigins([selected]);
    if (origins === undefined) return unavailable("The native pending input conversion does not establish its original physical input use.");
    loans.push(Object.freeze({ kind: "pending", declaration: selected.origin, origins }));
  }
  return Object.freeze({ kind: "resolved", node, operation, context, carrier, native, loans: Object.freeze(loans) });

  function bindOrigins(selected: RustFinalizedNativeResultLoans["loans"][number]["origins"]): RustNativeResultPlaceLoan["origins"] | undefined {
    const origins: RustNativeResultPlaceLoan["origins"][number][] = [];
    for (const origin of selected) {
      const actual = places.get(origin.input);
      if (actual?.length !== 1) return undefined;
      const selectedInput = actual[0]!;
      const declaredKind = inputLoanKind(origin.origin.kind, origin.input.conversion, input.definitions);
      const kind = declaredKind === "borrow" && selectedInput.kind === "value" &&
        origin.input.conversion.kind === "identity" && origin.input.sourceCarrier.kind === "reference" ? "carried" : declaredKind;
      if (kind === undefined || kind === "borrow" && selectedInput.kind !== "place")
        return undefined;
      origins.push(Object.freeze({ declaration: origin.origin, input: selectedInput, kind }));
    }
    return Object.freeze(origins);
  }
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
