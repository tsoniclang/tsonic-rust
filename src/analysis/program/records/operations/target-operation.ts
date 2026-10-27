import type { ExtensionFactSubject, Node } from "@tsonic/tsts";
import type { RustPolicySelection } from "../../../../policy/model/contracts.js";
import type { RustFoundation } from "../../../../target-model/foundation/model.js";
import { rustEnumLiteralFact, rustUnaryMinusLiteralFact, rustUnaryPlusLiteralFact } from "./target-operation-literals.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import { rustFoundationForTargetOperationFact } from "../../../foundation/operation-requirements.js";
import { rustTargetOperationFactEquals } from "../../../../target-model/records/operations/operation-equality.js";
import { createRustRecordFamily } from "../family.js";

export interface RustTargetOperationProducer {
  readonly records: RustRecordFamily<RustTargetOperationFact>;
  checked<T extends { readonly targetFact?: RustTargetOperationFact }>(
    subject: ExtensionFactSubject,
    selection: RustPolicySelection<T>,
  ): void;
  source(subject: Node, operation: RustTargetOperationFact): void;
  enumLiteral(subject: Node, name: string, resultCarrier: TargetTypeRef): void;
  unaryMinusLiteral(subject: Node, resultCarrier: TargetTypeRef): RustTargetOperationFact;
  unaryPlusLiteral(subject: Node, resultCarrier: TargetTypeRef): RustTargetOperationFact;
}

export function createRustTargetOperationProducer(
  assertOpen: () => void,
  requireFoundation: (foundation: RustFoundation) => void,
  definitions: RustTypeDefinitions,
  inherited?: RustRecordFamily<RustTargetOperationFact>,
): RustTargetOperationProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.targetOperation", equals: rustTargetOperationFactEquals },
    assertOpen, inherited, value => requireFoundation(rustFoundationForTargetOperationFact(value, definitions)));
  return Object.freeze({
    records: family.reader,
    checked<T extends { readonly targetFact?: RustTargetOperationFact }>(
      subject: ExtensionFactSubject,
      selection: RustPolicySelection<T>,
    ): void {
      assertOpen();
      if (selection.kind === "accept" && selection.value.targetFact !== undefined) {
        family.writer.set(subject, selection.value.targetFact);
      }
    },
    source(subject: Node, operation: RustTargetOperationFact): void {
      family.writer.set(subject, operation);
    },
    enumLiteral(subject: Node, name: string, resultCarrier: TargetTypeRef): void {
      family.writer.set(subject, rustEnumLiteralFact(name, resultCarrier));
    },
    unaryMinusLiteral(subject: Node, resultCarrier: TargetTypeRef): RustTargetOperationFact {
      const fact = rustUnaryMinusLiteralFact(resultCarrier);
      family.writer.set(subject, fact);
      return fact;
    },
    unaryPlusLiteral(subject: Node, resultCarrier: TargetTypeRef): RustTargetOperationFact {
      const fact = rustUnaryPlusLiteralFact(resultCarrier);
      family.writer.set(subject, fact);
      return fact;
    },
  });
}
