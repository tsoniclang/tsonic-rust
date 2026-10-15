import type { Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetGenericReferences, type RustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";

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

export function createRustNativeCapturePlan(input: {
  readonly records: RustProgramRecords;
  readonly storage: SourceStorageQueries;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "subjectFor">;
}): RustNativeCapturePlan {
  const nodes = new Set(input.storage.nodes);
  const selections = new Map<Node, RustNativeCaptureSelection>();
  const unresolved = (reason: string): RustNativeCaptureSelection => Object.freeze({ kind: "unresolved", reason });
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
  return Object.freeze({
    forDeclaration(declaration: Node): RustNativeCaptureSelection {
      if (!nodes.has(declaration)) return unresolved("A native capture environment requires an owned source declaration.");
      const existing = selections.get(declaration);
      if (existing !== undefined) return existing;
      const result = select(declaration);
      selections.set(declaration, result);
      return result;
    },
  });
}
