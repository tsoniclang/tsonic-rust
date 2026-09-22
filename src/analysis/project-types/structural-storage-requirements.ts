import type { Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustProjectTypePolicy } from "./type-policy.js";

export function createRustStructuralStorageCollector(
  context: RustAnalysisContext,
  projectTypes: RustProjectTypePolicy,
  references: Set<Node>,
  mutableMembers: Set<Node>,
): (node: Node) => void {
  const collectPair = (source: Type, target: Type, semantics: SourceFileSemantics): void => {
    const symbol = semantics.declarations.typeSymbol(source);
    const definitions = symbol === undefined ? [] : semantics.declarations.symbolDeclarations(symbol)
      .map(declaration => projectTypes.definitionForDeclaration(declaration))
      .filter(definition => definition?.kind === "class");
    if (definitions.length !== 1) return;
    const sourceConstructs = semantics.types.constructSignatures(source);
    const targetConstructs = semantics.types.constructSignatures(target);
    if (sourceConstructs.length === 1 && targetConstructs.length === 1) {
      const sourceInstance = semantics.types.returnType(sourceConstructs[0]!);
      const targetInstance = semantics.types.returnType(targetConstructs[0]!);
      if (sourceInstance !== undefined && targetInstance !== undefined) collectPair(sourceInstance, targetInstance, semantics);
      return;
    }
    if (sourceConstructs.length !== 0 || targetConstructs.length !== 0) return;
    const targetSymbol = semantics.declarations.typeSymbol(target);
    const targetDeclarations = targetSymbol === undefined ? [] : semantics.declarations.symbolDeclarations(targetSymbol);
    if (targetDeclarations.some(declaration => projectTypes.definitionForDeclaration(declaration)?.kind === "class")) return;
    const correspondence = semantics.types.structuralMembers(source, target);
    if (correspondence.kind !== "available" || correspondence.destination.calls.length !== 0 ||
      correspondence.destination.constructs.length !== 0 || correspondence.destination.indexes.length !== 0) return;
    references.add(definitions[0]!.declaration);
    for (const pair of correspondence.members) {
      if (pair.kind !== "present" || pair.destination.property.readonly) continue;
      for (const declaration of pair.source.declarations) {
        if (context.ast.is.IsPropertyDeclaration(declaration) || context.ast.is.IsParameterDeclaration(declaration)) mutableMembers.add(declaration);
      }
    }
  };
  return node => {
    const kind = context.ast.kindName(node);
    if (kind !== "KindIdentifier" && kind !== "KindNewExpression" && kind !== "KindCallExpression" &&
      kind !== "KindClassExpression" && kind !== "KindPropertyAccessExpression" && kind !== "KindElementAccessExpression" &&
      kind !== "KindThisKeyword" && kind !== "KindConditionalExpression") return;
    const semantics = context.semanticsFor(node);
    const contextual = semantics.types.contextualValueSelection(node);
    if (contextual.kind !== "selected") return;
    const source = semantics.types.expressionType(node);
    if (source !== undefined) collectPair(source, contextual.type, semantics);
  };
}
