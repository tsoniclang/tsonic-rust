import type { RustJsRejectionConversion, RustJsRejectionRegion, RustPhysicalErrorOwner } from "../../../target-model/records/errors/error-regions.js";
import { rustJsValueTargetType, rustProgramErrorTargetType, isRustNeverCarrier } from "../../../target-model/types/carriers/js.js";
import { rustProgramErrorOwner } from "../../../target-model/types/carriers/program-errors.js";
import { rustInfallibleTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustNativeErrorJoinReference, type RustNativeErrorSource } from "../../../target-model/types/native-error-joins.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function selectRustJsRejectionRegion(
  owner: RustPhysicalErrorOwner | undefined,
  sources: readonly RustNativeErrorSource<TargetTypeRef>[],
): RustJsRejectionRegion | undefined {
  const requiredCarriers: TargetTypeRef[] = [];
  let remaining = 4096;
  const select = (carrier: TargetTypeRef, depth = 0): RustJsRejectionConversion | undefined => {
    if (--remaining < 0 || depth > 128) return undefined;
    if (rustTargetTypeRefEquals(carrier, rustJsValueTargetType())) return Object.freeze({ kind: "identity", carrier });
    if (isRustNeverCarrier(carrier) || carrier.kind === "target-named" && carrier.id === rustInfallibleTargetId)
      return Object.freeze({ kind: "uninhabited", carrier });
    const program = rustProgramErrorOwner(carrier);
    if (program?.kind === "logical") return undefined;
    if (program?.domain === "project") return Object.freeze({ kind: "program-error", carrier, owner: program });
    const joined = rustNativeErrorJoinReference(carrier);
    if (joined !== undefined) {
      const arms = joined.errors.map(error => select(error, depth + 1));
      return arms.some(arm => arm === undefined) ? undefined : Object.freeze({ kind: "native-join", carrier,
        arms: Object.freeze(arms as RustJsRejectionConversion[]) });
    }
    if (!requiredCarriers.some(previous => rustTargetTypeRefEquals(previous, carrier))) requiredCarriers.push(carrier);
    return Object.freeze({ kind: "retained-error", carrier });
  };
  const local = owner === undefined ? undefined : select(rustProgramErrorTargetType(owner));
  if (owner !== undefined && local === undefined) return undefined;
  const selected = sources.map(source => {
    const conversion = select(source.errorType);
    return conversion === undefined ? undefined : Object.freeze({ identity: source.identity, conversion });
  });
  if (selected.some(source => source === undefined)) return undefined;
  return Object.freeze({ local, sources: Object.freeze(selected as NonNullable<typeof selected[number]>[]),
    requiredCarriers: Object.freeze(requiredCarriers) });
}
