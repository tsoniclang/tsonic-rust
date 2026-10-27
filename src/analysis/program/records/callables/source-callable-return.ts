import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustSourceCallableReturnFact } from "../../../../target-model/records/program/source-declarations.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustUnitTargetType } from "../../../../target-model/types/index.js";
import { rustSourceCallableReturnFactEquals } from "../../../../target-model/records/operations/equality.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { selectRustSourceCallableReturn } from "../../../callables/calls/source-callable-abi.js";
import type { RustFactWalk } from "../../walk.js";
import { createRustRecordFamily } from "../family.js";
import type { RustRetainedEnvironmentProducer } from "./retained-environment.js";
import { requireRustRecord } from "../objects/required-records.js";

export interface RustSourceCallableReturnProducer {
  readonly records: RustRecordFamily<RustSourceCallableReturnFact>;
  resolve(walk: RustFactWalk, declaration: Node, selectedCarrier?: TargetTypeRef): boolean;
  setter(declaration: Node): void;
}

export function createRustSourceCallableReturnProducer(
  assertOpen: () => void,
  retainedEnvironments: RustRetainedEnvironmentProducer,
  inherited?: RustRecordFamily<RustSourceCallableReturnFact>,
): RustSourceCallableReturnProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.sourceCallableReturn", equals: rustSourceCallableReturnFactEquals }, assertOpen, inherited);
  const completedRequests = new WeakMap<Node, Set<string>>();
  return Object.freeze({
    records: family.reader,
    resolve(walk: RustFactWalk, declaration: Node, selectedCarrier?: TargetTypeRef): boolean {
      assertOpen();
      const existing = family.reader.get(declaration);
      if (selectedCarrier === undefined && existing !== undefined) return true;
      const request = selectedCarrier === undefined ? undefined : closedMetadataKey(selectedCarrier);
      if (request !== undefined && completedRequests.get(declaration)?.has(request)) return true;
      const selection = selectRustSourceCallableReturn(walk, declaration, selectedCarrier);
      if (selection === undefined) return false;
      requireRustRecord(walk.context.requiredRecords, "sourceCallableReturn", declaration,
        "complete callable return", "sourceCallableReturns.resolve");
      if (existing !== undefined && !rustSourceCallableReturnFactEquals(existing, selection.fact)) {
        failTargetAnalysisInvariant("tsonic-rust",
          "Conflicting Rust semantic plan 'tsonic.rust.sourceCallableReturn' for one exact source subject.");
      }
      if (selection.retainedEnvironment !== undefined) {
        requireRustRecord(walk.context.requiredRecords, "retainedEnvironment", declaration,
          "returned callable environment", "sourceCallableReturns.resolve");
        retainedEnvironments.retain(declaration,
          selection.retainedEnvironment.lifetime, selection.retainedEnvironment.inputs);
      }
      if (existing === undefined) family.writer.set(declaration, selection.fact);
      if (request !== undefined) {
        let completed = completedRequests.get(declaration);
        if (completed === undefined) completedRequests.set(declaration, completed = new Set());
        completed.add(request);
      }
      return true;
    },
    setter(declaration: Node): void {
      family.writer.set(declaration, { returnCarrier: rustUnitTargetType() });
    },
  });
}
