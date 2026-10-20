import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustGenericCallableImplementation, RustGenericCallablePhysicalDefinition } from "../../../target-model/records/generic-callables.js";
import type { RustGenericDeclarationInventory, RustGenericDefinitionEmission, RustGenericEmissionRecords,
  RustGenericImplementationEmission, RustGenericValueEmission } from "../../../target-model/records/generic-emission.js";

export interface RustGenericEmissionProducer {
  value(subject: Node, value: RustGenericValueEmission): void;
  readonly records: RustGenericEmissionRecords;
  implementation(subject: RustGenericCallableImplementation, value: RustGenericImplementationEmission): void;
  definition(subject: RustGenericCallablePhysicalDefinition, value: RustGenericDefinitionEmission): void;
  sourceFile(subject: SourceFile, value: RustGenericDeclarationInventory): void;
}

export function createRustGenericEmissionProducer(assertOpen: () => void): RustGenericEmissionProducer {
  const values = new WeakMap<Node, RustGenericValueEmission>();
  const implementations = new WeakMap<RustGenericCallableImplementation, RustGenericImplementationEmission>();
  const definitions = new WeakMap<RustGenericCallablePhysicalDefinition, RustGenericDefinitionEmission>();
  const inventories = new WeakMap<SourceFile, RustGenericDeclarationInventory>();
  return Object.freeze({ records: Object.freeze({
    genericValue: Object.freeze({ get: (node: Node) => values.get(node) }),
    genericImplementation: Object.freeze({ get: (subject: RustGenericCallableImplementation) => implementations.get(subject) }),
    genericDefinition: Object.freeze({ get: (subject: RustGenericCallablePhysicalDefinition) => definitions.get(subject) }),
    genericDeclarations: Object.freeze({ get: (subject: SourceFile) => inventories.get(subject) }),
  }),
    value(subject: Node, value: RustGenericValueEmission): void {
      assertOpen();
      if (values.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A generic callable value has one native construction owner.", subject);
      values.set(subject, Object.freeze(value));
    },
    implementation(subject: RustGenericCallableImplementation, value: RustGenericImplementationEmission): void {
      assertOpen();
      if (implementations.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A generic implementation emission is written exactly once.", subject.declaration);
      implementations.set(subject, Object.freeze(value));
    },
    definition(subject: RustGenericCallablePhysicalDefinition, value: RustGenericDefinitionEmission): void {
      assertOpen();
      if (definitions.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A generic definition emission is written exactly once.");
      definitions.set(subject, Object.freeze(value));
    },
    sourceFile(subject: SourceFile, value: RustGenericDeclarationInventory): void {
      assertOpen();
      if (inventories.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A generic declaration inventory is written exactly once.", subject);
      inventories.set(subject, Object.freeze(value));
    },
  });
}
