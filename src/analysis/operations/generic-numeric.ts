import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCarrierSupportsSourceNumeric } from "../../target-model/types/carriers/source-numeric.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { selectRustNumericConstraintComparison } from "../../policy/operations/numeric-union.js";
import { rustGenericNumericOperandsKey } from "../facts/generic-numeric.js";
import type { RustTargetTypeResolutionContext } from "../../policy/types/resolution/model.js";
import type { RustOperationsProviderOptions } from "./provider/model.js";

export function rustOperandSupportsSourceNumeric(
  operand: Node,
  carrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustOperationsProviderOptions,
): boolean {
  if (carrier.kind !== "type-parameter") return rustCarrierSupportsSourceNumeric(carrier);
  const semantics = context.currentSemantics;
  const reference = context.source.semantics.selectValueTypeRefinement(operand);
  if (reference.kind === "unresolved") return false;
  const type = reference.kind === "resolved"
    ? reference.declaredType
    : semantics.types.expressionType(operand);
  const symbol = type === undefined ? undefined : semantics.declarations.typeSymbol(type);
  const declaration = symbol === undefined ? undefined : semantics.declarations.primarySymbolDeclaration(symbol);
  if (declaration === undefined || !context.ast.is.IsTypeParameterDeclaration(declaration)) return false;
  const constraint = context.ast.as.AsTypeParameterDeclaration(declaration)?.Constraint;
  const selected = type === undefined ? undefined : resolveRustTargetTypeRef(type, context, options);
  if (constraint === undefined || !rustTargetTypeRefEquals(selected, carrier)) return false;
  const constraintSemantics = context.semanticsFor(constraint);
  const bound = resolveRustTargetTypeRef(constraint, {
    ...context,
    currentSourceFile: constraintSemantics.sourceFile,
    currentSemantics: constraintSemantics,
  }, options);
  return bound !== undefined && rustCarrierSupportsSourceNumeric(bound);
}

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
  const valid = (operand: Node, carrier: TargetTypeRef): boolean => rustOperandSupportsSourceNumeric(
    operand, carrier, rustResolutionContext(walk, operand), walk.operationOptions,
  );
  if (!valid(leftNode, left) || !valid(rightNode, right)) return undefined;
  const selected = selectRustNumericConstraintComparison(operator);
  if (selected !== undefined) walk.context.facts.set(node, rustGenericNumericOperandsKey, Object.freeze([left, right]));
  return selected;
}
