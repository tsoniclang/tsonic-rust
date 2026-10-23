import { rustAsyncGeneratorTargetId, rustGeneratorTargetId, rustBorrowedAsyncGeneratorTargetId, rustBorrowedGeneratorTargetId } from "../../../target-model/types/carriers/source-types.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustLifetimeGenericArgument, rustTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";
import { type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";

import type { RustGeneratorProtocol } from "../../../target-model/types/carriers/callables.js";
export function rustGeneratorStorageTargetType(
  protocol: Pick<RustGeneratorProtocol, "kind" | "yieldType" | "returnType" | "nextType">,
  lifetime: RustLifetimeRef | undefined,
  errorCarrier: TargetTypeRef,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: lifetime === undefined
      ? protocol.kind === "sync" ? rustGeneratorTargetId : rustAsyncGeneratorTargetId
      : protocol.kind === "sync" ? rustBorrowedGeneratorTargetId : rustBorrowedAsyncGeneratorTargetId,
    genericArguments: Object.freeze([
      ...(lifetime === undefined ? [] : [rustLifetimeGenericArgument(lifetime)]),
      ...rustTypeGenericArguments([
        protocol.yieldType,
        protocol.returnType,
        protocol.nextType,
        errorCarrier,
      ]),
    ]),
  };
}
