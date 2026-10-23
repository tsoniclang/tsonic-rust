import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeChildren, type RustTargetTypeChildSelector } from "../../../target-model/types/carriers/children.js";

export const rustOwnedStorageChild: RustTargetTypeChildSelector = (_parent, _child, role) =>
  role.kind === "component" || role.kind === "structural-implementation" || role.structural.construction === undefined ||
    role.kind === "structural-field" && role.structural.fields[role.index]?.method !== true;

export function rustOwnedStorageChildren(type: TargetTypeRef): readonly TargetTypeRef[] {
  return rustTargetTypeChildren(type, rustOwnedStorageChild);
}
