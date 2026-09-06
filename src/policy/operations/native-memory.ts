import type { AstReader, ExtensionFactSubject, ReadonlySourceFactResolver } from "@tsonic/tsts";
import { selectTsonicRawLocationOperation } from "@tsonic/source-core/facts";
import type { TsonicMemoryLayoutFact, TsonicRawLocationSelection } from "@tsonic/source-core/facts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustNativeMemoryLayout } from "../../target-model/operations/native-memory.js";

export function readRustRawLocation(ast: AstReader, facts: ReadonlySourceFactResolver, subject: ExtensionFactSubject): TsonicRawLocationSelection | undefined {
  return selectTsonicRawLocationOperation(ast, facts, subject);
}

export function selectRustNativeMemoryLayout(
  pointeeCarrier: TargetTypeRef | undefined, layout: TsonicMemoryLayoutFact,
): RustNativeMemoryLayout | undefined {
  if (pointeeCarrier?.kind !== "source-primitive" || layout.fields.length !== 0) return undefined;
  const sizes: Readonly<Partial<Record<string, number>>> = {
    int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4,
    int64: 8, uint64: 8, int128: 16, uint128: 16, float32: 4, float64: 8,
    "native-int": layout.dataLayout.addressWidth / 8, "native-uint": layout.dataLayout.addressWidth / 8,
  };
  if (sizes[pointeeCarrier.name] !== layout.byteSize) return undefined;
  return Object.freeze({ pointeeCarrier, size: layout.byteSize, alignment: layout.byteAlignment,
    width: layout.dataLayout.addressWidth, littleEndian: layout.dataLayout.byteOrder === "little" });
}
