import type { Node, Type, TypeIndexInfo, TypeIndexedAccessSelection } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import { resolveSelectedSourceProfileIndexMembers } from "../../../policy/evidence/selected-source.js";
import { selectRustGuardedSourceValueTypes } from "../native-flow-refinement.js";

export function selectRustSourceProfileIndexMembers(
  request: {
    readonly expression: Node;
    readonly receiver: Node;
    readonly sourceReceiverType?: Type;
    readonly sourceArgumentType?: Type;
  },
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  selectedIndex?: TypeIndexedAccessSelection,
) {
  if (request.sourceReceiverType === undefined || request.sourceArgumentType === undefined) return undefined;
  const types = selectRustGuardedSourceValueTypes(request.receiver, request.sourceReceiverType, context, options) ??
    [request.sourceReceiverType];
  if (types.length === 0) return undefined;
  const indexes: TypeIndexInfo[] = [];
  for (const type of types) {
    const selected = type === request.sourceReceiverType && selectedIndex !== undefined ? selectedIndex :
      context.semanticsFor(request.expression).types.selectIndexedAccess(type, request.sourceArgumentType);
    if (selected?.kind !== "resolved" || selected.members.length !== 1 || selected.members[0]?.kind !== "index") return undefined;
    indexes.push(selected.members[0].index);
  }
  const selected = resolveSelectedSourceProfileIndexMembers(context, indexes, options.sourceProfiles);
  return selected === undefined ? undefined : { ...selected, readonly: indexes.some(index => index.readonly) };
}
