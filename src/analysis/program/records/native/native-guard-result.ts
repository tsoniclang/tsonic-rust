import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustNativeGuardResultProducer {
  readonly records: RustRecordFamily<boolean>;
  resolve(expression: Node, select: () => boolean | undefined): boolean | undefined;
}

export function createRustNativeGuardResultProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<boolean>,
): RustNativeGuardResultProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.nativeGuardResult", equals: (
    left: boolean, right: boolean,
  ) => left === right }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    resolve(expression: Node, select: () => boolean | undefined): boolean | undefined {
      assertOpen();
      const existing = family.reader.get(expression);
      if (existing !== undefined) return existing;
      const result = select();
      if (result !== undefined) family.writer.set(expression, result);
      return result;
    },
  });
}
