import type { Node } from "@tsonic/tsts";
import type { RustObjectLiteralMethodAdapterFact } from "../../../../target-model/records/objects/object-methods.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { selectRustObjectLiteralMethodAdapter, type RustObjectLiteralMethodAdapterInput, type RustObjectLiteralMethodAdapterIssue } from "../../../objects/method-adapters.js";
import { createRustRecordFamily } from "../family.js";
import { requireRustRecord, type RustRequiredRecord } from "./required-records.js";

interface RustObjectLiteralMethodAdapterFinalization extends RustObjectLiteralMethodAdapterInput {
  readonly expressions: ReadonlySet<Node>;
  readonly requiredRecords: RustRequiredRecord[];
}

export interface RustObjectLiteralMethodAdapterProducer {
  readonly records: RustRecordFamily<RustObjectLiteralMethodAdapterFact>;
  finalize(input: RustObjectLiteralMethodAdapterFinalization): readonly RustObjectLiteralMethodAdapterIssue[];
}

export function createRustObjectLiteralMethodAdapterProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustObjectLiteralMethodAdapterFact>,
): RustObjectLiteralMethodAdapterProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.objectLiteralMethodAdapter", equals: objectLiteralMethodAdapterFactEquals },
    assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    finalize(input: RustObjectLiteralMethodAdapterFinalization): readonly RustObjectLiteralMethodAdapterIssue[] {
      assertOpen();
      const issues: RustObjectLiteralMethodAdapterIssue[] = [];
      for (const expression of input.expressions) {
        const operation = input.records.targetOperation.get(expression);
        if (operation?.kind !== "record-literal") {
          issues.push({ expression, subject: expression,
            message: "Object literal method implementations require one finalized record-literal operation." });
          continue;
        }
        const fact = selectRustObjectLiteralMethodAdapter(input, expression, operation, issues);
        if (fact !== undefined) {
          requireRustRecord(input.requiredRecords, "objectLiteralMethodAdapter", expression,
            "completed object method adapter", "objectLiteralMethodAdapters.finalize");
          family.writer.set(expression, fact);
        }
      }
      return Object.freeze(issues);
    },
  });
}

function objectLiteralMethodAdapterFactEquals(
  left: RustObjectLiteralMethodAdapterFact,
  right: RustObjectLiteralMethodAdapterFact,
): boolean {
  return left.implementations.length === right.implementations.length &&
    left.implementations.every((implementation, index) => {
      const candidate = right.implementations[index];
      return candidate !== undefined && implementation.sourceCallable === candidate.sourceCallable &&
        closedMetadataEquals(
          { typeParameterSubstitutions: implementation.typeParameterSubstitutions,
            parameters: implementation.parameters, returnCarrier: implementation.returnCarrier },
          { typeParameterSubstitutions: candidate.typeParameterSubstitutions,
            parameters: candidate.parameters, returnCarrier: candidate.returnCarrier },
        );
    }) && left.dispatches.length === right.dispatches.length &&
    left.dispatches.every((dispatch, index) => {
      const candidate = right.dispatches[index];
      return candidate !== undefined && dispatch.contractMethod === candidate.contractMethod &&
        closedMetadataEquals(
          { virtualSlot: dispatch.virtualSlot, implementationIndex: dispatch.implementationIndex,
            parameters: dispatch.parameters, returnCarrier: dispatch.returnCarrier,
            parameterAdapters: dispatch.parameterAdapters, resultAdapter: dispatch.resultAdapter,
            adapterFallible: dispatch.adapterFallible },
          { virtualSlot: candidate.virtualSlot, implementationIndex: candidate.implementationIndex,
            parameters: candidate.parameters, returnCarrier: candidate.returnCarrier,
            parameterAdapters: candidate.parameterAdapters, resultAdapter: candidate.resultAdapter,
            adapterFallible: candidate.adapterFallible },
        );
    });
}
