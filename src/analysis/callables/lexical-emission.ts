import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustLexicalFunctionProducer } from "../program/records/lexical-functions.js";
import type { RustLexicalCaptureEmission } from "../../target-model/records/lexical-functions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustCopyCarrier } from "../../target-model/types/index.js";
import { rustRetainedCallableStorage } from "./results.js";

export function analyzeRustLexicalFunctionEmission(input: {
  readonly program: RustTargetProgram;
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
      const physical = program.callableValues.nativeStorage.valueFor(capture.reference);
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
      captures.push(Object.freeze({ ...capture, carrier, physicalCarrier: physical.carrier, storage, owned, borrowedCarrier }));
    }
    input.producer.declaration(declaration, { captures: Object.freeze(captures), genericParameters: selection.genericParameters });
  }
}
