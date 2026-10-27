import type { Node } from "@tsonic/tsts";
import type { RustGeneratorFact, RustYieldFact } from "../../../../target-model/records/callables/callables-and-resources.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

export interface RustYieldProducer {
  readonly records: RustRecordFamily<RustYieldFact>;
  value(expression: Node, generatorDeclaration: Node, protocol: RustGeneratorFact): void;
  delegate(expression: Node, generatorDeclaration: Node, protocol: RustGeneratorFact,
    delegatedCarrier: TargetTypeRef, resultType: TargetTypeRef): void;
}

export function createRustYieldProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustYieldFact>,
): RustYieldProducer {
  const family = createRustRecordFamily<RustYieldFact>({ id: "tsonic.rust.yield", equals: (left, right) =>
    left.generatorDeclaration === right.generatorDeclaration && left.kind === right.kind &&
    rustTargetTypeRefEquals(left.yieldType, right.yieldType) &&
    rustTargetTypeRefEquals(left.resultType, right.resultType) &&
    (left.delegatedCarrier === undefined ? right.delegatedCarrier === undefined :
      right.delegatedCarrier !== undefined && rustTargetTypeRefEquals(left.delegatedCarrier, right.delegatedCarrier)),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    value(expression: Node, generatorDeclaration: Node, protocol: RustGeneratorFact): void {
      assertOpen();
      family.writer.set(expression, {
        generatorDeclaration, kind: "value", yieldType: protocol.yieldType, resultType: protocol.nextType,
      });
    },
    delegate(expression: Node, generatorDeclaration: Node, protocol: RustGeneratorFact,
      delegatedCarrier: TargetTypeRef, resultType: TargetTypeRef): void {
      assertOpen();
      family.writer.set(expression, {
        generatorDeclaration, kind: "delegate", yieldType: protocol.yieldType, resultType, delegatedCarrier,
      });
    },
  });
}
