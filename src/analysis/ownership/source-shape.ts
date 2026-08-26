import type { Node } from "@tsonic/tsts";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";

export class RustOwnershipSourceShapeError extends Error {
  constructor(
    message: string,
    readonly node?: Node,
  ) {
    super(message);
  }
}

export function requireDenseRustOwnershipNodes(
  values: readonly (Node | undefined)[] | undefined,
  message: string,
  owner?: Node,
): readonly Node[] {
  if (!isDenseDataArray(values) || values.some((value) => value === undefined)) {
    throw new RustOwnershipSourceShapeError(message, owner);
  }
  return values as readonly Node[];
}
