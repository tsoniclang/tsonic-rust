import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { ExtensionFactSubject, Node } from "@tsonic/tsts";
import type { RustPolicySelection } from "../../../../policy/model/contracts.js";
import { rustPostCheckOperationKind } from "../../../../target-model/operations/model.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustSelectedTargetOperation } from "../../../../target-model/records/operations/member-selections.js";
import { rustSelectedTargetOperationEquals } from "../../../../target-model/records/operations/operation-equality.js";
import { maximumRustFoundation, type RustFoundation } from "../../../../target-model/foundation/model.js";
import { rustFoundationForSelectedOperation } from "../../../foundation/requirements.js";
import { rustSelectedOperatorOperation } from "./selected-operation-values.js";
import { createRustRecordFamily } from "../family.js";

export interface RustSelectedOperationProducer {
  readonly records: RustRecordFamily<RustSelectedTargetOperation>;
  checked<T extends { readonly operation?: RustSelectedTargetOperation }>(
    subject: ExtensionFactSubject,
    selection: RustPolicySelection<T>,
  ): ReturnType<typeof rustPostCheckOperationKind>;
  operator(subject: Node, fact: RustTargetOperationFact, resultType: TargetTypeRef): void;
  project(
    subject: Node,
    operationId: string,
    operationKind: RustSelectedTargetOperation["operationKind"],
    targetOperation: string,
    resultType: TargetTypeRef,
  ): void;
  minimumFoundation(): RustFoundation;
  seal(): void;
}

export function createRustSelectedOperationProducer(
  inherited?: RustRecordFamily<RustSelectedTargetOperation>,
): RustSelectedOperationProducer {
  let sealed = false;
  let foundation: RustFoundation = "core";
  const assertOpen = (): void => {
    if (sealed) failTargetAnalysisInvariant("tsonic-rust", "Rust semantic plans cannot be written after analysis is sealed.");
  };
  const family = createRustRecordFamily({ id: "selectedOperation", equals: rustSelectedTargetOperationEquals },
    assertOpen, inherited, operation => {
      foundation = maximumRustFoundation(foundation, rustFoundationForSelectedOperation(operation));
    });
  const admit = family.writer.set;
  return Object.freeze({
    records: family.reader,
    checked<T extends { readonly operation?: RustSelectedTargetOperation }>(
      subject: ExtensionFactSubject,
      selection: RustPolicySelection<T>,
    ): ReturnType<typeof rustPostCheckOperationKind> {
      assertOpen();
      if (selection.kind !== "accept" || selection.value.operation === undefined) return undefined;
      const deferred = rustPostCheckOperationKind(selection.value.operation.operationId);
      if (deferred !== undefined) return deferred;
      admit(subject, selection.value.operation);
      return undefined;
    },
    operator(subject: Node, fact: RustTargetOperationFact, resultType: TargetTypeRef): void {
      admit(subject, rustSelectedOperatorOperation(subject, fact, resultType));
    },
    project(
      subject: Node,
      operationId: string,
      operationKind: RustSelectedTargetOperation["operationKind"],
      targetOperation: string,
      resultType: TargetTypeRef,
    ): void {
      admit(subject, { operationId, operationKind, targetOperation, resultType });
    },
    minimumFoundation(): RustFoundation { return foundation; },
    seal(): void {
      assertOpen();
      sealed = true;
    },
  });
}
