import { providerVirtualDeclarationFactKey, type Node } from "@tsonic/tsts";
import { sourceIndexedTypeEvidence } from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { resolveProviderTypeIdentity, providerCarrierFromRelations, instantiateProviderTargetType } from "./providers.js";
import { resolveRustTargetTypeRef } from "./source.js";
import { selectRustProviderOperation } from "../../operations/provider-selection.js";
import { rustNamedTypeCarrierValue, substituteRustTargetGenerics, rustOptionElementCarrier, rustSourceOptionalTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { inferRustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import type { RustTargetGenericArgument } from "../../../target-model/types/model.js";

export function resolveRustProviderIndexedAccess(
  node: Node, context: RustTargetTypeResolutionContext, options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const evidence = sourceIndexedTypeEvidence(context.ast, context.currentSemantics, node);
  if (evidence === undefined) return undefined;
  if (!evidence.members.some(member => member.subjects.some(subject =>
    context.facts.get(subject, providerVirtualDeclarationFactKey) !== undefined))) return undefined;
  const identities = evidence.members.map(member => resolveProviderTypeIdentity(member.subjects, context));
  const rejected: TargetTypeRef = { kind: "opaque", id: "provider-indexed-type-evidence-unavailable" };
  const owner = resolveRustTargetTypeRef(evidence.owner, context, options);
  const named = rustNamedTypeCarrierValue(owner);
  if (owner === undefined || named === undefined) return rejected;
  let result: TargetTypeRef | undefined;
  for (const [index, identity] of identities.entries()) {
    if (identity === undefined) return rejected;
    const typeRow = providerCarrierFromRelations(identity, options);
    const member = evidence.members[index]!.selection;
    const operation = selectRustProviderOperation(options.providerRows, identity, member.kind === "index" ? "indexer" : "property");
    if (typeRow === undefined || operation.kind !== "selected") return rejected;
    const parameters = typeRow.genericParameters ?? [];
    const substitutions = inferRustTargetGenericBindings(typeRow.targetCarrier, owner, {
      typeIdentities: new Set(parameters.flatMap(parameter => parameter.kind === "type" ? [parameter.targetIdentity] : [])),
      lifetimeIdentities: new Set(parameters.flatMap(parameter => parameter.kind === "lifetime" ? [parameter.targetIdentity] : [])),
      constIdentities: new Set(parameters.flatMap(parameter => parameter.kind === "const" ? [parameter.targetIdentity] : [])),
    });
    if (substitutions === undefined) return rejected;
    const arguments_: RustTargetGenericArgument[] = [];
    for (const parameter of parameters) {
      if (parameter.kind === "type") {
        const type = substitutions.types.get(parameter.targetIdentity);
        if (type === undefined) return rejected;
        arguments_.push({ kind: "type", type });
      } else if (parameter.kind === "lifetime") {
        const lifetime = substitutions.lifetimes.get(parameter.targetIdentity);
        if (lifetime === undefined) return rejected;
        arguments_.push({ kind: "lifetime", lifetime });
      } else {
        const value = substitutions.consts.get(parameter.targetIdentity);
        if (value === undefined) return rejected;
        arguments_.push({ kind: "const", value });
      }
    }
    const instantiatedOwner = instantiateProviderTargetType(typeRow, arguments_, context.typeDefinitions);
    if (instantiatedOwner === undefined || !rustTargetTypeRefEquals(instantiatedOwner, owner)) return rejected;
    const instantiate = (carrier: TargetTypeRef): TargetTypeRef =>
      substituteRustTargetGenerics(carrier, substitutions.types, substitutions.lifetimes, substitutions.consts);
    if (operation.row.receiverCarrier !== undefined &&
      !rustTargetTypeRefEquals(instantiate(operation.row.receiverCarrier), owner)) return rejected;
    const selected = instantiate(operation.row.resultCarrier);
    const carrier = member.kind === "property" && member.property.optional
      ? rustSourceOptionalTargetType(rustOptionElementCarrier(selected) ?? selected) : selected;
    if (result !== undefined && !rustTargetTypeRefEquals(result, carrier)) return rejected;
    result = carrier;
  }
  return result ?? rejected;
}
