import { rustFixedArrayCarrierValue, rustFixedArrayTargetType, rustMoveOnlyNamedTypeTraits, rustNamedTargetType, rustNamedTypeCarrierValue } from "../../../target-model/types/carriers/native.js";
import type { RustNamedTypeTraitContract, RustTargetGenericArgument, RustTargetTraitRef } from "../../../target-model/types/model.js";

import type { RustProviderTypeDefinition } from "../../../target-model/identities/provider-relations.js";
import type { RustProviderGenericParameter } from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { rustNamedTypeTraitContract } from "../../../target-model/types/carriers/native.js";
import { rustTargetGenericBindingsForArguments } from "../../../target-model/types/generic-arguments.js";
import { substituteRustTargetTraitRef } from "../../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";

export function materializeProviderCarrier(
  carrier: TargetTypeRef,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>> = {},
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): TargetTypeRef {
  const named = rustNamedTypeCarrierValue(carrier);
  if (named !== undefined) {
    const genericArguments = materializeProviderGenericArguments(
      named.genericArguments,
      carrierPaths,
      carrierTraits,
      typeDeclarations,
    );
    const path = carrierPaths[named.id];
    const traits = carrierTraits[named.id];
    return rustNamedTargetType(
      named.id,
      path ?? named.path,
      genericArguments,
      materializeProviderGenericArguments(
        named.genericDefaults,
        carrierPaths,
        carrierTraits,
        typeDeclarations,
      ),
      materializeProviderTraitContract(traits === undefined ? named.traits :
        instantiateProviderTraitContract(traits, named.id, genericArguments, typeDeclarations), carrierPaths, typeDeclarations),
      named.upcasts.map((upcast) => ({
        ...upcast,
        target: materializeProviderCarrier(upcast.target, carrierPaths, carrierTraits, typeDeclarations),
      })),
    );
  }
  if (carrier.kind === "target-named") {
    const genericArguments = materializeProviderGenericArguments(
      carrier.genericArguments ?? [],
      carrierPaths,
      carrierTraits,
      typeDeclarations,
    );
    const path = carrierPaths[carrier.id];
    const traits = carrierTraits[carrier.id];
    return path === undefined
      ? { ...carrier, ...(genericArguments.length === 0 ? {} : { genericArguments }) }
      : rustNamedTargetType(
          carrier.id,
          path,
          genericArguments,
          [],
          materializeProviderTraitContract(traits === undefined ? rustMoveOnlyNamedTypeTraits :
            instantiateProviderTraitContract(traits, carrier.id, genericArguments, typeDeclarations), carrierPaths, typeDeclarations),
        );
  }
  if (carrier.kind === "array") {
    return { ...carrier, element: materializeProviderCarrier(carrier.element, carrierPaths, carrierTraits, typeDeclarations) };
  }
  if (carrier.kind === "slice") {
    return { ...carrier, element: materializeProviderCarrier(carrier.element, carrierPaths, carrierTraits, typeDeclarations) };
  }
  if (carrier.kind === "tuple") {
    return { ...carrier, elements: carrier.elements.map((element) => materializeProviderCarrier(element, carrierPaths, carrierTraits, typeDeclarations)) };
  }
  if (carrier.kind === "reference") {
    return { ...carrier, referent: materializeProviderCarrier(carrier.referent, carrierPaths, carrierTraits, typeDeclarations) };
  }
  if (carrier.kind === "pointer") {
    return { ...carrier, pointee: materializeProviderCarrier(carrier.pointee, carrierPaths, carrierTraits, typeDeclarations) };
  }
  if (carrier.kind === "function-pointer") {
    return {
      ...carrier,
      args: carrier.args.map((argument) => materializeProviderCarrier(argument, carrierPaths, carrierTraits, typeDeclarations)),
      result: materializeProviderCarrier(carrier.result, carrierPaths, carrierTraits, typeDeclarations),
    };
  }
  if (carrier.kind === "closure") {
    return {
      ...carrier,
      args: carrier.args.map((argument) =>
        materializeProviderCarrier(argument, carrierPaths, carrierTraits, typeDeclarations)),
      result: materializeProviderCarrier(carrier.result, carrierPaths, carrierTraits, typeDeclarations),
    };
  }
  if (carrier.kind === "trait-ref") {
    return {
      ...carrier,
      path: carrierPaths[carrier.id] ?? carrier.path,
      genericArguments: materializeProviderGenericArguments(
        carrier.genericArguments,
        carrierPaths,
        carrierTraits,
        typeDeclarations,
      ),
      associatedConstraints: carrier.associatedConstraints.map((constraint) =>
        constraint.kind === "equality"
          ? {
              ...constraint,
              genericArguments: materializeProviderGenericArguments(
                constraint.genericArguments,
                carrierPaths,
                carrierTraits,
                typeDeclarations,
              ),
              type: materializeProviderCarrier(
                constraint.type,
                carrierPaths,
                carrierTraits,
                typeDeclarations,
              ),
            }
          : {
              ...constraint,
              genericArguments: materializeProviderGenericArguments(
                constraint.genericArguments,
                carrierPaths,
                carrierTraits,
                typeDeclarations,
              ),
              traits: constraint.traits.map((trait) =>
                materializeProviderTraitRef(trait, carrierPaths, carrierTraits, typeDeclarations)),
            }),
    };
  }
  if (carrier.kind === "trait-object") {
    return {
      ...carrier,
      principal: materializeProviderTraitRef(carrier.principal, carrierPaths, carrierTraits, typeDeclarations),
      autoTraits: carrier.autoTraits.map((trait) =>
        materializeProviderTraitRef(trait, carrierPaths, carrierTraits, typeDeclarations)),
    };
  }
  if (carrier.kind === "impl-trait") {
    return {
      ...carrier,
      captures: materializeProviderGenericArguments(carrier.captures, carrierPaths, carrierTraits, typeDeclarations),
      bounds: carrier.bounds.map((bound) =>
        materializeProviderTraitRef(bound, carrierPaths, carrierTraits, typeDeclarations)),
    };
  }
  if (carrier.kind === "associated-type") {
    return {
      ...carrier,
      owner: materializeProviderCarrier(carrier.owner, carrierPaths, carrierTraits, typeDeclarations),
      ...(carrier.trait === undefined
        ? {}
        : { trait: materializeProviderTraitRef(carrier.trait, carrierPaths, carrierTraits, typeDeclarations) }),
      ...(carrier.genericArguments === undefined
        ? {}
        : {
            genericArguments: materializeProviderGenericArguments(
              carrier.genericArguments,
              carrierPaths,
              carrierTraits,
              typeDeclarations,
            ),
          }),
    };
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  return fixedArray === undefined
    ? carrier
    : rustFixedArrayTargetType(materializeProviderCarrier(fixedArray.element, carrierPaths, carrierTraits, typeDeclarations), fixedArray.length);
}

function instantiateProviderTraitContract(
  contract: RustNamedTypeTraitContract,
  carrierId: string,
  arguments_: readonly RustTargetGenericArgument[],
  declarations: readonly RustProviderTypeDefinition[],
): RustNamedTypeTraitContract {
  const references = contract.implementations.flatMap(implementation =>
    [implementation.trait, ...implementation.requirements.map(requirement => requirement.trait)])
    .map(trait => rustTargetGenericReferences(trait, "metadata"));
  if (references.every(value => value.typeIdentities.length === 0 && value.lifetimeIdentities.length === 0 &&
    value.constIdentities.length === 0)) return contract;
  const declaration = declarations.find(value => {
    const named = rustNamedTypeCarrierValue(value.targetCarrier);
    return (named?.id ?? (value.targetCarrier.kind === "target-named" ? value.targetCarrier.id : undefined)) === carrierId;
  });
  if (declaration === undefined)
    throw new Error(`Rust provider native trait contract '${carrierId}' requires its exact generic declaration owner.`);
  const bindings = rustTargetGenericBindingsForArguments(declaration.genericParameters ?? [], arguments_);
  if (bindings === undefined)
    throw new Error(`Rust provider native trait contract '${carrierId}' has no exact generic argument correspondence.`);
  const instantiate = (trait: RustTargetTraitRef): RustTargetTraitRef =>
    substituteRustTargetTraitRef(trait, bindings.types, bindings.lifetimes, bindings.consts);
  return rustNamedTypeTraitContract(contract.implementations.map(implementation => ({
    trait: instantiate(implementation.trait), requirements: implementation.requirements.map(requirement => ({
      ...requirement, trait: instantiate(requirement.trait),
    })),
  })));
}

function materializeProviderTraitContract(
  contract: RustNamedTypeTraitContract,
  carrierPaths: Readonly<Record<string, string>>,
  typeDeclarations: readonly RustProviderTypeDefinition[],
): RustNamedTypeTraitContract {
  return rustNamedTypeTraitContract(contract.implementations.map(implementation => ({
    trait: materializeProviderTraitRef(implementation.trait, carrierPaths, {}, typeDeclarations),
    requirements: implementation.requirements.map(requirement => ({ ...requirement,
      trait: materializeProviderTraitRef(requirement.trait, carrierPaths, {}, typeDeclarations),
    })),
  })));
}

function materializeProviderTraitRef(
  trait: RustTargetTraitRef,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): RustTargetTraitRef {
  const materialized = materializeProviderCarrier(trait, carrierPaths, carrierTraits, typeDeclarations);
  if (materialized.kind !== "trait-ref") {
    throw new Error("Rust provider trait materialization changed the exact target trait carrier kind.");
  }
  return materialized;
}

export function materializeProviderGenericArguments(
  arguments_: readonly RustTargetGenericArgument[],
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): readonly RustTargetGenericArgument[] {
  return Object.freeze(arguments_.map((argument): RustTargetGenericArgument =>
    argument.kind === "type"
      ? {
          kind: "type",
          type: materializeProviderCarrier(argument.type, carrierPaths, carrierTraits, typeDeclarations),
        }
      : argument));
}

export function materializeProviderGenericParameter(
  parameter: RustProviderGenericParameter,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): RustProviderGenericParameter {
  if (parameter.kind === "lifetime" || parameter.defaultArgument === undefined) {
    return parameter;
  }
  return Object.freeze({
    ...parameter,
    defaultArgument: materializeProviderGenericArguments(
      [parameter.defaultArgument],
      carrierPaths,
      carrierTraits,
      typeDeclarations,
    )[0]!,
  });
}
