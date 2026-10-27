import type { Node } from "@tsonic/tsts";
import type { RustProjectFieldDispatchPlan } from "../../../target-model/records/storage/field-writes.js";

export function selectRustProjectFieldDispatch(input: {
  readonly declaration: Node;
  readonly readonly: boolean;
  readonly receiverAlias: boolean;
  readonly receiverAliasRead: boolean;
  readonly accessorRead: boolean;
  readonly accessorWrite: boolean;
  readonly mutableContent: boolean;
  readonly frozenWrite: boolean;
}): RustProjectFieldDispatchPlan {
  return Object.freeze({
    declaration: input.declaration,
    readonly: input.readonly,
    stored: !input.receiverAlias && !input.accessorRead && !input.accessorWrite,
    mutableContent: input.mutableContent,
    read: Object.freeze({
      selfMode: input.accessorRead || input.receiverAlias || input.receiverAliasRead ? "rc" : "ref",
      fallible: input.accessorRead,
    }),
    ...(input.readonly ? {} : { write: Object.freeze({
      selfMode: input.accessorWrite ? "rc" as const : "ref" as const,
      fallible: input.accessorWrite || input.frozenWrite,
    }) }),
  });
}
