import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";

import { substituteRustTargetGenerics } from "../../../target-model/types/index.js";

import { rustProviderGenericRequirementsAreSatisfied } from "../../constraints/provider-generic-requirements.js";
import { rustProviderOperationOwnerMatches } from "../../operations/provider-selection.js";
import type { ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustProviderTypeRow } from "../../../target-model/identities/provider-relations.js";

import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";

import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";

export function providerCarrierFromRelations(
  identity: ProviderDeclarationIdentity,
  options: { readonly providerTypes: readonly RustProviderTypeRow[] },
): RustProviderTypeRow | undefined {
  if (identity.exportId === undefined) {
    return undefined;
  }
  const relations = options.providerTypes.filter((row) =>
    rustProviderOperationOwnerMatches(row, identity) &&
    row.exportId === identity.exportId);
  if (relations.length !== 1) {
    return undefined;
  }
  return relations[0];
}

export function instantiateProviderTargetType(
  relation: RustProviderTypeRow,
  arguments_: readonly RustTargetGenericArgument[],
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): TargetTypeRef | undefined {
  const parameters = relation.genericParameters ?? [];
  if (arguments_.length > parameters.length) {
    return undefined;
  }
  const typeSubstitutions = new Map<string, TargetTypeRef>();
  const lifetimeSubstitutions = new Map<string, import("../../../target-model/lifetimes/model.js").RustLifetimeRef>();
  const constSubstitutions = new Map<string, import("../../../target-model/types/model.js").RustTargetConstArgument>();
  const defaulted = new Set<string>();
  for (const [index, parameter] of parameters.entries()) {
    const authored = arguments_[index];
    if (authored === undefined && parameter.kind !== "lifetime") defaulted.add(parameter.targetIdentity);
    const selected = authored ?? (parameter.kind === "lifetime"
      ? undefined
      : parameter.defaultArgument === undefined
        ? undefined
        : substituteGenericArgument(
            parameter.defaultArgument,
            typeSubstitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ));
    if (selected === undefined || selected.kind !== parameter.kind) {
      return undefined;
    }
    if (parameter.kind === "type" && selected.kind === "type") {
      typeSubstitutions.set(parameter.targetIdentity, selected.type);
    } else if (parameter.kind === "lifetime" && selected.kind === "lifetime") {
      lifetimeSubstitutions.set(parameter.targetIdentity, selected.lifetime);
    } else if (parameter.kind === "const" && selected.kind === "const") {
      constSubstitutions.set(parameter.targetIdentity, selected.value);
    }
  }
  // A defaulted parameter's bounds hold by the provider declaration itself (rustc checks a default at its definition,
  // e.g. `Rc<T, A: Allocator = Global>`); only authored arguments are checked against their requirements.
  if (!rustProviderGenericRequirementsAreSatisfied(
    relation.typeRequirements?.filter((parameter) => !defaulted.has(parameter.identity)),
    {
      types: typeSubstitutions,
      lifetimes: lifetimeSubstitutions,
      consts: constSubstitutions,
    }, definitions,
  )) {
    return undefined;
  }
  return substituteRustTargetGenerics(
    relation.targetCarrier,
    typeSubstitutions,
    lifetimeSubstitutions,
    constSubstitutions,
  );
}

function substituteGenericArgument(
  argument: RustTargetGenericArgument,
  types: ReadonlyMap<string, TargetTypeRef>,
  lifetimes: ReadonlyMap<string, import("../../../target-model/lifetimes/model.js").RustLifetimeRef>,
  consts: ReadonlyMap<string, import("../../../target-model/types/model.js").RustTargetConstArgument>,
): RustTargetGenericArgument {
  if (argument.kind === "type") {
    return {
      kind: "type",
      type: substituteRustTargetGenerics(argument.type, types, lifetimes, consts),
    };
  }
  if (argument.kind === "lifetime") {
    return {
      kind: "lifetime",
      lifetime: lifetimes.get(rustLifetimeKey(argument.lifetime)) ??
        argument.lifetime,
    };
  }
  return argument.value.kind === "parameter"
    ? {
        kind: "const",
        value: consts.get(argument.value.identity) ?? argument.value,
      }
    : argument;
}
