import type { Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetGenericReferences, type RustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { normalizeRustErrorType, type RustErrorTypeContext } from "../errors/error-types.js";

import type { RustNativeCallableInput } from "./native-inputs.js";
import type { RustNativeStoragePlan } from "./native-storage.js";

export type RustNativeCaptureSelection =
  | { readonly kind: "resolved"; readonly captures: readonly TargetTypeRef[];
      readonly receiverFields: readonly TargetTypeRef[]; readonly receivers: readonly TargetTypeRef[];
      readonly inputs: readonly RustNativeCallableInput[]; readonly environment: RustTargetGenericReferences }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustNativeCapturePlan {
  forDeclaration(declaration: Node): RustNativeCaptureSelection;
}

export interface RustNativeCaptureConstruction extends RustNativeCapturePlan {
  require(declaration: Node): RustNativeCaptureSelection;
  complete(): RustNativeCapturePlan;
}

export function completeRustNativeCaptureCarrier(
  declaration: Node,
  physicalCaptures: RustNativeCaptureSelection,
  bindings: RustTargetGenericBindings,
  errorTypes: RustErrorTypeContext,
): { readonly kind: "resolved"; readonly carrier: TargetTypeRef } | { readonly kind: "unresolved"; readonly reason: string } {
  if (physicalCaptures.kind === "unresolved") return physicalCaptures;
  const captured: TargetTypeRef = { kind: "tuple",
    elements: [...physicalCaptures.captures, ...physicalCaptures.receiverFields, ...physicalCaptures.receivers] };
  const bound = substituteRustTargetGenerics(captured, bindings.types, bindings.lifetimes, bindings.consts);
  const carrier = normalizeRustErrorType(bound, errorTypes, declaration);
  return carrier === undefined
    ? Object.freeze({ kind: "unresolved", reason: "Native captured storage requires its actual admitted physical error-boundary carriers." })
    : Object.freeze({ kind: "resolved", carrier });
}

export function createRustNativeCapturePlan(input: {
  readonly records: RustProgramRecords;
  readonly storage: SourceStorageQueries;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "subjectFor">;
}): RustNativeCaptureConstruction {
  const nodes = new Set(input.storage.nodes);
  const selections = new Map<Node, RustNativeCaptureSelection>();
  const active = new Set<Node>();
  let published: RustNativeCapturePlan | undefined;
  const unresolved = (reason: string): RustNativeCaptureSelection => Object.freeze({ kind: "unresolved", reason });
  const foreign = unresolved("A native capture environment requires an owned source declaration.");
  const recursive = unresolved("A native capture environment depends on its own unfinished capture selection.");
  const unrequired = unresolved("A native capture environment is published only for its required generic or suspended declarations.");
  const select = (declaration: Node): RustNativeCaptureSelection => {
    const fact = input.records.closureCapture.get(declaration);
    if (fact === undefined) return unresolved("A native capture environment requires its exact finalized capture declarations.");
    const inputs = new Set<RustNativeCallableInput>();
    let failure: string | undefined;
    const carriers = (captures: readonly { readonly reference: Node; readonly carrier: TargetTypeRef }[]): readonly TargetTypeRef[] | undefined => {
      const result: TargetTypeRef[] = [];
      for (const capture of captures) {
        const subject = input.storage.subjectFor(capture.reference);
        const selected = subject.kind === "unresolved" ? subject
          : input.nativeStorage.subjectFor(subject.subject, capture.carrier, declaration);
        if (selected.kind === "unresolved") {
          failure = selected.reason;
          return undefined;
        }
        result.push(selected.carrier);
        if (selected.kind === "selected") for (const selectedInput of selected.inputs) inputs.add(selectedInput);
      }
      return Object.freeze(result);
    };
    const captures = carriers(fact.captures);
    const receiverFields = captures === undefined ? undefined : carriers(fact.receiverFields);
    const receivers = receiverFields === undefined ? undefined : carriers(fact.receivers);
    return captures === undefined || receiverFields === undefined || receivers === undefined
      ? unresolved(failure ?? "A native capture lacks exact physical storage evidence.")
      : Object.freeze({ kind: "resolved", captures, receiverFields, receivers, inputs: Object.freeze([...inputs]),
        environment: rustTargetGenericReferences({ kind: "tuple", elements: [...captures, ...receiverFields, ...receivers] }) });
  };
  const construct = (declaration: Node, required: boolean): RustNativeCaptureSelection => {
    if (published !== undefined) return published.forDeclaration(declaration);
    if (!nodes.has(declaration)) return foreign;
    const existing = selections.get(declaration);
    if (existing !== undefined) return existing;
    if (active.has(declaration)) return recursive;
    active.add(declaration);
    try {
      const result = select(declaration);
      if (result.kind === "resolved" || required) selections.set(declaration, result);
      return result;
    } finally {
      active.delete(declaration);
    }
  };
  return Object.freeze({
    forDeclaration: (declaration: Node) => construct(declaration, false),
    require: (declaration: Node) => construct(declaration, true),
    complete(): RustNativeCapturePlan {
      if (published !== undefined) throw new Error("Native capture environments complete exactly once.");
      const completed = new Map(selections);
      published = Object.freeze({
        forDeclaration: (declaration: Node) => nodes.has(declaration) ? completed.get(declaration) ?? unrequired : foreign,
      });
      return published;
    },
  });
}
