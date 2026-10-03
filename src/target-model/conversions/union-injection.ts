import type { TargetTypeRef } from "../types/model.js";
import type { RustTypeDefinitions } from "../types/source-union-definitions.js";
import { rustUnionPathsMatching, type RustUnionLeaf } from "../types/union-relations.js";
import { rustNativeRepresentationMatches } from "./native-representation.js";

export function rustUnionPayloadAdmission(
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions,
): RustUnionLeaf | undefined {
  const paths = rustUnionPathsMatching(target, definitions,
    carrier => rustNativeRepresentationMatches(source, carrier));
  return paths?.length === 1 && paths[0]!.path.every(step => step.variant.kind === "payload")
    ? paths[0] : undefined;
}
