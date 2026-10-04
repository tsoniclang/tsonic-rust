import type { TargetTypeRef } from "../types/model.js";
import type { RustTypeDefinitions } from "../types/source-union-definitions.js";
import { rustUnionPathsMatching, type RustUnionLeaf } from "../types/union-relations.js";
import { rustNativeRepresentationMatches } from "./native-representation.js";
import { isRustJsValueCarrier } from "../types/carriers/js.js";
import { rustTsValueTargetId } from "../types/carriers/source-types.js";
import { rustTsValueAdmission } from "../types/carriers/traits.js";
import { selectRustProgramErrorConversion } from "./program-error.js";

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
  const native = paths.filter(leaf => rustNativeRepresentationMatches(source, leaf.carrier) ||
    selectRustProgramErrorConversion(source, leaf.carrier, definitions) !== undefined);
  const admitted = native.length > 0 ? native : paths;
  return admitted.length === 1 && admitted[0]!.path.every(step => step.variant.kind === "payload")
    ? admitted[0] : undefined;
}
