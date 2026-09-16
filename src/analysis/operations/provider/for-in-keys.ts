import type { Node } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer, orderEnumerableOwnStringProperties } from "@tsonic/target-api/source";
import type { RustOperationPolicyContext } from "../../../policy/operations/contracts.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustOperationsProviderOptions } from "./model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";

export function selectedRustForInKeys(
  expression: Node,
  carrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly string[] | undefined {
  const { ast } = context;
  const expected = options.sourceTypes.propertyKeysForCarrier(carrier, ast);
  if (expected === undefined) return undefined;
  const expectedKeys = new Set(expected);
  const visited = new Set<Node>();
  let origin: Node | undefined = expression;
  while (origin !== undefined && visited.size < 256 && !visited.has(origin)) {
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
      const name = semantics.declarations.symbolName(selected.sourceElementSymbol);
      if (name.length === 0 || identities.has(name) || !expectedKeys.has(name)) return undefined;
      identities.add(name);
      keys.push(name);
    }
    return keys.length === expected.length ? orderEnumerableOwnStringProperties(keys, name => name) : undefined;
  }
  return undefined;
}
