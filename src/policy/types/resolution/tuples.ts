import {
  Node_Initializer,
  Node_Type,
  TypeReferenceNode_TypeName,
  TypeOperatorNode_Type,
} from "@tsonic/target-api/source";
import { resolveOwnedSourceProfileTypeNameForDeclaration } from "./providers.js";
import { resolveRustTargetType } from "./target.js";
import { resolveRustTargetTypeSyntax } from "./source.js";
import { resolveRustTypeComponentEvidence } from "./source-evidence.js";
import { rustSliceMutRefTargetType, rustSliceRefTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  sourceTransformedTypeFactEvidenceNodes,
  sourceTupleElementTypeEvidenceNodes,
} from "@tsonic/target-api/source";
import type { Node, TypeTupleElementInfo } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function resolveRustTupleElementTargetType(
  element: TypeTupleElementInfo,
  semantics: SourceFileSemantics,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  return resolveRustTupleElementTargetTypeWithState(
    element,
    semantics,
    context,
    options,
    new Set<object>(),
  );
}

export function resolveRustTupleElementTargetTypeWithState(
  element: TypeTupleElementInfo,
  semantics: SourceFileSemantics,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  authoredRoot?: Node,
): TargetTypeRef | undefined {
  const evidenceNodes = [
    ...sourceTupleElementTypeEvidenceNodes(
      context.ast,
      semantics,
      element,
    ),
    ...(authoredRoot === undefined
      ? []
      : sourceTransformedTypeFactEvidenceNodes(
          context.ast,
          semantics,
          authoredRoot,
          element.type,
        )),
  ];
  if (evidenceNodes.length === 0) {
    return resolveRustTargetType(
      element.type,
      context,
      options,
      resolving,
    );
  }
  const carriers = [...new Set(evidenceNodes)].map((authoredTypeNode) =>
    resolveRustTypeComponentEvidence(
      {
        selectedType: element.type,
        ...(element.declaration === undefined
          ? {}
          : { declaration: element.declaration }),
        authoredTypeNode,
      },
      context,
      options,
      resolving,
    )
  );
  if (carriers.some((carrier) => carrier === undefined)) {
    return undefined;
  }
  const first = carriers[0]!;
  return carriers.every((carrier) =>
      carrier !== undefined && rustTargetTypeRefEquals(first, carrier)
    )
    ? first
    : undefined;
}

export function resolveRustAuthoredTargetType(
  node: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  return resolveRustTargetTypeSyntax(node, context, options, resolving) ??
    resolveRustTargetType(
      context.semanticsFor(node).types.expressionType(node),
      context,
      options,
      resolving,
    );
}

export function resolveReferencedDeclarationType(
  node: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const { ast } = context;
  const declaration = context.source.navigation.referenceFor(node)?.declaration;
  if (declaration !== undefined) {
      const declarationCarrier = context.facts.getRuntimeCarrierFact(declaration)?.carrier;
      if (declarationCarrier !== undefined) {
        return declarationCarrier;
      }
      const typeNode = Node_Type(ast, declaration);
      if (typeNode !== undefined) {
        const target = resolveRustAuthoredTargetType(typeNode, context, options, new Set<object>());
        if (target !== undefined) {
          return ast.kindName(declaration) === "KindParameter"
            ? rustParameterLaneTargetType(target, typeNode, context, options)
            : target;
        }
      }
      const initializer = Node_Initializer(ast, declaration);
      const selectedResult = initializer === undefined
        ? undefined
        : context.facts.getSelectedTargetCall(initializer)?.member.returnType;
      if (selectedResult !== undefined) {
        return selectedResult;
      }
  }
  return undefined;
}

export function rustParameterLaneTargetType(
  carrier: TargetTypeRef | undefined,
  typeNode: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (carrier?.kind !== "array") {
    return carrier;
  }
  return sourceParameterTypeIsReadonlyArray(typeNode, context, options)
    ? rustSliceRefTargetType(carrier.element)
    : rustSliceMutRefTargetType(carrier.element);
}

function sourceParameterTypeIsReadonlyArray(
  typeNode: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): boolean {
  const { ast } = context;
  if (ast.kindName(typeNode) === "KindTypeOperator") {
    const inner = TypeOperatorNode_Type(ast, typeNode);
    return inner !== undefined && ast.kindName(inner) === "KindArrayType";
  }
  if (ast.kindName(typeNode) !== "KindTypeReference") {
    return false;
  }
  const typeName = TypeReferenceNode_TypeName(ast, typeNode);
  const declaration = typeName === undefined
    ? undefined
    : context.source.navigation.sourceReferenceFor(typeName)?.declaration;
  return resolveOwnedSourceProfileTypeNameForDeclaration(
    declaration,
    context,
    options.sourceProfiles,
  ) === "ReadonlyArray";
}
