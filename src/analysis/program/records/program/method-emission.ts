import type { Node } from "@tsonic/tsts";
import type { RustMethodDeclarationEmission, RustMethodEmissionRecords } from "../../../../target-model/records/program/method-emission.js";
import { createRustRecordFamily } from "../family.js";
import type { RustProjectMethodDispatchVariant } from "../../../../target-model/records/operations/method-dispatch.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export interface RustMethodEmissionProducer {
  readonly records: RustMethodEmissionRecords;
  dispatch(declaration: Node, arguments_: readonly TargetTypeRef[], value: RustProjectMethodDispatchVariant): void;
  method(subject: Node, value: RustMethodDeclarationEmission): void;
  classDeclaration(subject: Node, value: readonly Node[]): void;
}

export function createRustMethodEmissionProducer(assertOpen: () => void): RustMethodEmissionProducer {
  const dispatches = new WeakMap<Node, Map<string, RustProjectMethodDispatchVariant>>();
  const methods = createRustRecordFamily<RustMethodDeclarationEmission>({ id: "tsonic.rust.methodDeclaration", equals: (left, right) => left === right }, assertOpen);
  const classes = createRustRecordFamily<readonly Node[]>({ id: "tsonic.rust.classMethods", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ methodDeclaration: methods.reader, classMethods: classes.reader,
    methodDispatch: Object.freeze({ get: (declaration: Node, arguments_: readonly TargetTypeRef[]) => dispatches.get(declaration)?.get(closedMetadataKey(arguments_)) }),
  }),
    dispatch(declaration: Node, arguments_: readonly TargetTypeRef[], value: RustProjectMethodDispatchVariant): void {
      assertOpen();
      const values = dispatches.get(declaration) ?? new Map<string, RustProjectMethodDispatchVariant>();
      const key = closedMetadataKey(arguments_);
      if (values.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A method dispatch specialization has one exact native slot owner.", declaration);
      values.set(key, value);
      dispatches.set(declaration, values);
    },
    method: (subject: Node, value: RustMethodDeclarationEmission): void => methods.writer.set(subject, Object.freeze(value)),
    classDeclaration: (subject: Node, value: readonly Node[]): void => classes.writer.set(subject, Object.freeze(value)),
  });
}
