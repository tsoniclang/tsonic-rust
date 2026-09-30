import type { SourcePrimitiveKind } from "@tsonic/tsts";

export interface RustIntegerRefinementConversion {
  readonly kind: "integer-refinement";
  readonly source: SourcePrimitiveKind;
  readonly target: SourcePrimitiveKind;
  readonly proof: "nonnegative";
}

export function rustUnsignedIntegerCounterpart(source: SourcePrimitiveKind): SourcePrimitiveKind | undefined {
  return unsignedKinds.get(source);
}

const unsignedKinds = new Map<SourcePrimitiveKind, SourcePrimitiveKind>([
  ["int8", "uint8"], ["int16", "uint16"], ["int32", "uint32"],
  ["int64", "uint64"], ["int128", "uint128"], ["native-int", "native-uint"],
]);
