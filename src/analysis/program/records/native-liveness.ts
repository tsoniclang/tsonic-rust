import type { Node } from "@tsonic/tsts";
import type { RustNativeDeclarationLiveness } from "../../../target-model/records/native-liveness.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustNativeLivenessProducer {
  readonly declarations: RustRecordFamily<RustNativeDeclarationLiveness>;
  declaration(subject: Node, liveness: RustNativeDeclarationLiveness): void;
}

export function createRustNativeLivenessProducer(assertOpen: () => void): RustNativeLivenessProducer {
  const declarations = createRustRecordFamily<RustNativeDeclarationLiveness>({ id: "tsonic.rust.declarationLiveness", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ declarations: declarations.reader,
    declaration: (subject: Node, liveness: RustNativeDeclarationLiveness): void => declarations.writer.set(subject, Object.freeze(liveness)),
  });
}
