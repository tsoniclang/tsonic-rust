import { rustOnlyTypeGenericArguments, rustTypeGenericArguments } from "../generic-arguments.js";
import { rustOptionTargetType } from "./optional.js";
import type { TargetTypeRef } from "../model.js";

export const rustJsArrayEntriesTargetId = "rust.js.JsArrayEntries";

export function rustJsArrayEntriesTargetType(element: TargetTypeRef): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustJsArrayEntriesTargetId,
    genericArguments: rustTypeGenericArguments([element]),
  };
}

export function rustJsArrayEntriesElementTargetType(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustJsArrayEntriesTargetId) return undefined;
  const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
  return arguments_?.length === 1 ? arguments_[0] : undefined;
}

export function rustJsArrayEntryTargetType(element: TargetTypeRef): TargetTypeRef {
  return {
    kind: "tuple",
    elements: [{ kind: "source-primitive", name: "float64" }, rustOptionTargetType(element)],
  };
}
