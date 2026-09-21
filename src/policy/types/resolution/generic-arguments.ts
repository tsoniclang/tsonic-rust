import type { Type } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext } from "./model.js";

export function selectedRustSourceTypeArgument(type: Type, context: RustTargetTypeResolutionContext): Type {
  const symbol = context.currentSemantics.declarations.typeSymbol(type);
  const declaration = symbol === undefined ? undefined : context.currentSemantics.declarations.primarySymbolDeclaration(symbol);
  return declaration === undefined || context.ast.kindName(declaration) !== "KindTypeParameter"
    ? type : context.sourceTypeParameterSubstitutions?.get(declaration)?.sourceType ?? type;
}
