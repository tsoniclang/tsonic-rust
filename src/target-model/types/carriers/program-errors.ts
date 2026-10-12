import { hasExactObjectKeys, isClosedMetadata } from "../../metadata/closed-data.js";
import type { RustProgramErrorOwner, TargetTypeRef } from "../model.js";
import { rustProgramErrorTargetId } from "./source-types.js";

export function isRustProgramErrorOwner(value: unknown): value is RustProgramErrorOwner {
  if (!isClosedMetadata(value) || value === null || typeof value !== "object") return false;
  const owner = value as Partial<RustProgramErrorOwner>;
  if (owner.kind === "logical") return hasExactObjectKeys(owner, ["kind"]);
  if (owner.kind !== "physical") return false;
  return owner.domain === "runtime" ? hasExactObjectKeys(owner, ["kind", "domain"])
    : owner.domain === "project" && hasExactObjectKeys(owner, ["kind", "domain", "componentId"]) &&
      typeof owner.componentId === "string" && owner.componentId.length > 0;
}

export function rustProgramErrorOwner(carrier: TargetTypeRef | undefined): RustProgramErrorOwner | undefined {
  return isClosedMetadata(carrier) && carrier?.kind === "target-named" && carrier.id === rustProgramErrorTargetId &&
    (carrier.genericArguments === undefined || carrier.genericArguments.length === 0) &&
    isRustProgramErrorOwner(carrier.errorOwner) ? carrier.errorOwner : undefined;
}
