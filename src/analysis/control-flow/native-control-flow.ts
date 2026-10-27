import type { Node } from "@tsonic/tsts";
import { sourceNodeIsNativeUnreachable } from "@tsonic/target-api/source";

import { selectRustNativeGuardResult } from "../source-evidence/types/resolution/native-flow-refinement.js";

import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";

export function recordRustNativeGuardResult(walk: RustFactWalk, expression: Node): boolean | undefined {
  const context = walk.context;
  return context.records.nativeGuardResults.resolve(expression, () => {
    const selected = selectRustNativeGuardResult({ ast: context.ast, navigation: context.source.navigation,
    sourceFacts: context.source.sourceFacts, semanticsFor: context.semanticsFor }, expression, reference => {
    const declaration = context.source.navigation.referenceFor(reference)?.declaration;
    return declaration === undefined ? undefined : context.records.runtimeCarrier.get(declaration)?.carrier ??
      resolveRustTargetTypeRef(declaration, rustResolutionContext(walk, declaration), walk.operationOptions);
    }, context.projectTypes, context.typeDefinitions);
    if (selected !== undefined) requireRustRecord(context.requiredRecords, "nativeGuardResult", expression,
      "native guard", "recordRustNativeGuardResult");
    return selected;
  });
}

export function recordRustNativeUnreachable(walk: RustFactWalk, node: Node): boolean {
  return walk.context.records.nativeUnreachableNodes.resolve(node, () => {
    const selected = sourceNodeIsNativeUnreachable(walk.context.ast, node,
      expression => recordRustNativeGuardResult(walk, expression));
    if (selected) requireRustRecord(walk.context.requiredRecords, "nativeUnreachable", node,
      "native unreachable source", "recordRustNativeUnreachable");
    return selected;
  });
}
