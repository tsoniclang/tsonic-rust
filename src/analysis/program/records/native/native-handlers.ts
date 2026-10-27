import type { Node } from "@tsonic/tsts";
import type { RustNativeHandler } from "../../../../target-model/records/native/native-handlers.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustNativeHandlerProducer {
  readonly records: RustRecordFamily<RustNativeHandler>;
  selected(subject: Node, handler: RustNativeHandler): void;
}

export function createRustNativeHandlerProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustNativeHandler>,
): RustNativeHandlerProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.nativeHandler", equals: (left: RustNativeHandler, right: RustNativeHandler) => {
    if (left.kind !== right.kind) return false;
    if (left.kind === "typed-location" && right.kind === "typed-location") {
      return left.selection.operation === right.selection.operation && left.selection.plan === right.selection.plan;
    }
    if (left.kind === "native-pointer" && right.kind === "native-pointer") {
      const first = left.selection;
      const second = right.selection;
      if (first.kind !== second.kind) return false;
      if (first.kind === "layout-query" && second.kind === "layout-query") return first.observation === second.observation;
      if (first.kind === "native-pointer" && second.kind === "native-pointer") return first.operation === second.operation;
      return "plan" in first && "plan" in second && first.plan === second.plan;
    }
    return left.selection === right.selection;
  } }, assertOpen, inherited);
  return Object.freeze({ records: family.reader, selected(subject: Node, handler: RustNativeHandler): void {
    family.writer.set(subject, Object.freeze(handler));
  } });
}
