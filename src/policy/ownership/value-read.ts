import type { RustValueReadOwnership } from "../../target-model/records/storage/ownership.js";

export function selectRustValueReadOwnership(input: {
  readonly copy: boolean;
  readonly clone: boolean;
  readonly transfer: boolean;
  readonly borrowed?: "shared" | "mutable";
}): RustValueReadOwnership | undefined {
  if (input.borrowed !== undefined) return Object.freeze({ kind: "borrow", mutable: input.borrowed === "mutable" });
  if (input.copy) return Object.freeze({ kind: "copy" });
  if (input.transfer) return Object.freeze({ kind: "move" });
  return input.clone ? Object.freeze({ kind: "clone" }) : undefined;
}
