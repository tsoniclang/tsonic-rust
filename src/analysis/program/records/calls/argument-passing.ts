import type { ArgumentPassingFact, ArgumentPassingMode, Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

type RustArgumentPassingMode = Extract<ArgumentPassingMode, "by-value" | "borrow-shared" | "borrow-mut">;

export interface RustArgumentPassingProducer {
  readonly records: RustRecordFamily<ArgumentPassingFact>;
  pass(argument: Node, mode: RustArgumentPassingMode): void;
}

export function createRustArgumentPassingProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<ArgumentPassingFact>,
): RustArgumentPassingProducer {
  const family = createRustRecordFamily<ArgumentPassingFact>({
    id: "tsonic.rust.argumentPassing",
    equals: (left, right) => left.mode === right.mode && left.storageExpression === right.storageExpression,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    pass(argument: Node, mode: RustArgumentPassingMode): void {
      family.writer.set(argument, Object.freeze({ mode,
        ...(mode === "by-value" ? {} : { storageExpression: argument }),
      }));
    },
  });
}
