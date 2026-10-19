import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableGenericContext } from "../../../target-model/records/native-generics.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustNativeGenericProducer {
  readonly records: RustRecordFamily<RustNativeCallableGenericContext>;
  declaration(subject: Node, context: RustNativeCallableGenericContext): void;
}

export function createRustNativeGenericProducer(assertOpen: () => void): RustNativeGenericProducer {
  const family = createRustRecordFamily<RustNativeCallableGenericContext>({ id: "tsonic.rust.nativeGenerics", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    declaration: (subject: Node, context: RustNativeCallableGenericContext): void => family.writer.set(subject, context),
  });
}
