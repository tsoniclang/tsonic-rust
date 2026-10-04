import {
  rustJsValueTargetType,
  rustTsValueTargetType,
} from "../../../target-model/types/index.js";
import type { Node } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function resolveRustAuthoredBroadSourceValueTargetType(
  authoredTypeNode: Node,
  context: RustTargetTypeResolutionContext,
  jsEnabled: boolean,
): TargetTypeRef | undefined {
  const sourceFile = context.ast.getSourceFile(authoredTypeNode);
  if (sourceFile === undefined || !context.sourceFiles.includes(sourceFile)) {
    return undefined;
  }
  return jsEnabled ? rustJsValueTargetType() : rustTsValueTargetType();
}
