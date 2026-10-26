import type { Node } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { rustSourceStorageSubjectContext } from "../source-evidence/types/resolution/source-storage-projection.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetTypeResolutionContext } from "../source-evidence/types/resolution/model.js";
import { sourceEnclosingCallable, sourceExpressionCallArgument } from "@tsonic/target-api/source";
import { rustResolutionContext } from "../program/walk.js";
import { isRustVecCarrier, rustFutureOutputCarrier, rustJsArrayLikeElementTargetType, rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { resolveRustAuthoredTargetType } from "../source-evidence/types/resolution/tuples.js";
import { bindRustSelectedCallTypeArguments, bindRustSourceDeclarationArguments } from "../source-evidence/types/resolution/generic-arguments.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";

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
    const context = rustResolutionContext(walk, use.reference);
    let carrier: TargetTypeRef | undefined;
    if (use.role === "return") {
      const declaration = sourceEnclosingCallable(use.reference, walk.context.ast);
      if (declaration === undefined) continue;
      const authoredReturn = walk.context.ast.typeNode(declaration);
      const contextualType = authoredReturn === undefined
        ? walk.context.semanticsFor(declaration).types.contextualType(declaration) : undefined;
      const contextualResult = contextualType === undefined ? undefined
        : walk.context.semanticsFor(declaration).types.callable(contextualType.selectedType)?.result;
      const authoredTypeNode = authoredReturn ?? contextualResult?.authoredTypeNode;
      if (authoredTypeNode === undefined) continue;
      const argument = sourceExpressionCallArgument(declaration, walk.context.source);
      const selected = argument === undefined ? undefined
        : walk.context.semanticsFor(argument.call).operations.call(argument.call);
      const selectedContext = selected === undefined ? context : arrayStorageCallContext(walk, selected);
      const demandContext = selectedContext === undefined ? undefined
        : arrayStorageDemandContext(walk, authoredTypeNode, selectedContext);
      if (demandContext === undefined) continue;
      const result = resolveRustAuthoredTargetType(authoredTypeNode, demandContext, walk.operationOptions, new Set());
      carrier = walk.context.ast.hasModifierKind(declaration, "async") ? rustFutureOutputCarrier(result) : result;
    } else {
      const argument = sourceExpressionCallArgument(use.reference, walk.context.source);
      const selected = argument === undefined ? undefined
        : walk.context.semanticsFor(argument.call).operations.call(argument.call);
      const parameter = selected?.sourceSelectedSignatureKind === "resolved"
        ? selected.sourceSelectedSignatureParameters.find(parameter =>
            parameter.parameterIndex === argument?.argumentIndex && !parameter.rest)
        : undefined;
      const authoredTypeNode = parameter?.authoredTypeNode;
      if (authoredTypeNode === undefined || selected === undefined) continue;
      const selectedContext = arrayStorageCallContext(walk, selected);
      const demandContext = selectedContext === undefined ? undefined
        : arrayStorageDemandContext(walk, authoredTypeNode, selectedContext);
      if (demandContext === undefined) continue;
      carrier = resolveRustAuthoredTargetType(authoredTypeNode, demandContext, walk.operationOptions, new Set());
    }
    if (carrier === undefined) return Object.freeze([]);
    const element = isRustVecCarrier(carrier) ? carrier.element : rustJsArrayLikeElementTargetType(carrier);
    if (element !== undefined && rustTargetTypeParameterIdentities(element).length === 0) demands.push(element);
  }
  return Object.freeze(demands);
}

function arrayStorageDemandContext(
  walk: RustFactWalk,
  authoredTypeNode: Node,
  context: RustTargetTypeResolutionContext,
): RustTargetTypeResolutionContext | undefined {
  const selection = walk.context.sourceStorage.storageSubjectFor(authoredTypeNode);
  return selection.kind === "resolved" ? rustSourceStorageSubjectContext(context, selection) : undefined;
}

function arrayStorageCallContext(
  walk: RustFactWalk,
  selected: NonNullable<ReturnType<SourceFileSemantics["operations"]["call"]>>,
): RustTargetTypeResolutionContext | undefined {
  let context = rustResolutionContext(walk, selected.call);
  const receiver = selected.sourceReceiver;
  if (receiver !== undefined) {
    const carrier = resolveRustTargetTypeRef(receiver.expression, context, walk.operationOptions);
    const sourceType = rustSourceTypeCarrierValue(carrier);
    const declaration = carrier === undefined ? undefined : walk.operationOptions.sourceTypes.declarationForCarrier(carrier);
    if (sourceType !== undefined && declaration !== undefined) {
      const bound = bindRustSourceDeclarationArguments(declaration, receiver.type, sourceType.genericArguments, context);
      if (bound === undefined) return undefined;
      context = bound;
    }
  }
  const sourceArguments = (selected.sourceSelectedMethodTypeArguments ?? [])
    .filter(argument => argument.explicitTypeNode !== undefined);
  const targetArguments = sourceArguments.map(argument => {
    const type = resolveRustTargetTypeRef(argument.explicitTypeNode, context, walk.operationOptions);
    return type === undefined ? undefined : { kind: "type" as const, type };
  });
  if (targetArguments.some(argument => argument === undefined)) return undefined;
  return bindRustSelectedCallTypeArguments(sourceArguments, targetArguments.filter(argument => argument !== undefined), context);
}
