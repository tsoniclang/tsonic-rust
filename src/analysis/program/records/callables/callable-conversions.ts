import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustCallableConversion } from "../../../../target-model/conversions/callable.js";
import type { RustCallableOperandEmission, RustCallableConversionEmission, RustCallableConversionRecords } from "../../../../target-model/records/callables/callable-conversions.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { RustCallableJoinWrite } from "../../../../target-model/records/native/native-storage.js";

export function createRustCallableConversionProducer(assertOpen: () => void) {
  const operands = new WeakMap<Node, Map<string, RustCallableOperandEmission>>();
  const contracts = new WeakMap<Node, Map<string, RustCallableConversionEmission>>();
  const joinWrites = new WeakMap<Node, RustCallableJoinWrite>();
  const recordFields = new WeakMap<Node, TargetTypeRef>();
  const records: RustCallableConversionRecords = Object.freeze({
    callableOperand: Object.freeze({ get: (node: Node, carrier: TargetTypeRef) => operands.get(node)?.get(closedMetadataKey(carrier)) }),
    callableContract: Object.freeze({ get: (node: Node, conversion: RustCallableConversion) => contracts.get(node)?.get(closedMetadataKey(conversion)) }),
    callableJoinWrite: Object.freeze({ get: (node: Node) => joinWrites.get(node) }),
    recordFieldStorage: Object.freeze({ get: (member: Node) => recordFields.get(member) }),
  });
  const write = <Value>(values: WeakMap<Node, Map<string, Value>>, node: Node, key: string, value: Value): void => {
    assertOpen();
    const rows = values.get(node) ?? new Map<string, Value>();
    if (rows.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A callable conversion operand has one exact source owner.", node);
    rows.set(key, Object.freeze(value));
    values.set(node, rows);
  };
  return Object.freeze({ records,
    operand: (node: Node, carrier: TargetTypeRef, value: RustCallableOperandEmission): void => write(operands, node, closedMetadataKey(carrier), value),
    contract: (node: Node, conversion: RustCallableConversion, value: RustCallableConversionEmission): void => write(contracts, node, closedMetadataKey(conversion), value),
    joinWrite: (node: Node, value: RustCallableJoinWrite): void => {
      assertOpen();
      if (joinWrites.has(node)) failTargetAnalysisInvariant("tsonic-rust", "A joined callable storage write has one exact error join.", node);
      joinWrites.set(node, value);
    },
    recordField: (member: Node, carrier: TargetTypeRef): void => {
      assertOpen();
      if (recordFields.has(member)) failTargetAnalysisInvariant("tsonic-rust", "A record generic callable field has one exact physical family.", member);
      recordFields.set(member, carrier);
    },
  });
}

export type RustCallableConversionProducer = ReturnType<typeof createRustCallableConversionProducer>;
