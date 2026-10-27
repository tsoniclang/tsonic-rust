import type { Node } from "@tsonic/tsts";
import type { RustNativeDeclarationLiveness } from "../../../../target-model/records/native/native-liveness.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";
import type { RustDeadCodeDisposition, RustStructuralLivenessEmission, RustLivenessEmissionRecords } from "../../../../target-model/records/native/native-liveness.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export interface RustNativeLivenessProducer {
  readonly emission: RustLivenessEmissionRecords;
  subject(node: Node, value: { readonly deadCode: RustDeadCodeDisposition | undefined }): void;
  structural(carriers: readonly TargetTypeRef[], value: readonly [RustStructuralLivenessEmission, RustStructuralLivenessEmission]): void;
  readonly declarations: RustRecordFamily<RustNativeDeclarationLiveness>;
  declaration(subject: Node, liveness: RustNativeDeclarationLiveness): void;
}

export function createRustNativeLivenessProducer(assertOpen: () => void): RustNativeLivenessProducer {
  const subjects = createRustRecordFamily<{ readonly deadCode: RustDeadCodeDisposition | undefined }>({
    id: "tsonic.rust.authoredLiveness", equals: (left, right) => left === right,
  }, assertOpen);
  const structural = new WeakMap<readonly TargetTypeRef[], readonly [RustStructuralLivenessEmission, RustStructuralLivenessEmission]>();
  const declarations = createRustRecordFamily<RustNativeDeclarationLiveness>({ id: "tsonic.rust.declarationLiveness", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ declarations: declarations.reader,
    emission: Object.freeze({ authoredLiveness: subjects.reader,
      structuralLiveness: Object.freeze({ get: (carriers: readonly TargetTypeRef[], publiclyReachable: boolean) =>
        structural.get(carriers)?.[publiclyReachable ? 1 : 0] }) }),
    subject: (node: Node, value: { readonly deadCode: RustDeadCodeDisposition | undefined }): void => subjects.writer.set(node, Object.freeze(value)),
    structural(carriers: readonly TargetTypeRef[], value: readonly [RustStructuralLivenessEmission, RustStructuralLivenessEmission]): void {
      assertOpen();
      if (structural.has(carriers)) failTargetAnalysisInvariant("tsonic-rust", "A native structural carrier group has one liveness owner.");
      structural.set(carriers, Object.freeze(value));
    },
    declaration: (subject: Node, liveness: RustNativeDeclarationLiveness): void => declarations.writer.set(subject, Object.freeze(liveness)),
  });
}
