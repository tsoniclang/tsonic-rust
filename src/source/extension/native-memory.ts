import type { AstReader, ExtensionFactSubject, ReadonlySourceFactResolver } from "@tsonic/tsts";
import { selectTsonicRawLocationOperation } from "@tsonic/source-core/facts";
import type { TsonicRawLocationSelection } from "@tsonic/source-core/facts";

export function readRustRawLocation(ast: AstReader, facts: ReadonlySourceFactResolver, subject: ExtensionFactSubject): TsonicRawLocationSelection | undefined {
  return selectTsonicRawLocationOperation(ast, facts, subject);
}
