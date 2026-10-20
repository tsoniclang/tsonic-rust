import { appendMalformedSourceAst } from "../declarations/project-types.js";

import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";

import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";

export function requireDenseSourceNodes(
  walk: RustFactWalk,
  values: readonly (Node | undefined)[] | undefined,
  message: string,
): readonly Node[] | undefined {
  if (values === undefined || !isDenseDataArray(values) ||
    values.some((value) => value === undefined)) {
    appendMalformedSourceAst(walk, message);
    return undefined;
  }
  return values as readonly Node[];
}
