import type { Node, Type, TypeIndexedAccessSelection } from "@tsonic/tsts";
import { selectedSourceIndexedDeclarations } from "@tsonic/target-api/source";
import type { RustOperationPolicyContext } from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import { resolveSelectedSourceProfileMembers } from "../../../policy/evidence/selected-source.js";
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
  const declarations = new Set<Node>();
  let readonly = false;
  for (const type of types) {
    const selected = type === request.sourceReceiverType && selectedIndex !== undefined ? selectedIndex :
      context.semanticsFor(request.expression).types.selectIndexedAccess(type, request.sourceArgumentType);
    const evidence = selectedSourceIndexedDeclarations(context.semanticsFor(request.expression), selected);
    if (evidence === undefined) return undefined;
    readonly ||= evidence.readonly;
    for (const declaration of evidence.declarations) declarations.add(declaration);
  }
  const selected = resolveSelectedSourceProfileMembers(context, [...declarations], options.sourceProfiles);
  return selected === undefined ? undefined : { ...selected, readonly };
}
