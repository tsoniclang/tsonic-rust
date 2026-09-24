import type { Type } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext } from "./model.js";

export function rustSourceSelectionUsesExactBindings(
  authored: Type,
  selected: Type,
  context: RustTargetTypeResolutionContext,
): boolean {
  if ((context.sourceTypeParameterSubstitutions?.size ?? 0) === 0) return false;
  const { types, declarations } = context.currentSemantics;
  const active = new Map<Type, Set<Type>>();
  const match = (left: Type, right: Type): "bound" | "identity" | undefined => {
    const symbol = declarations.typeSymbol(left);
    const declaration = symbol === undefined ? undefined : declarations.primarySymbolDeclaration(symbol);
    const binding = declaration === undefined ? undefined : context.sourceTypeParameterSubstitutions?.get(declaration);
    if (binding !== undefined) {
      return types.isIdentical(left, right) || types.isIdentical(binding.sourceType, right) ? "bound" : undefined;
    }
    if (active.get(left)?.has(right)) return undefined;
    const pairs = active.get(left) ?? new Set<Type>();
    active.set(left, pairs);
    pairs.add(right);
    try {
      const leftAlias = types.aliasApplication(left);
      const rightAlias = types.aliasApplication(right);
      if (leftAlias !== undefined && rightAlias !== undefined && leftAlias.declaration === rightAlias.declaration) {
        if (leftAlias.bindings.length !== rightAlias.bindings.length) return undefined;
        const results = leftAlias.bindings.map((argument, index) => {
          const other = rightAlias.bindings[index]!;
          return argument.declaration === other.declaration ? match(argument.argument, other.argument) : undefined;
        });
        return combine(results);
      }
      const leftTarget = types.isTypeReference(left) ? types.typeReferenceTarget(left) : undefined;
      const rightTarget = types.isTypeReference(right) ? types.typeReferenceTarget(right) : undefined;
      const leftSymbol = leftTarget === undefined ? undefined : declarations.typeSymbol(leftTarget);
      const rightSymbol = rightTarget === undefined ? undefined : declarations.typeSymbol(rightTarget);
      const leftDeclaration = leftSymbol === undefined ? undefined : declarations.primarySymbolDeclaration(leftSymbol);
      const rightDeclaration = rightSymbol === undefined ? undefined : declarations.primarySymbolDeclaration(rightSymbol);
      if (leftTarget !== undefined && rightTarget !== undefined &&
        (leftTarget === rightTarget || leftDeclaration !== undefined && leftDeclaration === rightDeclaration)) {
        const leftArguments = types.typeArguments(left);
        const rightArguments = types.typeArguments(right);
        return leftArguments.length === rightArguments.length
          ? combine(leftArguments.map((argument, index) => match(argument, rightArguments[index]!)))
          : undefined;
      }
      if (leftTarget !== undefined || rightTarget !== undefined) return undefined;
      if (types.isUnion(left) && types.isUnion(right)) {
        const leftMembers = types.unionOrIntersectionTypes(left);
        const remaining = new Set(types.unionOrIntersectionTypes(right));
        if (leftMembers.length !== remaining.size) return undefined;
        const results: ("bound" | "identity")[] = [];
        for (const member of leftMembers) {
          const candidates = [...remaining].flatMap(other => {
            const result = match(member, other);
            return result === undefined ? [] : [{ other, result }];
          });
          if (candidates.length !== 1) return undefined;
          remaining.delete(candidates[0]!.other);
          results.push(candidates[0]!.result);
        }
        return combine(results);
      }
      if (types.couldContainTypeVariables(left) || types.couldContainTypeVariables(right)) return undefined;
      return types.isIdentical(left, right) ? "identity" : undefined;
    } finally {
      pairs.delete(right);
      if (pairs.size === 0) active.delete(left);
    }
  };
  return match(authored, selected) === "bound";
}

function combine(results: readonly ("bound" | "identity" | undefined)[]): "bound" | "identity" | undefined {
  return results.some(result => result === undefined) ? undefined
    : results.includes("bound") ? "bound" : "identity";
}
