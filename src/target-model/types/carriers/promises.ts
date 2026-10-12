import type { TargetTypeRef } from "../model.js";
import { rustTypeGenericArguments } from "../generic-arguments.js";
import { rustJsPromiseResolutionTargetId } from "./source-types.js";
import { rustProgramErrorTargetType } from "./js.js";

export function rustJsPromiseResolutionTargetType(output: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsPromiseResolutionTargetId,
    genericArguments: rustTypeGenericArguments([output, rustProgramErrorTargetType()]) };
}
