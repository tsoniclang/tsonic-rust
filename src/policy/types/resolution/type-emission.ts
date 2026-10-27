import type { RustTypePositionInput } from "../../model/type-emission.js";
import type { RustTypePositions } from "../../../target-model/records/types/type-emission.js";

export function selectRustTypePositions(input: RustTypePositionInput): RustTypePositions {
  const opaque = input.opaque !== "none" || input.children.some(child => child.opaque);
  if (!opaque) return Object.freeze({ opaque, general: true, parameter: true, return: true });
  if (input.opaque === "explicit" || input.opaque === "input") return Object.freeze({ opaque, general: false,
    parameter: input.boundPositions.parameter && !input.capturesOpaque,
    return: input.boundPositions.return && !input.capturesOpaque });
  if (input.opaque === "callable") {
    const valid = input.children.every(child => !child.opaque);
    return Object.freeze({ opaque, general: false, parameter: valid, return: valid });
  }
  return Object.freeze({ opaque, general: false,
    parameter: input.nested && input.children.every(child => child.parameter),
    return: input.nested && input.children.every(child => child.return) });
}
