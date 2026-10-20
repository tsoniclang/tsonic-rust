import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import type { Node } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer, orderEnumerableOwnStringProperties } from "@tsonic/target-api/source";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustOperationsProviderOptions } from "./model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTargetTypeRef } from "../../types/resolution/index.js";

export function selectedRustForInKeys(
  expression: Node,
  carrier: TargetTypeRef,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): readonly string[] | undefined {
  const { ast } = context;
  const expected = options.sourceTypes.propertyKeysForCarrier(carrier, ast, context.semanticsFor);
  if (expected === undefined) return undefined;
  const expectedKeys = new Set(expected);
  const visited = new Set<Node>();
  let origin: Node | undefined = expression;
  while (origin !== undefined && !visited.has(origin)) {
    visited.add(origin);
    const kind = ast.kindName(origin);
    if (["KindParenthesizedExpression", "KindAsExpression", "KindSatisfiesExpression", "KindNonNullExpression"].includes(kind)) {
      origin = Node_Expression(ast, origin);
      continue;
    }
    if (kind === "KindIdentifier") {
      const declaration = context.source.navigation.sourceReferenceFor(origin)?.declaration;
      if (declaration === undefined || ast.kindName(declaration) !== "KindVariableDeclaration") return undefined;
      const uses = context.source.navigation.declarationUseSummary(declaration);
      if (uses.bindingWritten || uses.exported) return undefined;
      origin = Node_Initializer(ast, declaration);
      continue;
    }
    if (kind === "KindNewExpression") {
      const selected = resolveRustTargetTypeRef(origin, context, options);
      const definition = options.projectTypes.definitionForCarrier(selected);
      return selected !== undefined && rustTargetTypeRefEquals(selected, carrier) && definition?.kind === "class"
        ? orderEnumerableOwnStringProperties(expected, name => name)
        : undefined;
    }
    if (kind !== "KindObjectLiteralExpression") return undefined;
    const keys: string[] = [];
    const identities = new Set<string>();
    for (const element of ast.properties(origin)) {
      if (element === undefined) return undefined;
      const semantics = context.semanticsFor(element);
      const selected = semantics.operations.objectLiteralElement(element);
      if (selected === undefined || selected.objectLiteral !== origin || selected.element !== element ||
        selected.sourceElementSymbol === undefined) return undefined;
      const nameNode = ast.name(element);
      const selectedName = nameNode !== undefined && (ast.is.IsComputedPropertyName(nameNode) || ast.is.IsNumericLiteral(nameNode))
        ? semantics.propertyNames.get(nameNode) : undefined;
      const name = nameNode !== undefined && (ast.is.IsComputedPropertyName(nameNode) || ast.is.IsNumericLiteral(nameNode))
        ? selectedName?.kind === "resolved" ? selectedName.name : undefined : semantics.declarations.symbolName(selected.sourceElementSymbol);
      if (name === undefined || identities.has(name) || !expectedKeys.has(name)) return undefined;
      identities.add(name);
      keys.push(name);
    }
    return keys.length === expected.length ? orderEnumerableOwnStringProperties(keys, name => name) : undefined;
  }
  return undefined;
}
