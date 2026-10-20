import type { AstReader, ExtensionFactSubject, ReadonlySourceFactResolver } from "@tsonic/tsts";
import { selectTsonicRawLocationOperation } from "@tsonic/source-core/facts";
import type { TsonicRawLocationSelection } from "@tsonic/source-core/facts";

import type { RustNativeMemoryLayout } from "../../target-model/operations/native-memory.js";

type RustNativeMemorySelection = RustNativeMemoryLayout | {
  readonly kind: "unsupported-array";
  readonly reason: string;
};

export function readRustRawLocation(ast: AstReader, facts: ReadonlySourceFactResolver, subject: ExtensionFactSubject): TsonicRawLocationSelection | undefined {
  return selectTsonicRawLocationOperation(ast, facts, subject);
}
