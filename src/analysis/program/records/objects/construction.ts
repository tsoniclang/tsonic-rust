import type { Node } from "@tsonic/tsts";
import type { RustAdmittedConstruction } from "../../../../target-model/records/objects/construction.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustConstructionEmissionRecords, RustImplicitConstructorParameter, RustExternalInitialization } from "../../../../target-model/records/objects/construction.js";
import type { RustProjectConstructorSignature, RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { RustExternalProjectBase } from "../../../../target-model/types/external-project-types.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export interface RustConstructionProducer {
  readonly emissionRecords: RustConstructionEmissionRecords;
  parameters(signature: RustProjectConstructorSignature, carrier: TargetTypeRef, value: readonly RustImplicitConstructorParameter[]): void;
  external(call: Node, value: RustExternalInitialization): void;
  inherited(signature: RustProjectConstructorSignature, name: string): void;
  externalBase(definition: RustProjectTypeDefinition, value: RustExternalProjectBase): void;
  readonly records: RustRecordFamily<RustAdmittedConstruction>;
  classDeclaration(subject: Node, value: RustAdmittedConstruction): void;
}

export function createRustConstructionProducer(assertOpen: () => void): RustConstructionProducer {
  const parameters = new WeakMap<RustProjectConstructorSignature, Map<string, readonly RustImplicitConstructorParameter[]>>();
  const external = new WeakMap<Node, RustExternalInitialization>();
  const inherited = new WeakMap<RustProjectConstructorSignature, { readonly name: string }>();
  const bases = new WeakMap<RustProjectTypeDefinition, RustExternalProjectBase>();
  const family = createRustRecordFamily<RustAdmittedConstruction>({ id: "tsonic.rust.classConstruction", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader, emissionRecords: Object.freeze({
    implicitConstructorParameters: Object.freeze({ get: (signature: RustProjectConstructorSignature, carrier: TargetTypeRef) => parameters.get(signature)?.get(closedMetadataKey(carrier)) }),
    externalProjectInitialization: Object.freeze({ get: (call: Node) => external.get(call) }),
    inheritedExternalInitialization: Object.freeze({ get: (signature: RustProjectConstructorSignature) => inherited.get(signature) }),
    externalProjectBase: Object.freeze({ get: (definition: RustProjectTypeDefinition) => bases.get(definition) }),
  }),
    parameters(signature: RustProjectConstructorSignature, carrier: TargetTypeRef, value: readonly RustImplicitConstructorParameter[]): void {
      assertOpen();
      let contexts = parameters.get(signature);
      if (contexts === undefined) { contexts = new Map(); parameters.set(signature, contexts); }
      const key = closedMetadataKey(carrier);
      if (contexts.has(key)) failTargetAnalysisInvariant("tsonic-rust", "An implicit native constructor has one exact parameter ABI owner.", signature.declaration);
      contexts.set(key, Object.freeze(value));
    },
    external(call: Node, value: RustExternalInitialization): void {
      assertOpen();
      if (external.has(call)) failTargetAnalysisInvariant("tsonic-rust", "An external constructor call has one exact argument owner.", call);
      external.set(call, value);
    },
    inherited(signature: RustProjectConstructorSignature, name: string): void {
      assertOpen();
      if (inherited.has(signature)) failTargetAnalysisInvariant("tsonic-rust", "An inherited external constructor has one exact argument owner.", signature.declaration);
      inherited.set(signature, Object.freeze({ name }));
    },
    externalBase(definition: RustProjectTypeDefinition, value: RustExternalProjectBase): void {
      assertOpen();
      if (bases.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A project class has one exact external native base.", definition.declaration);
      bases.set(definition, value);
    },
    classDeclaration: (subject: Node, value: RustAdmittedConstruction): void => family.writer.set(subject, Object.freeze(value)),
  });
}
