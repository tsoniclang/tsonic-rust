import { providerVirtualDeclarationFactKey, type Node } from "@tsonic/tsts";
import { sourceIndexedPropertyTypeEvidence } from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { resolveProviderTypeIdentity, providerCarrierFromRelations, instantiateProviderTargetType } from "./providers.js";
import { resolveRustTargetTypeRef } from "./source.js";
import { selectRustProviderOperation } from "../../operations/provider-selection.js";
import { rustNamedTypeCarrierValue, rustTargetGenericBindingsForArguments, substituteRustTargetGenerics, rustOptionTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

export function resolveRustProviderIndexedAccess(
  node: Node, context: RustTargetTypeResolutionContext, options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const evidence = sourceIndexedPropertyTypeEvidence(context.ast, context.currentSemantics, node);
  if (evidence === undefined) return undefined;
  if (!evidence.properties.some(member => member.subjects.some(subject =>
    context.facts.get(subject, providerVirtualDeclarationFactKey) !== undefined))) return undefined;
  const identities = evidence.properties.map(member => resolveProviderTypeIdentity(member.subjects, context));
  const rejected: TargetTypeRef = { kind: "opaque", id: "provider-indexed-type-evidence-unavailable" };
  const owner = resolveRustTargetTypeRef(evidence.owner, context, options);
  const named = rustNamedTypeCarrierValue(owner);
  if (named === undefined) return rejected;
  let result: TargetTypeRef | undefined;
  for (const [index, identity] of identities.entries()) {
    if (identity === undefined) return rejected;
    const typeRow = providerCarrierFromRelations(identity, options);
    const operation = selectRustProviderOperation(options.providerRows, identity, "property");
    if (typeRow === undefined || operation.kind !== "selected") return rejected;
    const instantiatedOwner = instantiateProviderTargetType(typeRow, named.genericArguments, context.typeDefinitions);
    if (instantiatedOwner === undefined || !rustTargetTypeRefEquals(instantiatedOwner, owner)) return rejected;
    const substitutions = rustTargetGenericBindingsForArguments(typeRow.genericParameters ?? [], named.genericArguments);
    if (substitutions === undefined) return rejected;
    const instantiate = (carrier: TargetTypeRef): TargetTypeRef =>
      substituteRustTargetGenerics(carrier, substitutions.types, substitutions.lifetimes, substitutions.consts);
    if (operation.row.receiverCarrier !== undefined &&
      !rustTargetTypeRefEquals(instantiate(operation.row.receiverCarrier), owner)) return rejected;
    const selected = instantiate(operation.row.resultCarrier);
    const carrier = evidence.properties[index]!.property.optional ? rustOptionTargetType(selected) : selected;
    if (result !== undefined && !rustTargetTypeRefEquals(result, carrier)) return rejected;
    result = carrier;
  }
  return result ?? rejected;
}
