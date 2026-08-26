import type { RustNamedTypeCarrierValue } from "../../../target-model/types/index.js";
import { rustTargetGenericArgumentEquals } from "../../../target-model/types/equality.js";

export function rustExplicitNamedTypeArguments(
  namedType: RustNamedTypeCarrierValue,
): RustNamedTypeCarrierValue["genericArguments"] {
  let argumentCount = namedType.genericArguments.length;
  const defaultOffset = argumentCount - namedType.genericDefaults.length;
  while (argumentCount > defaultOffset) {
    const argumentIndex = argumentCount - 1;
    const defaultIndex = argumentIndex - defaultOffset;
    if (!rustTargetGenericArgumentEquals(
      namedType.genericArguments[argumentIndex],
      namedType.genericDefaults[defaultIndex],
    )) {
      break;
    }
    argumentCount -= 1;
  }
  return namedType.genericArguments.slice(0, argumentCount);
}
