import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { rustTypeOnlyDeclarationFactKey } from "../facts/type-only.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { rustSourceTypeDeclarations } from "../../policy/types/source-declarations.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";

export function recordRustInterfaceRepresentationAliases(
  walk: RustFactWalk,
  sourceFiles: readonly SourceFile[],
): void {
  const { ast, source, facts } = walk.context;
  const visiting = new Set<Node>();
  const visited = new Set<Node>();
  const rejected = new Set<Node>();
  for (const sourceFile of sourceFiles) {
    for (const declaration of rustSourceTypeDeclarations(sourceFile, ast)) visit(declaration);
  }

  function visit(declaration: Node): boolean {
    if (rejected.has(declaration)) return false;
    if (ast.kindName(declaration) !== "KindInterfaceDeclaration" || visited.has(declaration)) return true;
    if (visiting.has(declaration)) {
      rejected.add(declaration);
      appendRustDiagnostic(walk, "RUST_INTERFACE_REPRESENTATION_CYCLE",
        "Recursive interface facades require a closed recursive representation, not an erased native alias.", declaration, []);
      return false;
    }
    visiting.add(declaration);
    const accepted = classify(declaration);
    visiting.delete(declaration);
    visited.add(declaration);
    if (!accepted) rejected.add(declaration);
    return accepted;
  }

  function classify(declaration: Node): boolean {
    const semantics = walk.context.semanticsFor(declaration);
    const declaredType = semantics.declarations.declaredType(declaration);
    const symbol = declaredType === undefined ? undefined : semantics.declarations.typeSymbol(declaredType);
    const declarations = symbol === undefined ? undefined : semantics.declarations.symbolDeclarations(symbol);
    if (declaredType === undefined || declarations === undefined || declarations.length === 0 ||
      declarations.some(member => ast.kindName(member) !== "KindInterfaceDeclaration" || ast.members(member).length !== 0)) return true;
    const heritage = source.navigation.declaredHeritage(declaration);
    if (heritage.kind !== "resolved" || heritage.edges.length !== 1) return true;
    const edge = heritage.edges[0]!;
    if (edge.kind !== "extends" || !semantics.types.isIdentical(declaredType, edge.selectedType)) return true;
    if (edge.target.project) {
      if (!visit(edge.target.declaration)) return false;
      if (facts.getFact(edge.target.declaration, rustTypeOnlyDeclarationFactKey)?.reason !== "representation-alias") return true;
    }
    const initialCarrier = resolveRustTargetTypeRef(edge.selectedType, rustResolutionContext(walk, edge.heritage), walk.operationOptions);
    if (initialCarrier === undefined || rustSourceTypeCarrierValue(initialCarrier) !== undefined) return true;
    if (!visitCarrierDependencies(initialCarrier, new Set())) return false;
    const carrier = resolveRustTargetTypeRef(edge.selectedType, rustResolutionContext(walk, edge.heritage), walk.operationOptions);
    if (carrier === undefined || rustSourceTypeCarrierValue(carrier) !== undefined) return false;
    for (const merged of declarations) {
      if (!walk.sourceTypes.registerRepresentationAlias(merged, carrier) ||
        setCarrierFact(walk, merged, carrier) === undefined) {
        appendRustDiagnostic(walk, "RUST_INTERFACE_REPRESENTATION_CONFLICT",
          "Equivalent interface declarations require one exact selected base representation.", merged, []);
        return false;
      }
      facts.set(merged, rustTypeOnlyDeclarationFactKey, { reason: "representation-alias" });
    }
    return true;
  }

  function visitCarrierDependencies(carrier: TargetTypeRef, seen: Set<TargetTypeRef>): boolean {
    if (seen.has(carrier)) return true;
    seen.add(carrier);
    const declaration = walk.sourceTypes.declarationForCarrier(carrier);
    if (declaration !== undefined && !visit(declaration)) return false;
    return rustTargetTypeChildren(carrier).every(child => visitCarrierDependencies(child, seen));
  }
}
