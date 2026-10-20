import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustUnionPathsMatching, type RustUnionLeaf } from "../../target-model/types/union-relations.js";
import { rustNativeRepresentationMatches } from "./native-representation.js";
import { isRustJsValueCarrier } from "../../target-model/types/carriers/js.js";
import { rustTsValueTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustTsValueAdmission } from "../../target-model/types/carriers/traits.js";
import { selectRustProgramErrorConversion } from "../../target-model/conversions/program-error.js";

export function rustUnionPayloadAdmission(
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions,
): RustUnionLeaf | undefined {
  let broadAdmission: boolean | undefined;
  const paths = rustUnionPathsMatching(target, definitions, carrier =>
    rustNativeRepresentationMatches(source, carrier) || selectRustProgramErrorConversion(source, carrier, definitions) !== undefined ||
    (isRustJsValueCarrier(carrier) || carrier.kind === "target-named" && carrier.id === rustTsValueTargetId) &&
    (broadAdmission ??= rustTsValueAdmission(source, definitions) !== undefined));
  if (paths === undefined) return undefined;
  const native = paths.filter(leaf => rustNativeRepresentationMatches(source, leaf.carrier));
  const converted = native.length > 0 ? [] : paths.filter(leaf =>
    selectRustProgramErrorConversion(source, leaf.carrier, definitions) !== undefined);
  const admitted = native.length > 0 ? native : converted.length > 0 ? converted : paths;
  return admitted.length === 1 && admitted[0]!.path.every(step => step.variant.kind === "payload")
    ? admitted[0] : undefined;
}
