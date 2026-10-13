import type { Node } from "@tsonic/tsts";
import { sourceNodeIsNativeUnreachable } from "@tsonic/target-api/source";

import { selectRustNativeGuardResult } from "../../policy/types/resolution/native-flow-refinement.js";

import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";

export function recordRustNativeGuardResult(walk: RustFactWalk, expression: Node): boolean | undefined {
  const existing = walk.context.records.nativeGuardResult.get(expression);
  if (existing !== undefined) return existing;
  const context = walk.context;
  const result = selectRustNativeGuardResult({ ast: context.ast, navigation: context.source.navigation,
    sourceFacts: context.source.sourceFacts, semanticsFor: context.semanticsFor }, expression, reference => {
    const declaration = context.source.navigation.referenceFor(reference)?.declaration;
    return declaration === undefined ? undefined : context.records.runtimeCarrier.get(declaration)?.carrier ??
      resolveRustTargetTypeRef(declaration, rustResolutionContext(walk, declaration), walk.operationOptions);
  }, context.projectTypes, context.typeDefinitions);
  if (result !== undefined) context.records.nativeGuardResult.set(expression, result);
  return result;
}

export function recordRustNativeUnreachable(walk: RustFactWalk, node: Node): boolean {
  if (walk.context.records.nativeUnreachable.get(node) === true) return true;
  const unreachable = sourceNodeIsNativeUnreachable(walk.context.ast, node,
    expression => recordRustNativeGuardResult(walk, expression));
  if (unreachable) walk.context.records.nativeUnreachable.set(node, true);
  return unreachable;
}
