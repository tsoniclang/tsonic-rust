import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustSourceCallableReturnFact } from "../../../target-model/records/source-declarations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isRustUnitCarrier, rustUnitTargetType } from "../../../target-model/types/index.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { selectRustSourceCallableReturn } from "../../callables/signatures.js";
import type { RustFactWalk } from "../walk.js";
import { createRustRecordFamily } from "./family.js";
import type { RustRetainedEnvironmentProducer } from "./retained-environment.js";

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
  const corresponds = (
    left: RustSourceCallableReturnFact, right: RustSourceCallableReturnFact,
  ) => rustTargetTypeRefEquals(left.returnCarrier, right.returnCarrier) &&
    left.borrowedParameter === right.borrowedParameter && left.implementationCompletion === right.implementationCompletion &&
    left.undefinedReturn === right.undefinedReturn && left.fallthroughUndefined === right.fallthroughUndefined &&
    left.canFallThrough === right.canFallThrough;
  const family = createRustRecordFamily({ id: "tsonic.rust.sourceCallableReturn", equals: corresponds }, assertOpen, inherited);
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
      if (existing !== undefined && !corresponds(existing, selection.fact)) {
        failTargetAnalysisInvariant("tsonic-rust",
          "Conflicting Rust semantic plan 'tsonic.rust.sourceCallableReturn' for one exact source subject.");
      }
      if (selection.retainedEnvironment !== undefined) retainedEnvironments.retain(declaration,
        selection.retainedEnvironment.lifetime, selection.retainedEnvironment.parameters);
      if (existing === undefined) family.writer.set(declaration, selection.fact);
      if (request !== undefined) {
        let completed = completedRequests.get(declaration);
        if (completed === undefined) completedRequests.set(declaration, completed = new Set());
        completed.add(request);
      }
      return true;
    },
    setter(declaration: Node): void {
      assertOpen();
      const existing = family.reader.get(declaration);
      if (existing !== undefined && !isRustUnitCarrier(existing.returnCarrier)) {
        failTargetAnalysisInvariant("tsonic-rust",
          "Conflicting Rust semantic plan 'tsonic.rust.sourceCallableReturn' for one exact source subject.");
      }
      if (existing === undefined) family.writer.set(declaration, { returnCarrier: rustUnitTargetType() });
    },
  });
}
