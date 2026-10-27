import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustNativeUnreachableProducer {
  readonly records: RustRecordFamily<boolean>;
  resolve(node: Node, select: () => boolean): boolean;
}

export function createRustNativeUnreachableProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<boolean>,
): RustNativeUnreachableProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.nativeUnreachable", equals: (
    left: boolean, right: boolean,
  ) => left === right }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    resolve(node: Node, select: () => boolean): boolean {
      assertOpen();
      if (family.reader.get(node) === true) return true;
      const unreachable = select();
      if (unreachable) family.writer.set(node, true);
      return unreachable;
    },
  });
}
