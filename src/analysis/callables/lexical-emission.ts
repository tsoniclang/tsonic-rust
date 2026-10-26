import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustLexicalFunctionQueries } from "../../target-model/records/lexical-functions.js";
import type { RustOwnershipRecords } from "../../target-model/records/ownership.js";
import type { RustCallableValueConstruction } from "./value-plan.js";
import type { RustLexicalFunctionProducer } from "../program/records/lexical-functions.js";
import type { RustLexicalCaptureEmission } from "../../target-model/records/lexical-functions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustCopyCarrier } from "../../policy/constraints/native-traits.js";
import { rustRetainedCallableStorage } from "../../policy/types/callables/return-contexts.js";
import { rustLocationTargetType } from "../../target-model/types/carriers/callables.js";
import { rustNamedTargetType } from "../../target-model/types/carriers/native.js";

export function analyzeRustLexicalFunctionEmission(input: {
  readonly program: {
    readonly records: RustProgramRecords;
    readonly lexicalFunctions: RustLexicalFunctionQueries;
    readonly ownership: Pick<RustOwnershipRecords, "captures">;
    readonly callableValues: Pick<RustCallableValueConstruction, "nativeStorage" | "generic">;
  };
  readonly nodes: readonly Node[];
  readonly producer: RustLexicalFunctionProducer;
}): void {
  const { program } = input;
  for (const declaration of input.nodes) {
    const selection = program.lexicalFunctions.forDeclaration(declaration);
    if (selection === undefined) continue;
    if (selection.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust", selection.reason, declaration);
    const captures: RustLexicalCaptureEmission[] = [];
    for (const capture of selection.captures) {
      const carrier = program.records.runtimeCarrier.get(capture.declaration)?.carrier ?? program.records.runtimeCarrier.get(capture.reference)?.carrier;
      // The capture carries the binding as read, before the contextual conversion at that one use (`reject(original)`
      // converts the read to the rejection value); the caller passes the binding itself.
      const physical = program.callableValues.nativeStorage.operandFor(capture.reference);
      const storage = program.records.bindingStorage.get(capture.declaration);
      if (carrier === undefined || physical.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust",
        "An admitted lexical capture requires its exact source and physical native carrier.", capture.reference);
      const ownership = program.ownership.captures.get(declaration)?.find(value => value.declaration === capture.declaration);
      const retained = rustRetainedCallableStorage(program.records, declaration) !== undefined;
      const copy = isRustCopyCarrier(carrier, selected => program.callableValues.generic.definitionFor(selected)?.copy === true);
      if (!retained && storage === undefined && !capture.mutable && !copy && !selection.valueObserved && ownership === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted lexical capture requires its exact native ownership selection.", capture.reference);
      const owned = retained || storage === undefined && !capture.mutable && (copy || !selection.valueObserved && ownership?.read.kind !== "clone");
      const borrowedCarrier: TargetTypeRef | undefined = owned || storage !== undefined ? undefined : Object.freeze({
        kind: "reference", referent: physical.carrier, mutable: capture.mutable,
      });
      const storageCarrier = storage === undefined ? physical.carrier : storage.storage === "location" ? rustLocationTargetType(physical.carrier)
        : rustNamedTargetType(storage.storage === "cell" ? "rust.core.cell.Cell" : "rust.core.cell.RefCell",
          storage.storage === "cell" ? "core::cell::Cell" : "core::cell::RefCell", [{ kind: "type", type: physical.carrier }]);
      const parameterCarrier: TargetTypeRef = borrowedCarrier !== undefined ? borrowedCarrier : owned ? storageCarrier
        : Object.freeze({ kind: "reference", referent: storageCarrier, mutable: false });
      captures.push(Object.freeze({ ...capture, carrier, physicalCarrier: physical.carrier, storage, owned, borrowedCarrier, parameterCarrier }));
    }
    input.producer.declaration(declaration, { captures: Object.freeze(captures), genericParameters: selection.genericParameters });
  }
}
