import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { sourceEnclosingCallable, sourceExpressionCallArgument } from "@tsonic/target-api/source";
import { rustResolutionContext } from "../program/walk.js";
import { isRustNumericCarrier, isRustVecCarrier, rustJsArrayLikeElementTargetType } from "../../target-model/types/index.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";
import { resolveRustTypeComponentEvidence } from "../../policy/types/resolution/source-evidence.js";

export function collectRustArrayElementStorageDemands(
  walk: RustFactWalk,
  expression: Node,
): readonly TargetTypeRef[] {
  const flow = walk.context.source.navigation.expressionValueFlow(expression);
  if (flow.hasUnclassifiedUse) return Object.freeze([]);
  const demands: TargetTypeRef[] = [];
  for (const declaration of flow.aliasDeclarations) {
    const type = walk.context.ast.typeNode(declaration);
    if (type === undefined) continue;
    const carrier = resolveRustTargetTypeRef(type, rustResolutionContext(walk, declaration), walk.operationOptions);
    if (carrier === undefined) return Object.freeze([]);
    const element = isRustVecCarrier(carrier) ? carrier.element : rustJsArrayLikeElementTargetType(carrier);
    if (element !== undefined) demands.push(element);
  }
  for (const use of flow.uses) {
    if (use.throughMember || use.role !== "argument" && use.role !== "return") continue;
    const type = walk.context.semanticsFor(use.reference).types.contextualType(use.reference);
    if (type === undefined) continue;
    const context = rustResolutionContext(walk, use.reference);
    let carrier: TargetTypeRef | undefined;
    if (use.role === "return") {
      const declaration = sourceEnclosingCallable(use.reference, walk.context.ast);
      const authoredTypeNode = declaration === undefined ? undefined : walk.context.ast.typeNode(declaration);
      carrier = authoredTypeNode === undefined
        ? declaration === undefined ? undefined : walk.context.records.sourceCallableReturn.get(declaration)?.returnCarrier
        : resolveRustTypeComponentEvidence({ selectedType: type, declaration, authoredTypeNode },
            context, walk.operationOptions, new Set());
    } else {
      const argument = sourceExpressionCallArgument(use.reference, walk.context.source);
      const selected = argument === undefined ? undefined
        : walk.context.semanticsFor(argument.call).operations.call(argument.call);
      const parameter = selected?.sourceSelectedSignatureKind === "resolved"
        ? selected.sourceSelectedSignatureParameters.find(parameter =>
            parameter.parameterIndex === argument?.argumentIndex && !parameter.rest)
        : undefined;
      const authoredTypeNode = parameter?.authoredTypeNode;
      carrier = authoredTypeNode === undefined
        ? resolveRustTargetTypeRef(type, context, walk.operationOptions)
        : resolveRustTypeComponentEvidence({ selectedType: type, authoredTypeNode },
            context, walk.operationOptions, new Set());
      const element = isRustVecCarrier(carrier) ? carrier.element : rustJsArrayLikeElementTargetType(carrier);
      if (authoredTypeNode === undefined && isRustNumericCarrier(element)) continue;
    }
    if (carrier === undefined) return Object.freeze([]);
    const element = isRustVecCarrier(carrier) ? carrier.element : rustJsArrayLikeElementTargetType(carrier);
    if (element !== undefined) demands.push(element);
  }
  return Object.freeze(demands);
}
