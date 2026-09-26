import {
  KindElementAccessExpression,
  KindParenthesizedExpression,
  KindPropertyAccessExpression,
  KindSatisfiesExpression,
  Node_Expression,
  Node_Type,
} from "@tsonic/target-api/source";
import {
  isRustProgramErrorCarrier,
  isRustJsValueCarrier,
  rustJsErrorTargetType,
  rustOptionElementCarrier,
  rustSourceOptionalTargetType,
  rustAbsenceTargetType,
  rustStructuralObjectCarrierValue,
} from "../../target-model/types/index.js";
import {
  rustRuntimeUnionContract,
  rustRuntimeUnionProjection,
} from "../../target-model/types/carriers/runtime-unions.js";
import { selectRustFlowReadProjection } from "../../policy/types/value-carrier-reconciliation.js";
import { recordRustFlowReadProjection } from "../facts/value-carrier-queries.js";
import { rustFlowReadProjectionFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { Node, Type } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustGuardedArrayEntryCarrier } from "../control-flow/array-entry-values.js";
import { recordBindingWrite } from "../declarations/types-and-bindings.js";

export function applyFlowReadLane(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (sourceCarrier === undefined) {
    return undefined;
  }
  let receiver = expression;
  let parent = walk.context.ast.parent(receiver);
  while (parent !== undefined &&
    (walk.context.ast.kindName(parent) === KindParenthesizedExpression ||
      walk.context.ast.kindName(parent) === KindSatisfiesExpression) &&
    Node_Expression(walk.context.ast, parent) === receiver) {
    receiver = parent;
    parent = walk.context.ast.parent(receiver);
  }
  const parentKind = parent === undefined ? undefined : walk.context.ast.kindName(parent);
  if (parent !== undefined && walk.context.ast.as.AsCallExpression(parent)?.QuestionDotToken !== undefined &&
    Node_Expression(walk.context.ast, parent) === receiver) return sourceCarrier;
  const access = parent === undefined ? undefined
    : parentKind === KindPropertyAccessExpression
      ? walk.context.semanticsFor(parent).operations.propertyAccess(parent)
      : parentKind === KindElementAccessExpression
        ? walk.context.semanticsFor(parent).operations.elementAccess(parent)
        : undefined;
  if (access?.optionalChain === true && access.receiver.expression === receiver) {
    return sourceCarrier;
  }
  const existing = walk.context.facts.get(expression, rustFlowReadProjectionFactKey) ??
    walk.context.facts.resolve(expression, rustFlowReadProjectionFactKey);
  if (existing !== undefined) {
    if (!rustTargetTypeRefEquals(existing.sourceCarrier, sourceCarrier)) {
      appendRustDiagnostic(
        walk,
        "RUST_FLOW_READ_SOURCE_CONFLICT",
        "The finalized Rust flow-read projection conflicts with the expression's raw runtime carrier.",
        expression,
        ["target.capability=rust.flow-read.exact-source"],
      );
      return undefined;
    }
    return existing.selectedCarrier;
  }
  const entryCarrier = rustGuardedArrayEntryCarrier(walk, expression, sourceCarrier);
  if (entryCarrier !== undefined) {
    recordRustFlowReadProjection(walk.context.facts, expression, {
      kind: "option-value", sourceCarrier, selectedCarrier: entryCarrier,
    });
    return entryCarrier;
  }
  const selectedSource = selectedFlowReadSource(walk, expression, sourceCarrier);
  if (selectedSource === undefined) {
    return sourceCarrier;
  }
  const selectedCarrier = resolveSelectedFlowReadCarrier(
    walk,
    expression,
    selectedSource.declaration,
    selectedSource.type,
    sourceCarrier,
  );
  if (selectedCarrier === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_FLOW_READ_SELECTED_CARRIER_MISSING",
      "The exact checker-selected source value has no closed Rust flow-read carrier.",
      expression,
      ["target.capability=rust.flow-read.exact-result"],
    );
    return undefined;
  }
  const selection = selectRustFlowReadProjection(
    sourceCarrier,
    selectedCarrier,
    walk.context.projectTypes, walk.context.typeDefinitions,
  );
  if (selection.kind === "identity") {
    return sourceCarrier;
  }
  if (selection.kind === "incompatible") {
    appendRustDiagnostic(
      walk,
      "RUST_FLOW_READ_PROJECTION_UNSUPPORTED",
      "The raw Rust value cannot be projected to the exact checker-selected flow carrier.",
      expression,
      [
        "target.capability=rust.flow-read.closed-projection",
        `source=${JSON.stringify(sourceCarrier)}`,
        `selected=${JSON.stringify(selectedCarrier)}`,
      ],
    );
    return undefined;
  }
  recordRustFlowReadProjection(
    walk.context.facts,
    expression,
    selection.fact,
  );
  if (selection.fact.kind === "option-reference") recordBindingWrite(walk, expression, "referent");
  return selection.fact.selectedCarrier;
}

