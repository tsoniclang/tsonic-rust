import type { Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSourcePolicyContext } from "../../model/context.js";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustSourceProfileRegistry } from "../model/source-profile.js";
import { resolveOwnedSourceProfileTypeName } from "../../identities/source-types.js";
import { rustJsArrayValueTargetType } from "../../../target-model/types/index.js";

export function selectRustClosedArrayView(
  type: Type,
  context: Pick<RustSourcePolicyContext, "ast"> & { readonly currentSemantics: SourceFileSemantics },
  options: { readonly jsEnabled: boolean; readonly sourceProfiles: RustSourceProfileRegistry },
): TargetTypeRef | undefined {
  const semantics = context.currentSemantics;
  if (!options.jsEnabled || !semantics.types.isTypeReference(type)) return undefined;
  const name = resolveOwnedSourceProfileTypeName(semantics.declarations.typeSymbol(type), context, options.sourceProfiles);
  if (name !== "Array" && name !== "ReadonlyArray") return undefined;
  const arguments_ = semantics.types.typeArguments(type);
  if (arguments_.length !== 1 || arguments_[0] === undefined ||
    (!semantics.types.isAny(arguments_[0]) && !semantics.types.isUnknown(arguments_[0]))) return undefined;
  return rustJsArrayValueTargetType();
}
