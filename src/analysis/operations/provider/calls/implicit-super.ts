import type { Node } from "@tsonic/tsts";
import type { RustCheckedCallSelectionInput, RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "../model.js";
import { selectedProjectConstructor } from "./instantiation.js";

export function selectedImplicitSuperConstructorClass(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): Node | undefined {
  if (context.ast.kindName(request.source.sourceCallee.expression) !== "KindSuperKeyword") {
    return undefined;
  }
  const containing = options.projectTypes.definitionContainingDeclaration(request.source.call);
  if (containing?.kind !== "class") {
    return undefined;
  }
  const semantics = context.source.semantics.forNode(request.source.call);
  const resultType = semantics.types.returnType(request.source.selectedSignature);
  const resultSymbol = resultType === undefined ? undefined : semantics.declarations.typeSymbol(resultType);
  const declarations = resultSymbol === undefined ? [] : semantics.declarations.symbolDeclarations(resultSymbol);
  const matches = options.projectTypes.heritageForDefinition(containing).filter((edge) =>
    edge.kind === "extends" && edge.target.kind === "class" &&
    declarations.includes(edge.target.declaration) &&
    selectedProjectConstructor(edge.target, request, options) !== undefined);
  return matches.length === 1 ? matches[0]!.target.declaration : undefined;
}