function selectedFlowReadSource(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier: TargetTypeRef,
): { readonly declaration?: Node; readonly type: Type } | undefined {
  const sourceFile = walk.context.ast.getSourceFile(expression);
  if (sourceFile === undefined || !walk.context.source.semantics.includes(sourceFile)) {
    return undefined;
  }
  const semantics = walk.context.source.semantics.forNode(expression);
  if (isRustProgramErrorCarrier(sourceCarrier) || isRustJsValueCarrier(sourceCarrier)) {
    const type = semantics.types.expressionType(expression);
    return type === undefined ? undefined : { type };
  }
  const kind = walk.context.ast.kindName(expression);
  if (kind === KindPropertyAccessExpression) {
    const selected = semantics.operations.propertyAccess(expression);
    return selected?.callCallee === true || selected?.sourceReadType === undefined
      ? undefined
      : {
          ...(selected.selectedDeclaration === undefined
            ? {}
            : { declaration: selected.selectedDeclaration }),
          type: selected.sourceReadType,
        };
  }
  if (kind === KindElementAccessExpression) {
    const selected = semantics.operations.elementAccess(expression);
    return selected?.callCallee === true || selected?.sourceReadType === undefined
      ? undefined
      : {
          ...(selected.selectedDeclaration === undefined
            ? {}
            : { declaration: selected.selectedDeclaration }),
          type: selected.sourceReadType,
        };
  }
  const refinement = walk.context.source.semantics.selectValueTypeRefinement(expression);
  return refinement.kind === "resolved" && refinement.refinement.kind === "members"
    ? { declaration: refinement.reference.declaration, type: refinement.selectedType }
    : undefined;
}

