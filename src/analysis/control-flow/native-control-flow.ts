import type { Node } from "@tsonic/tsts";
import { sourceNodeIsNativeUnreachable } from "@tsonic/target-api/source";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { selectRustNativeGuardResult } from "../../policy/types/resolution/native-flow-refinement.js";
import { rustNativeGuardResultFactKey, rustNativeUnreachableFactKey } from "../facts/native-control-flow.js";
import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";

export function recordRustNativeGuardResult(walk: RustFactWalk, expression: Node): boolean | undefined {
  const existing = walk.context.facts.get(expression, rustNativeGuardResultFactKey);
  if (existing !== undefined) return existing;
  const context = walk.context;
  const result = selectRustNativeGuardResult({ ast: context.ast, navigation: context.source.navigation,
    sourceFacts: context.source.sourceFacts, semanticsFor: context.semanticsFor }, expression, reference => {
    const declaration = context.source.navigation.referenceFor(reference)?.declaration;
    return declaration === undefined ? undefined : context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
      resolveRustTargetTypeRef(declaration, rustResolutionContext(walk, declaration), walk.operationOptions);
  }, context.projectTypes, context.typeDefinitions);
  if (result !== undefined) context.facts.set(expression, rustNativeGuardResultFactKey, result);
  return result;
}

export function recordRustNativeUnreachable(walk: RustFactWalk, node: Node): boolean {
  if (walk.context.facts.get(node, rustNativeUnreachableFactKey) === true) return true;
  const unreachable = sourceNodeIsNativeUnreachable(walk.context.ast, node,
    expression => recordRustNativeGuardResult(walk, expression));
  if (unreachable) walk.context.facts.set(node, rustNativeUnreachableFactKey, true);
  return unreachable;
}
