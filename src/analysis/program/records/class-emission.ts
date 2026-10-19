import type { Node } from "@tsonic/tsts";
import type { RustNativeClassEmission } from "../../../target-model/records/class-emission.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeMemberVisibility, RustNativeMemberVisibilityRecords } from "../../../target-model/records/native-member-names.js";
import type { RustClassEnvironmentRecords, RustClassEnvironmentTypeEmission } from "../../../target-model/records/class-environments.js";
import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/index.js";

export interface RustClassEmissionProducer {
  readonly records: RustRecordFamily<RustNativeClassEmission>;
  readonly visibilityRecords: RustNativeMemberVisibilityRecords;
  readonly environmentRecords: RustClassEnvironmentRecords;
  environment(subject: RustProjectTypeDefinition, value: RustClassEnvironmentTypeEmission): void;
  visibility(subject: Node, value: RustNativeMemberVisibility): void;
  classDeclaration(subject: Node, value: RustNativeClassEmission): void;
}

export function createRustClassEmissionProducer(assertOpen: () => void): RustClassEmissionProducer {
  const visibility = new WeakMap<Node, RustNativeMemberVisibility>();
  const environments = new WeakMap<Node, RustClassEnvironmentTypeEmission>();
  const environmentsByFile = new Map<string, Map<string, RustClassEnvironmentTypeEmission>>();
  const family = createRustRecordFamily<RustNativeClassEmission>({ id: "tsonic.rust.nativeClass", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    environmentRecords: Object.freeze({
      classEnvironment: Object.freeze({ get: (subject: Node) => environments.get(subject) }),
      classEnvironmentType: Object.freeze({ get: (carrier: TargetTypeRef) => {
        const identity = rustSourceTypeCarrierValue(carrier);
        return identity === undefined ? undefined : environmentsByFile.get(identity.fileName)?.get(identity.typeName);
      } }),
    }),
    environment(subject: RustProjectTypeDefinition, value: RustClassEnvironmentTypeEmission): void {
      assertOpen();
      if (environments.has(subject.declaration)) failTargetAnalysisInvariant("tsonic-rust", "A native class environment is written exactly once.", subject.declaration);
      let declarations = environmentsByFile.get(subject.fileName);
      if (declarations === undefined) { declarations = new Map(); environmentsByFile.set(subject.fileName, declarations); }
      if (declarations.has(subject.targetPath)) failTargetAnalysisInvariant("tsonic-rust", "A native class environment requires one exact source carrier identity.", subject.declaration);
      const selected = Object.freeze(value);
      environments.set(subject.declaration, selected);
      declarations.set(subject.targetPath, selected);
    },
    visibilityRecords: Object.freeze({ nativeMemberVisibility: Object.freeze({ get: (subject: Node, publiclyReachable: boolean) => {
      const selected = visibility.get(subject);
      return publiclyReachable ? selected?.public : selected?.internal;
    } }) }),
    visibility(subject: Node, value: RustNativeMemberVisibility): void {
      assertOpen();
      if (visibility.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native member visibility is written exactly once.", subject);
      visibility.set(subject, Object.freeze(value));
    },
    classDeclaration: (subject: Node, value: RustNativeClassEmission): void => family.writer.set(subject, Object.freeze(value)),
  });
}
