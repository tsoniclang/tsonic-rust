import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { rustGenericCallableSignaturesMatch } from "../../../../policy/conversions/generic-callable.js";
import type { RustGenericCallableImplementation, RustGenericCallablePhysicalDefinition } from "../../../../target-model/records/callables/generic-callables.js";
import type { RustGenericDeclarationInventory, RustGenericDefinitionEmission, RustGenericEmissionRecords,
  RustGenericImplementationEmission, RustGenericValueEmission, RustGenericIdentityEmission } from "../../../../target-model/records/types/generic-emission.js";

export interface RustGenericEmissionProducer {
  identity(subject: Node, value: RustGenericIdentityEmission): void;
  value(subject: Node, value: RustGenericValueEmission): void;
  readonly records: RustGenericEmissionRecords;
  implementation(subject: RustGenericCallableImplementation, value: RustGenericImplementationEmission): void;
  definition(subject: RustGenericCallablePhysicalDefinition, value: RustGenericDefinitionEmission): void;
  sourceFile(subject: SourceFile, value: RustGenericDeclarationInventory): void;
}

export function createRustGenericEmissionProducer(assertOpen: () => void): RustGenericEmissionProducer {
  const identities = new WeakMap<Node, RustGenericIdentityEmission>();
  const values = new WeakMap<Node, Map<string, RustGenericValueEmission>>();
  const implementations = new WeakMap<RustGenericCallableImplementation, RustGenericImplementationEmission>();
  const definitions = new WeakMap<RustGenericCallablePhysicalDefinition, RustGenericDefinitionEmission>();
  const inventories = new WeakMap<SourceFile, RustGenericDeclarationInventory>();
  return Object.freeze({ records: Object.freeze({
    genericIdentity: Object.freeze({ get: (node: Node) => identities.get(node) }),
    // A construction is published under its physical operand carrier; a planner holding the logical construction
    // carrier reads the one construction of that node whose physical signature matches it.
    genericValue: Object.freeze({ get: (node: Node, carrier: TargetTypeRef) => {
      const rows = values.get(node);
      const exact = rows?.get(closedMetadataKey(carrier));
      if (exact !== undefined || rows === undefined) return exact;
      const matching = [...rows.values()].filter(row => rustGenericCallableSignaturesMatch(carrier, row.carrier));
      return matching.length === 1 ? matching[0] : undefined;
    } }),
    genericImplementation: Object.freeze({ get: (subject: RustGenericCallableImplementation) => implementations.get(subject) }),
    genericDefinition: Object.freeze({ get: (subject: RustGenericCallablePhysicalDefinition) => definitions.get(subject) }),
    genericDeclarations: Object.freeze({ get: (subject: SourceFile) => inventories.get(subject) }),
  }),
    identity(subject: Node, value: RustGenericIdentityEmission): void {
      assertOpen();
      if (identities.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A generic callable comparison has one native identity owner.", subject);
      identities.set(subject, Object.freeze(value));
    },
    value(subject: Node, value: RustGenericValueEmission): void {
      assertOpen();
      const rows = values.get(subject) ?? new Map<string, RustGenericValueEmission>();
      const key = closedMetadataKey(value.carrier);
      if (rows.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A generic callable value has one native construction owner.", subject);
      rows.set(key, Object.freeze(value));
      values.set(subject, rows);
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
