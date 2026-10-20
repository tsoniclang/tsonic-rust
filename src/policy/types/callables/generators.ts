import { rustBorrowedAsyncGeneratorTargetId, rustBorrowedGeneratorTargetId } from "../../../target-model/types/carriers/source-types.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustLifetimeGenericArgument, rustTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";
import { type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";

import { rustGeneratorTargetType, rustAsyncGeneratorTargetType, type RustGeneratorProtocol } from "../../../target-model/types/carriers/callables.js";
export function rustGeneratorStorageTargetType(
  protocol: RustGeneratorProtocol,
  lifetime: RustLifetimeRef | undefined,
): TargetTypeRef {
  if (lifetime === undefined) {
    return protocol.kind === "sync"
      ? rustGeneratorTargetType(protocol)
      : rustAsyncGeneratorTargetType(protocol);
  }
  return {
    kind: "target-named",
    id: protocol.kind === "sync"
      ? rustBorrowedGeneratorTargetId
      : rustBorrowedAsyncGeneratorTargetId,
    genericArguments: Object.freeze([
      rustLifetimeGenericArgument(lifetime),
      ...rustTypeGenericArguments([
        protocol.yieldType,
        protocol.returnType,
        protocol.nextType,
      ]),
    ]),
  };
}
