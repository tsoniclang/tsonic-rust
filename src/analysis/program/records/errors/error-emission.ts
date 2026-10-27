import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustGenericCallablePhysicalDefinition } from "../../../../target-model/records/callables/generic-callables.js";
import type { RustErrorRegionSelection } from "../../../../target-model/records/errors/error-regions.js";
import type { RustErrorEmissionRecords, RustGenericCallableErrorEmission } from "../../../../target-model/records/errors/error-emission.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";
import type { RustProjectMemberError } from "../../../../target-model/records/errors/error-emission.js";
import type { RustPhysicalErrorOwner } from "../../../../target-model/records/errors/error-regions.js";
import type { RustErrorJoinDeclaration } from "../../../../target-model/records/errors/error-regions.js";
import type { RustSourceErrorEffectEdge } from "../../../../target-model/records/errors/source-error-effects.js";
import type { RustSourceErrorRegionEmission } from "../../../../target-model/records/errors/error-emission.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export interface RustErrorEmissionProducer {
  awaitEdge(node: Node, carrier: TargetTypeRef, edge: RustSourceErrorEffectEdge): void;
  sourceRegion(edge: RustSourceErrorEffectEdge, value: RustSourceErrorRegionEmission): void;
  declarationOwner(node: Node, component: string): void;
  memberOwner(node: Node, owner: RustPhysicalErrorOwner): void;
  member(declaration: Node, value: RustProjectMemberError): void;
  readonly records: RustErrorEmissionRecords;
  readonly regions: RustRecordFamily<RustErrorRegionSelection>;
  generic(definition: RustGenericCallablePhysicalDefinition, value: RustGenericCallableErrorEmission): void;
  joins(fileName: string, declarations: readonly RustErrorJoinDeclaration[]): void;
  region(declaration: Node, value: RustErrorRegionSelection): void;
}

export function createRustErrorEmissionProducer(assertOpen: () => void): RustErrorEmissionProducer {
  const generics = new WeakMap<RustGenericCallablePhysicalDefinition, RustGenericCallableErrorEmission>();
  const names = new Map<string, Map<number, string>>();
  const declarations = new Map<string, readonly RustErrorJoinDeclaration[]>();
  const sourceRegions = new Map<RustSourceErrorEffectEdge, RustSourceErrorRegionEmission>();
  const awaitEdges = new Map<Node, Map<string, RustSourceErrorEffectEdge>>();
  const regions = createRustRecordFamily<RustErrorRegionSelection>({ id: "tsonic.rust.nativeErrorRegion", equals: (left, right) => left === right }, assertOpen);
  const members = createRustRecordFamily<RustProjectMemberError>({ id: "tsonic.rust.projectMemberError", equals: (left, right) => left === right }, assertOpen);
  const declarationOwners = createRustRecordFamily<string>({ id: "tsonic.rust.errorDeclarationOwner", equals: (left, right) => left === right }, assertOpen);
  const memberOwners = createRustRecordFamily<RustPhysicalErrorOwner>({ id: "tsonic.rust.errorMemberOwner", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ regions: regions.reader, records: Object.freeze({
    awaitErrorEdge: Object.freeze({ get: (node: Node, carrier: TargetTypeRef) => awaitEdges.get(node)?.get(closedMetadataKey(carrier)) }),
    sourceErrorRegion: Object.freeze({ get: (edge: RustSourceErrorEffectEdge) => sourceRegions.get(edge) }),
    nativeErrorJoinDeclarations: Object.freeze({ get: (fileName: string) => declarations.get(fileName) }),
    errorDeclarationOwner: declarationOwners.reader,
    errorMemberOwner: memberOwners.reader,
    projectMemberError: members.reader,
    genericCallableErrors: Object.freeze({ get: (definition: RustGenericCallablePhysicalDefinition) => generics.get(definition) }),
    nativeErrorJoinName: Object.freeze({ get: (fileName: string, arity: number) => names.get(fileName)?.get(arity) }),
  }),
    awaitEdge(node: Node, carrier: TargetTypeRef, edge: RustSourceErrorEffectEdge): void {
      assertOpen();
      const entries = awaitEdges.get(node) ?? new Map<string, RustSourceErrorEffectEdge>();
      const key = closedMetadataKey(carrier);
      if (entries.has(key)) failTargetAnalysisInvariant("tsonic-rust", "An await source carrier has one exact native error edge.", node);
      entries.set(key, edge); awaitEdges.set(node, entries);
    },
    sourceRegion(edge: RustSourceErrorEffectEdge, value: RustSourceErrorRegionEmission): void {
      assertOpen();
      if (sourceRegions.has(edge)) failTargetAnalysisInvariant("tsonic-rust", "A source error edge has one exact emission owner.", edge.declaration);
      sourceRegions.set(edge, Object.freeze(value));
    },
    declarationOwner: (node: Node, component: string): void => declarationOwners.writer.set(node, component),
    memberOwner: (node: Node, owner: RustPhysicalErrorOwner): void => memberOwners.writer.set(node, Object.freeze(owner)),
    member: (declaration: Node, value: RustProjectMemberError): void => members.writer.set(declaration, Object.freeze(value)),
    generic(definition: RustGenericCallablePhysicalDefinition, value: RustGenericCallableErrorEmission): void {
      assertOpen();
      if (generics.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A generic callable error emission admits exactly once.");
      generics.set(definition, Object.freeze(value));
    },
    joins(fileName: string, value: readonly RustErrorJoinDeclaration[]): void {
      assertOpen();
      if (declarations.has(fileName)) failTargetAnalysisInvariant("tsonic-rust", "Native error join declarations have one exact file owner.");
      const existing = new Map<number, string>([[0, "NativeErrors0"], [1, "NativeErrors1"]]);
      for (const declaration of value) {
        if (existing.has(declaration.arity)) failTargetAnalysisInvariant("tsonic-rust", "A native error join name admits exactly once.");
        existing.set(declaration.arity, declaration.name);
      }
      names.set(fileName, existing);
      declarations.set(fileName, Object.freeze(value));
    },
    region: (declaration: Node, value: RustErrorRegionSelection): void => regions.writer.set(declaration, value),
  });
}
