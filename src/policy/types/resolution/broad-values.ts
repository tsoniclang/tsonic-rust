import {
  rustJsValueTargetType,
  rustEmptyObjectTargetType,
  rustTsValueTargetType,
} from "../../../target-model/types/index.js";
import type { Node } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function rustBroadSourceValueTargetType(jsEnabled: boolean): TargetTypeRef {
  return jsEnabled ? rustJsValueTargetType() : rustTsValueTargetType();
}

export function resolveRustNativeObjectStorageTargetType(
  context: RustTargetTypeResolutionContext,
  jsEnabled: boolean,
): TargetTypeRef {
  const subject = context.sourceStorageSubject;
  if (subject?.projection[subject.projection.length - 1]?.kind === "array-element" && context.sourceStorage.failureReason() === undefined) {
    const origins = context.sourceStorage.closedOriginsFor(subject);
    if (origins.kind === "complete" && origins.origins.length > 0 && origins.origins.every(origin =>
      origin.subject.kind === "value" && origin.subject.projection.length === 0 &&
      context.ast.is.IsObjectLiteralExpression(origin.subject.node) && context.ast.properties(origin.subject.node).length === 0) &&
      context.sourceStorage.failureReason() === undefined) return rustEmptyObjectTargetType();
  }
  return rustBroadSourceValueTargetType(jsEnabled);
}

export function resolveRustAuthoredBroadSourceValueTargetType(
  authoredTypeNode: Node,
  context: RustTargetTypeResolutionContext,
  jsEnabled: boolean,
): TargetTypeRef | undefined {
  const sourceFile = context.ast.getSourceFile(authoredTypeNode);
  if (sourceFile === undefined || !context.sourceFiles.includes(sourceFile)) {
    return undefined;
  }
  return context.ast.kindName(authoredTypeNode) === "KindObjectKeyword"
    ? resolveRustNativeObjectStorageTargetType(context, jsEnabled) : rustBroadSourceValueTargetType(jsEnabled);
}
