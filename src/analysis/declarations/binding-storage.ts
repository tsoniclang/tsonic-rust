import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { Node_Type, sourceBindingCapturedBeforeInitialization } from "@tsonic/target-api/source";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../types/resolution/source.js";
import { closeRustSuspendedStorage } from "../../policy/types/storage/suspended-storage.js";
import { resolveTypeNodeCarrier } from "../types/source-carriers.js";

export function resolveRustDeclaredBindingStorage(
  walk: RustFactWalk,
  declaration: Node,
): TargetTypeRef | undefined {
  const context = rustResolutionContext(walk, declaration);
  const authored = Node_Type(walk.context.ast, declaration);
  const finalized = authored === undefined
    ? walk.context.records.runtimeCarrier.get(declaration)
    : undefined;
  if (finalized !== undefined) return finalized.carrier;
  const selected = authored === undefined && sourceBindingCapturedBeforeInitialization(
    declaration, walk.context.ast, walk.context.source.navigation,
  ) ? context.currentSemantics.declarations.declaredValueType(declaration) : undefined;
  const carrier = authored === undefined ? resolveRustTargetTypeRef(selected, context, walk.operationOptions)
    : resolveTypeNodeCarrier(walk, authored);
  return carrier === undefined ? undefined : closeRustSuspendedStorage(carrier, "field");
}
