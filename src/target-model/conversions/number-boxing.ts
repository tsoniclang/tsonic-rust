import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type { RustValueConversionId } from "../operations/model.js";

const rows: readonly (readonly [SourcePrimitiveKind, RustValueConversionId])[] = [
  ["int8", "js-value-from-i8"],
  ["uint8", "js-value-from-u8"],
  ["int16", "js-value-from-i16"],
  ["uint16", "js-value-from-u16"],
  ["int32", "js-value-from-i32"],
  ["uint32", "js-value-from-u32"],
  ["int64", "js-value-from-i64"],
  ["uint64", "js-value-from-u64"],
  ["native-int", "js-value-from-isize"],
  ["native-uint", "js-value-from-usize"],
  ["float32", "js-value-from-f32"],
  ["float64", "js-value-from-f64"],
];

const bySource = new Map(rows);
const byId = new Map(rows.map(([source, id]) => [id, source]));

export function rustNumberBoxingConversionId(
  source: SourcePrimitiveKind,
): RustValueConversionId | undefined {
  return bySource.get(source);
}

export function rustNumberBoxingSourceKind(
  id: RustValueConversionId,
): SourcePrimitiveKind | undefined {
  return byId.get(id);
}
