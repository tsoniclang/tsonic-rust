import type { Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./resolution/model.js";
import { resolveOwnedSourceProfileTypeName } from "./resolution/providers.js";
import { rustJsArrayTargetType, rustJsValueTargetType } from "../../target-model/types/index.js";

export function selectRustClosedArrayView(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const semantics = context.currentSemantics;
  if (!options.jsEnabled || !semantics.types.isTypeReference(type)) return undefined;
  const name = resolveOwnedSourceProfileTypeName(semantics.declarations.typeSymbol(type), context, options.sourceProfiles);
  if (name !== "Array" && name !== "ReadonlyArray") return undefined;
  const arguments_ = semantics.types.typeArguments(type);
  if (arguments_.length !== 1 || arguments_[0] === undefined ||
    (!semantics.types.isAny(arguments_[0]) && !semantics.types.isUnknown(arguments_[0]))) return undefined;
  return rustJsArrayTargetType(rustJsValueTargetType());
}
