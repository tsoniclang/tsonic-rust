import type { TargetTypeRef } from "../model.js";
import { rustTypeGenericArguments } from "../generic-arguments.js";
import { rustJsPromiseResolutionTargetId, rustProgramErrorTargetId } from "./source-types.js";

export function rustJsPromiseResolutionTargetType(output: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsPromiseResolutionTargetId,
    genericArguments: rustTypeGenericArguments([output, { kind: "target-named", id: rustProgramErrorTargetId }]) };
}
