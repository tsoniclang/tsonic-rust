import type { Node } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext } from "./model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

import { rustBroadSourceValueTargetType } from "../../../../policy/types/resolution/broad-values.js";
export function resolveRustAuthoredBroadSourceValueTargetType(
  authoredTypeNode: Node,
  context: RustTargetTypeResolutionContext,
  jsEnabled: boolean,
): TargetTypeRef | undefined {
  const sourceFile = context.ast.getSourceFile(authoredTypeNode);
  if (sourceFile === undefined || !context.sourceFiles.includes(sourceFile)) {
    return undefined;
  }
  return rustBroadSourceValueTargetType(jsEnabled);
}
