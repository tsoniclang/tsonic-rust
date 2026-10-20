import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";

import { resolveRustTargetTypeRef } from "../types/resolution/index.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { sourceCallableInterface, sourceInterfaceRepresentationBase } from "@tsonic/target-api/source";

export function recordRustInterfaceRepresentationAliases(
  walk: RustFactWalk,
  sourceFiles: readonly SourceFile[],
): void {
  walk.context.records.typeOnlyDeclarations.representationAliases(walk, sourceFiles);
}

export interface RustInterfaceRepresentationAliasSelection {
  readonly declarations: readonly Node[];
  readonly registrationCarrier?: TargetTypeRef;
}

export function selectRustInterfaceRepresentationAlias(
  walk: RustFactWalk, declaration: Node, visit: (declaration: Node) => boolean,
): RustInterfaceRepresentationAliasSelection | false | undefined {
  const { ast, source, records } = walk.context;
  const semantics = walk.context.semanticsFor(declaration);
  const declaredType = semantics.declarations.declaredType(declaration);
  const symbol = declaredType === undefined ? undefined : semantics.declarations.typeSymbol(declaredType);
  const declarations = symbol === undefined ? undefined : semantics.declarations.symbolDeclarations(symbol);
  const callable = sourceCallableInterface(declaredType, semantics, ast);
  if (callable !== undefined && declarations !== undefined) return { declarations };
  if (declaredType !== undefined && declarations !== undefined && declarations.length > 0 &&
    declarations.every(member => ast.kindName(member) === "KindInterfaceDeclaration") &&
    semantics.types.constructSignatures(declaredType).length !== 0) {
    const carrier = resolveRustTargetTypeRef(declaredType,
      { ...rustResolutionContext(walk, declaration), callableRepresentation: "signature" }, walk.operationOptions);
    if (carrier === undefined || rustSourceTypeCarrierValue(carrier) !== undefined) {
      appendRustDiagnostic(walk, "RUST_CONSTRUCTOR_INTERFACE_NOT_CLOSED",
        "An interface representation requires its complete checked callable, construction and member contract.", declaration, []);
      return false;
    }
    return { declarations, registrationCarrier: carrier };
  }
  const edge = sourceInterfaceRepresentationBase(declaration, ast, source.navigation, semantics);
  if (edge === undefined || declarations === undefined) return undefined;
  if (edge.target.project) {
    if (!visit(edge.target.declaration)) return false;
    if (records.typeOnlyDeclaration.get(edge.target.declaration)?.reason !== "representation-alias") return undefined;
  }
  const logicalContext = { ...rustResolutionContext(walk, edge.heritage), callableRepresentation: "signature" as const };
  const initialCarrier = resolveRustTargetTypeRef(edge.selectedType, logicalContext, walk.operationOptions);
  if (initialCarrier === undefined || rustSourceTypeCarrierValue(initialCarrier) !== undefined) return undefined;
  if (!visitCarrierDependencies(initialCarrier, new Set())) return false;
  const carrier = resolveRustTargetTypeRef(edge.selectedType, logicalContext, walk.operationOptions);
  if (carrier === undefined || rustSourceTypeCarrierValue(carrier) !== undefined) return false;
  return { declarations };

  function visitCarrierDependencies(carrier: TargetTypeRef, seen: Set<TargetTypeRef>): boolean {
    if (seen.has(carrier)) return true;
    seen.add(carrier);
    const declaration = walk.sourceTypes.declarationForCarrier(carrier);
    if (declaration !== undefined && !visit(declaration)) return false;
    return rustTargetTypeChildren(carrier).every(child => visitCarrierDependencies(child, seen));
  }
}
