import type { Node, Type } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import { rustJsArrayEntriesElementTargetType } from "../../target-model/types/carriers/array-entries.js";
import { rustOptionElementCarrier, rustUndefinedTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustBindingProjectionFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function rustArrayEntryBinding(walk: RustFactWalk, expression: Node): Node | undefined {
  const { ast, source, facts } = walk.context;
  const seen = new Set<Node>();
  let node = expression;
  for (;;) {
    if (ast.kindName(node) === "KindParenthesizedExpression") {
      const inner = Node_Expression(ast, node);
      if (inner === undefined) return undefined;
      node = inner;
      continue;
    }
    if (ast.kindName(node) !== "KindIdentifier") return undefined;
    const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
    if (declaration === undefined || seen.has(declaration) || seen.size >= 256 ||
      source.navigation.declarationUseSummary(declaration).bindingWritten) return undefined;
    seen.add(declaration);
    if (ast.kindName(declaration) === "KindVariableDeclaration") {
      const initializer = Node_Initializer(ast, declaration);
      if (initializer === undefined) return undefined;
      node = initializer;
      continue;
    }
    if (ast.kindName(declaration) !== "KindBindingElement" || Node_Initializer(ast, declaration) !== undefined) return undefined;
    const projection = facts.getFact(declaration, rustBindingProjectionFactKey);
    if (projection?.projection.kind !== "tuple-element" || projection.projection.index !== 1 ||
      projection.normalization !== "identity") return undefined;
    const pattern = ast.parent(declaration);
    const binding = pattern === undefined ? undefined : ast.parent(pattern);
    const list = binding === undefined ? undefined : ast.parent(binding);
    const loop = list === undefined ? undefined : ast.parent(list);
    if (loop === undefined || ast.kindName(loop) !== "KindForOfStatement") return undefined;
    const iteration = facts.getFact(loop, rustTargetOperationFactKey);
    const iterable = Node_Expression(ast, loop);
    const element = iterable === undefined ? undefined : rustJsArrayEntriesElementTargetType(facts.getRuntimeCarrierFact(iterable)?.carrier);
    return iteration?.kind === "iteration" && iteration.iterationKind === "for-of" &&
      iteration.lowering.kind === "receiver-method" && iteration.lowering.name === "clone" && element !== undefined &&
      rustTargetTypeRefEquals(element, rustOptionElementCarrier(projection.bindingCarrier))
      ? declaration : undefined;
  }
}

export function rustArrayEntryPayloadExcludesNullish(walk: RustFactWalk, expression: Node): boolean {
  const binding = rustArrayEntryBinding(walk, expression);
  if (binding === undefined) return false;
  const { ast, source } = walk.context;
  const active = new Set<Type>();
  const excludes = (type: Type, subject: Node): boolean => {
    if (active.has(type) || active.size >= 256) return false;
    const semantics = walk.context.semanticsFor(subject);
    if (semantics.types.isAny(type) || semantics.types.isUnknown(type) ||
      semantics.types.isNullish(type) || semantics.types.isVoidLike(type)) return false;
    active.add(type);
    try {
      if (semantics.types.isUnion(type)) return semantics.types.unionOrIntersectionTypes(type).every(member => excludes(member, subject));
      if (semantics.types.isNumberLike(type) || semantics.types.isStringLike(type) ||
        semantics.types.isBooleanLike(type) || semantics.types.isBigIntLike(type) || semantics.types.isSymbolLike(type)) return true;
      const symbol = semantics.declarations.typeSymbol(type);
      const declaration = symbol === undefined ? undefined : semantics.declarations.primarySymbolDeclaration(symbol);
      if (declaration === undefined) return false;
      if (ast.kindName(declaration) !== "KindTypeParameter") {
        return ["KindClassDeclaration", "KindInterfaceDeclaration", "KindTypeLiteral"].includes(ast.kindName(declaration));
      }
      const constraint = ast.as.AsTypeParameterDeclaration(declaration)?.Constraint;
      if (constraint !== undefined) {
        const constraintType = walk.context.semanticsFor(constraint).types.authoredType(constraint);
        if (constraintType !== undefined && excludes(constraintType, constraint)) return true;
      }
      const callable = ast.parent(declaration);
      if (callable === undefined || ast.kindName(callable) !== "KindFunctionDeclaration") return false;
      const index = ast.typeParameters(callable).indexOf(declaration);
      const uses = source.navigation.declarationUses(callable).filter(use => use.kind !== "type-only");
      return index >= 0 && uses.length > 0 && uses.length <= 16_384 && uses.every(use => {
        if (use.kind !== "direct-call") return false;
        const call = ast.parent(use.reference);
        if (call === undefined || ast.kindName(call) !== "KindCallExpression" || Node_Expression(ast, call) !== use.reference) return false;
        const selected = walk.context.semanticsFor(call).operations.call(call);
        const argument = selected?.sourceSelectedMethodTypeArguments?.[index];
        const selectedDeclaration = selected === undefined ? undefined
          : walk.context.semanticsFor(call).declarations.signatureDeclaration(selected.selectedSignature);
        const implementation = selectedDeclaration === undefined ? undefined : source.navigation.callableImplementation(selectedDeclaration);
        return implementation?.kind === "resolved" && implementation.implementation.declaration === callable &&
          argument !== undefined && excludes(argument.selectedType, call);
      });
    } finally { active.delete(type); }
  };
  const type = walk.context.semanticsFor(binding).declarations.declaredValueType(binding);
  return type !== undefined && excludes(type, binding);
}

export function rustGuardedArrayEntryCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier: TargetTypeRef,
): TargetTypeRef | undefined {
  const element = rustOptionElementCarrier(sourceCarrier);
  if (element === undefined) return undefined;
  const declaration = rustArrayEntryBinding(walk, expression);
  if (declaration === undefined) return undefined;
  const { ast, facts } = walk.context;
  let child = expression;
  for (let parent = ast.parent(child); parent !== undefined; child = parent, parent = ast.parent(parent)) {
    const kind = ast.kindName(parent);
    if (["KindFunctionDeclaration", "KindFunctionExpression", "KindArrowFunction"].includes(kind)) return undefined;
    if (kind !== "KindIfStatement") continue;
    const statement = ast.as.AsIfStatement(parent);
    const condition = statement?.Expression;
    if (statement === undefined || condition === undefined) continue;
    const selected = facts.getFact(condition, rustTargetOperationFactKey);
    if (selected?.kind !== "option-check" || !rustTargetTypeRefEquals(selected.nullishCarrier, rustUndefinedTargetType()) ||
      !rustTargetTypeRefEquals(selected.optionCarrier, sourceCarrier)) continue;
    const checked = selected.optionOperand === "left" ? BinaryExpression_Left(ast, condition) : BinaryExpression_Right(ast, condition);
    const present = (statement.ThenStatement === child && selected.negated) ||
      (statement.ElseStatement === child && !selected.negated);
    if (present && checked !== undefined && rustArrayEntryBinding(walk, checked) === declaration) return element;
  }
  return undefined;
}
