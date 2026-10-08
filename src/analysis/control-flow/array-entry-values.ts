import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import { rustJsArrayEntriesElementTargetType } from "../../target-model/types/carriers/array-entries.js";
import { rustOptionElementCarrier, rustAbsenceTargetType } from "../../target-model/types/index.js";
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
    if (selected?.kind !== "option-check" || !rustTargetTypeRefEquals(selected.nullishCarrier, rustAbsenceTargetType()) ||
      selected.nullishDepths.length !== 1 || selected.nullishDepths[0] !== 0 ||
      !rustTargetTypeRefEquals(selected.optionCarrier, sourceCarrier)) continue;
    const checked = selected.optionOperand === "left" ? BinaryExpression_Left(ast, condition) : BinaryExpression_Right(ast, condition);
    const present = (statement.ThenStatement === child && selected.negated) ||
      (statement.ElseStatement === child && !selected.negated);
    if (present && checked !== undefined && rustArrayEntryBinding(walk, checked) === declaration) return element;
  }
  return undefined;
}
