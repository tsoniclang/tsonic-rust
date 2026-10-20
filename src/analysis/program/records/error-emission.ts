import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustGenericCallablePhysicalDefinition } from "../../../target-model/records/generic-callables.js";
import type { RustErrorRegionSelection } from "../../../target-model/records/error-regions.js";
import type { RustErrorEmissionRecords, RustGenericCallableErrorEmission } from "../../../target-model/records/error-emission.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";
import type { RustProjectMemberError } from "../../../target-model/records/error-emission.js";

export interface RustErrorEmissionProducer {
  optionalChain(node: Node, fallible: boolean): void;
  member(declaration: Node, value: RustProjectMemberError): void;
  readonly records: RustErrorEmissionRecords;
  readonly regions: RustRecordFamily<RustErrorRegionSelection>;
  generic(definition: RustGenericCallablePhysicalDefinition, value: RustGenericCallableErrorEmission): void;
  join(fileName: string, arity: number, name: string): void;
  region(declaration: Node, value: RustErrorRegionSelection): void;
}

export function createRustErrorEmissionProducer(assertOpen: () => void): RustErrorEmissionProducer {
  const generics = new WeakMap<RustGenericCallablePhysicalDefinition, RustGenericCallableErrorEmission>();
  const names = new Map<string, Map<number, string>>();
  const regions = createRustRecordFamily<RustErrorRegionSelection>({ id: "tsonic.rust.nativeErrorRegion", equals: (left, right) => left === right }, assertOpen);
  const members = createRustRecordFamily<RustProjectMemberError>({ id: "tsonic.rust.projectMemberError", equals: (left, right) => left === right }, assertOpen);
  const optionalChains = createRustRecordFamily<boolean>({ id: "tsonic.rust.optionalChainBodyFallible", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ regions: regions.reader, records: Object.freeze({
    optionalChainBodyFallible: optionalChains.reader,
    projectMemberError: members.reader,
    genericCallableErrors: Object.freeze({ get: (definition: RustGenericCallablePhysicalDefinition) => generics.get(definition) }),
    nativeErrorJoinName: Object.freeze({ get: (fileName: string, arity: number) => names.get(fileName)?.get(arity) }),
  }),
    member: (declaration: Node, value: RustProjectMemberError): void => members.writer.set(declaration, Object.freeze(value)),
    optionalChain: (node: Node, fallible: boolean): void => optionalChains.writer.set(node, fallible),
    generic(definition: RustGenericCallablePhysicalDefinition, value: RustGenericCallableErrorEmission): void {
      assertOpen();
      if (generics.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A generic callable error emission admits exactly once.");
      generics.set(definition, Object.freeze(value));
    },
    join(fileName: string, arity: number, name: string): void {
      assertOpen();
      const existing = names.get(fileName) ?? new Map<number, string>();
      if (existing.has(arity)) failTargetAnalysisInvariant("tsonic-rust", "A native error join name admits exactly once.");
      existing.set(arity, name);
      names.set(fileName, existing);
    },
    region: (declaration: Node, value: RustErrorRegionSelection): void => regions.writer.set(declaration, value),
  });
}
