import type { SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeCallableProtocol } from "../../../target-model/records/native-protocols.js";
import type { RustNativeProtocolEmission, RustNativeProtocolReader } from "../../../target-model/records/native-protocol-emission.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustNativeProtocolProducer {
  readonly protocol: RustNativeProtocolReader;
  readonly inventories: RustRecordFamily<readonly RustNativeCallableProtocol[]>;
  select(protocol: RustNativeCallableProtocol, value: RustNativeProtocolEmission): void;
  sourceFile(sourceFile: SourceFile, protocols: readonly RustNativeCallableProtocol[]): void;
}

export function createRustNativeProtocolProducer(assertOpen: () => void): RustNativeProtocolProducer {
  const values = new WeakMap<RustNativeCallableProtocol, RustNativeProtocolEmission>();
  const inventories = createRustRecordFamily<readonly RustNativeCallableProtocol[]>({ id: "tsonic.rust.nativeProtocols", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ protocol: Object.freeze({ get: (protocol: RustNativeCallableProtocol) => values.get(protocol) }), inventories: inventories.reader,
    select(protocol: RustNativeCallableProtocol, value: RustNativeProtocolEmission): void {
      assertOpen();
      if (values.has(protocol)) failTargetAnalysisInvariant("tsonic-rust", "A native protocol emission record admits exactly once.");
      values.set(protocol, Object.freeze(value));
    },
    sourceFile: (sourceFile: SourceFile, protocols: readonly RustNativeCallableProtocol[]): void => inventories.writer.set(sourceFile, protocols),
  });
}
