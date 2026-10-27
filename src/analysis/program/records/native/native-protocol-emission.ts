import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeCallableProtocol, RustNativeCallableInput } from "../../../../target-model/records/native/native-protocols.js";
import type { RustNativeProtocolEmission, RustNativeProtocolReader } from "../../../../target-model/records/native/native-protocol-emission.js";
import type { RustNativeInputInvocationEmission } from "../../../../target-model/records/native/native-protocol-emission.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustNativeProtocolProducer {
  readonly protocol: RustNativeProtocolReader;
  readonly inventories: RustRecordFamily<readonly RustNativeCallableProtocol[]>;
  readonly inputs: { readonly get: (input: RustNativeCallableInput) => true | undefined };
  readonly calls: { readonly get: (node: Node) => RustNativeInputInvocationEmission | undefined };
  input(input: RustNativeCallableInput): void;
  call(node: Node, value: RustNativeInputInvocationEmission): void;
  select(protocol: RustNativeCallableProtocol, value: RustNativeProtocolEmission): void;
  sourceFile(sourceFile: SourceFile, protocols: readonly RustNativeCallableProtocol[]): void;
}

export function createRustNativeProtocolProducer(assertOpen: () => void): RustNativeProtocolProducer {
  const values = new WeakMap<RustNativeCallableProtocol, RustNativeProtocolEmission>();
  const inputs = new WeakSet<RustNativeCallableInput>();
  const calls = new WeakMap<Node, RustNativeInputInvocationEmission>();
  const inventories = createRustRecordFamily<readonly RustNativeCallableProtocol[]>({ id: "tsonic.rust.nativeProtocols", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ protocol: Object.freeze({ get: (protocol: RustNativeCallableProtocol) => values.get(protocol) }), inventories: inventories.reader,
    inputs: Object.freeze({ get: (input: RustNativeCallableInput) => inputs.has(input) ? true : undefined }),
    calls: Object.freeze({ get: (node: Node) => calls.get(node) }),
    input(input: RustNativeCallableInput): void {
      assertOpen();
      if (inputs.has(input)) failTargetAnalysisInvariant("tsonic-rust", "A native protocol input is admitted exactly once.", input.owner);
      inputs.add(input);
    },
    call(node: Node, value: RustNativeInputInvocationEmission): void {
      assertOpen();
      if (calls.has(node)) failTargetAnalysisInvariant("tsonic-rust", "A native protocol invocation has one checked source owner.", node);
      calls.set(node, Object.freeze(value));
    },
    select(protocol: RustNativeCallableProtocol, value: RustNativeProtocolEmission): void {
      assertOpen();
      if (values.has(protocol)) failTargetAnalysisInvariant("tsonic-rust", "A native protocol emission record admits exactly once.");
      values.set(protocol, Object.freeze(value));
    },
    sourceFile: (sourceFile: SourceFile, protocols: readonly RustNativeCallableProtocol[]): void => inventories.writer.set(sourceFile, protocols),
  });
}