function resolveSelectedFlowReadCarrier(
  walk: RustFactWalk,
  expression: Node,
  declaration: Node | undefined,
  selectedType: Type,
  sourceCarrier: TargetTypeRef,
): TargetTypeRef | undefined {
  const semantics = walk.context.semanticsFor(expression);
  const access = walk.context.ast.kindName(expression) === KindPropertyAccessExpression
    ? semantics.operations.propertyAccess(expression)
    : walk.context.ast.kindName(expression) === KindElementAccessExpression
      ? semantics.operations.elementAccess(expression)
      : undefined;
  const declaredReadType = access?.selectedSymbol === undefined ? undefined :
    semantics.types.typeOfSymbol(access.selectedSymbol);
  if (declaredReadType !== undefined && semantics.types.isIdentical(declaredReadType, selectedType)) {
    return sourceCarrier;
  }
  const sourceUnion = walk.sourceTypes.sourceUnionForCarrier(sourceCarrier);
  if (sourceUnion !== undefined) {
    const selectedTypes = semantics.types.isUnion(selectedType)
      ? semantics.types.unionOrIntersectionTypes(selectedType) : [selectedType];
    const indexes = walk.sourceTypes.sourceUnionVariantIndexesForTypes(sourceCarrier, selectedTypes);
    if (indexes?.length === 1) return sourceUnion.variants[indexes[0]!]!.carrier;
  }
  if (isRustJsValueCarrier(sourceCarrier)) {
    const carrier = resolveRustTargetTypeRef(
      selectedType, rustResolutionContext(walk, expression), walk.operationOptions,
    );
    return rustTargetTypeRefEquals(carrier, rustJsErrorTargetType()) ? carrier : sourceCarrier;
  }
  if (isRustProgramErrorCarrier(sourceCarrier)) {
    const carrier = resolveRustTargetTypeRef(
      selectedType, rustResolutionContext(walk, expression), walk.operationOptions,
    );
    if (rustTargetTypeRefEquals(carrier, rustJsErrorTargetType()) &&
      walk.context.projectTypes.builtinErrorProjectionAvailable === true) return carrier;
    const definition = walk.context.projectTypes.definitionForCarrier(carrier);
    return definition !== undefined &&
      walk.context.projectTypes.programErrorVariant(definition) !== undefined
      ? carrier
      : sourceCarrier;
  }
  if (rustRuntimeUnionContract(sourceCarrier) !== undefined) {
    const semantics = walk.context.semanticsFor(expression);
    const members = semantics.types.isUnion(selectedType)
      ? semantics.types.unionOrIntersectionTypes(selectedType)
      : [selectedType];
    const carriers = members.map(member => resolveRustTargetTypeRef(
      member, rustResolutionContext(walk, expression), walk.operationOptions,
    ));
    if (carriers.length === 0 || carriers.some(carrier =>
      carrier === undefined || rustRuntimeUnionProjection(sourceCarrier, carrier) === undefined)) {
      return undefined;
    }
    const first = carriers[0]!;
    return carriers.every(carrier => rustTargetTypeRefEquals(carrier, first)) ? first : sourceCarrier;
  }
  if (rustOptionElementCarrier(sourceCarrier) !== undefined &&
    walk.context.semanticsFor(expression).types.isNullish(selectedType)) {
    return sourceCarrier;
  }
  const operation = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(expression, rustTargetOperationFactKey);
  if (operation?.kind === "provider-operation" &&
    operation.sourceResultCarrier !== undefined) {
    return operation.sourceResultCarrier;
  }
  const typeNode = Node_Type(walk.context.ast, declaration);
  const semanticCarrier = resolveRustTargetTypeRef(
    selectedType, rustResolutionContext(walk, expression), walk.operationOptions,
  );
  const dispatchCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
  if (semanticCarrier !== undefined && rustStructuralObjectCarrierValue(semanticCarrier)?.bases?.some(base =>
    rustTargetTypeRefEquals(base, dispatchCarrier))) {
    return semanticCarrier;
  }
  const typeSourceFile = typeNode === undefined
    ? undefined
    : walk.context.ast.getSourceFile(typeNode);
  if (typeNode !== undefined && typeSourceFile !== undefined &&
    walk.context.source.semantics.includes(typeSourceFile)) {
    const semantics = walk.context.source.semantics.forNode(typeNode);
    const authored = semantics.types.authoredSelection(typeNode, selectedType);
    if (authored.kind === "ambiguous") {
      return undefined;
    }
    if (authored.kind === "authored-members") {
      if (authored.nodes.length === 1 && authored.nodes[0] === typeNode &&
        authored.selectedNullishTypes.length === 0) {
        return sourceCarrier;
      }
      const selectedMembers = authored.nodes.map((node) =>
        resolveRustTargetTypeRef(
          node,
          rustResolutionContext(walk, node),
          walk.operationOptions,
        ));
      const optionalElement = rustOptionElementCarrier(sourceCarrier);
      if (selectedMembers.length === 1 &&
        selectedMembers[0]?.kind === "type-parameter" &&
        optionalElement !== undefined &&
        authored.selectedNullishTypes.length === 0) {
        return optionalElement;
      }
      if (selectedMembers.some((member) => member === undefined)) {
        return undefined;
      }
      return combineSelectedFlowReadCarriers(
        selectedMembers as readonly TargetTypeRef[],
        authored.selectedNullishTypes.length > 0,
        walk,
      );
    }
  }
  const optionalElement = rustOptionElementCarrier(sourceCarrier);
  if (optionalElement === undefined) {
    return semanticCarrier !== undefined &&
        walk.context.projectTypes.definitionForCarrier(sourceCarrier) !== undefined &&
        walk.context.projectTypes.definitionForCarrier(semanticCarrier) !== undefined
      ? semanticCarrier
      : sourceCarrier;
  }
  const selectedMembers = walk.context.semanticsFor(expression).types.isUnion(selectedType)
    ? walk.context.semanticsFor(expression).types.unionOrIntersectionTypes(selectedType)
    : [selectedType];
  if (selectedMembers.some((member) => member === undefined)) {
    return undefined;
  }
  const includesNullish = selectedMembers.some((member) =>
    member !== undefined && walk.context.semanticsFor(expression).types.isNullish(member));
  if (includesNullish) {
    return sourceCarrier;
  }
  return semanticCarrier !== undefined &&
      walk.context.projectTypes.definitionForCarrier(semanticCarrier) !== undefined
    ? semanticCarrier
    : optionalElement;
}

function combineSelectedFlowReadCarriers(
  members: readonly TargetTypeRef[],
  includesNullish: boolean,
  walk: RustFactWalk,
): TargetTypeRef | undefined {
  const distinct = members.filter((member, index) =>
    members.findIndex((candidate) => rustTargetTypeRefEquals(candidate, member)) === index);
  const valueCarrier = distinct.length === 1
    ? distinct[0]
    : walk.context.projectTypes.commonSupertype(distinct);
  if (valueCarrier === undefined) {
    return includesNullish && distinct.length === 0
      ? rustAbsenceTargetType()
      : undefined;
  }
  return includesNullish ? rustSourceOptionalTargetType(valueCarrier) : valueCarrier;
}
