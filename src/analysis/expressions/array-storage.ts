import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustResolutionContext } from "../program/walk.js";
import { isRustVecCarrier, rustJsArrayLikeElementTargetType } from "../../target-model/types/index.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { selectRustArrayElementStorage } from "../../policy/types/array-storage.js";

export function resolveRustArrayElementStorage(
  walk: RustFactWalk,
  expression: Node,
  inferred: TargetTypeRef,
): TargetTypeRef {
  const flow = walk.context.source.navigation.expressionValueFlow(expression);
  if (flow.hasUnclassifiedUse) return inferred;
  const demands: TargetTypeRef[] = [];
  for (const declaration of flow.aliasDeclarations) {
    const type = walk.context.ast.typeNode(declaration);
    if (type === undefined) continue;
    const carrier = resolveRustTargetTypeRef(type, rustResolutionContext(walk, declaration), walk.operationOptions);
    if (carrier === undefined) return inferred;
    const element = isRustVecCarrier(carrier) ? carrier.element : rustJsArrayLikeElementTargetType(carrier);
    if (element !== undefined) demands.push(element);
  }
  for (const use of flow.uses) {
    if (use.throughMember || use.role !== "argument") continue;
    const type = walk.context.semanticsFor(use.reference).types.contextualType(use.reference);
    if (type === undefined) continue;
    const carrier = resolveRustTargetTypeRef(type, rustResolutionContext(walk, use.reference), walk.operationOptions);
    if (carrier === undefined) return inferred;
    const element = isRustVecCarrier(carrier) ? carrier.element : rustJsArrayLikeElementTargetType(carrier);
    if (element !== undefined) demands.push(element);
  }
  return selectRustArrayElementStorage(inferred, demands, walk.context.typeDefinitions);
}
