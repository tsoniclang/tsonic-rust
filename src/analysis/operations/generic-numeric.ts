import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCarrierSupportsSourceNumeric } from "../../target-model/types/carriers/source-numeric.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { selectRustNumericConstraintComparison } from "../../policy/operations/numeric-union.js";
import { rustGenericNumericOperandsKey } from "../facts/generic-numeric.js";

export function selectRustGenericNumericOperation(
  walk: RustFactWalk,
  node: Node,
  operator: string,
  leftNode: Node,
  rightNode: Node,
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
) {
  if (!walk.jsEnabled || left === undefined || right === undefined ||
    left.kind !== "type-parameter" && right.kind !== "type-parameter") return undefined;
  const valid = (operand: Node, carrier: TargetTypeRef): boolean => {
    if (carrier.kind !== "type-parameter") return rustCarrierSupportsSourceNumeric(carrier);
    const semantics = walk.context.semanticsFor(operand);
    const type = semantics.types.expressionType(operand);
    const symbol = type === undefined ? undefined : semantics.declarations.typeSymbol(type);
    const declaration = symbol === undefined ? undefined : semantics.declarations.primarySymbolDeclaration(symbol);
    if (declaration === undefined || !walk.context.ast.is.IsTypeParameterDeclaration(declaration)) return false;
    const constraint = walk.context.ast.as.AsTypeParameterDeclaration(declaration)?.Constraint;
    const selected = type === undefined ? undefined : resolveRustTargetTypeRef(type,
      rustResolutionContext(walk, operand), walk.operationOptions);
    if (constraint === undefined || !rustTargetTypeRefEquals(selected, carrier)) return false;
    const bound = resolveRustTargetTypeRef(constraint, rustResolutionContext(walk, constraint), walk.operationOptions);
    return bound !== undefined && rustCarrierSupportsSourceNumeric(bound);
  };
  if (!valid(leftNode, left) || !valid(rightNode, right)) return undefined;
  const selected = selectRustNumericConstraintComparison(operator);
  if (selected !== undefined) walk.context.facts.set(node, rustGenericNumericOperandsKey, Object.freeze([left, right]));
  return selected;
}
