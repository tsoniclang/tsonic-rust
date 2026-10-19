import {
  rustFixedArrayCarrierValue,
  rustFixedArrayTargetType,
  rustMoveOnlyNamedTypeTraits,
  rustNamedTargetType,
  rustNamedTypeCarrierValue,
} from "../../target-model/types/index.js";
import type {
  RustNamedTypeTraitContract,
  RustTargetGenericArgument,
  RustTargetTraitRef,
} from "../../target-model/types/model.js";
import type {
  RustProviderBinaryHookDefinition,
  RustProviderBinaryHookRow,
  RustProviderDispatchContextRow,
} from "../../target-model/metadata/provider-metadata.js";
import type {
  RustProviderOperationDefinition,
  RustProviderOperationRow,
  RustProviderTypeDefinition,
} from "../../target-model/identities/provider-relations.js";
import type {
  RustProviderGenericParameter,
  RustProviderOperationForm,
  RustValueConversion,
} from "../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { mapRustProgramErrorRoute } from "../../target-model/conversions/program-error.js";
import { rustNamedTypeTraitContract } from "../../target-model/types/carriers/native.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetTraitRef } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import type { RustDispatchContextDefinition } from "../../target-model/operations/dispatch-contexts.js";

export function materializeProviderDispatchContextRow(
  context: RustDispatchContextDefinition,
  aliases: ReadonlyMap<string, string>,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderDispatchContextRow, "providerPackageId" | "providerVersion">,
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): RustProviderDispatchContextRow {
  return {
    ...context,
    ...owner,
    rootCarrier: materializeProviderCarrier(context.rootCarrier, carrierPaths, carrierTraits, typeDeclarations),
    ...(context.handleCarrier === undefined ? {} : {
      handleCarrier: materializeProviderCarrier(context.handleCarrier, carrierPaths, carrierTraits, typeDeclarations),
    }),
    construct: { ...context.construct, path: expandProviderPath(context.construct.path, aliases) },
  };
}

export function canonicalizeProviderOperationRow(
  row: RustProviderOperationRow,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): RustProviderOperationRow {
  return materializeProviderOperationRow(
    row,
    new Map(),
    carrierPaths,
    carrierTraits,
    row,
    typeDeclarations,
  );
}

export function materializeProviderOperationRow(
  row: RustProviderOperationDefinition,
  aliases: ReadonlyMap<string, string>,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion" | "providerModuleId" | "moduleSpecifier">,
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): RustProviderOperationRow {
  const {
    isFallible,
    errorBoundary,
    errorCarrier,
    ...definition
  } = row;
  const materialized = {
    ...definition,
    ...owner,
    target: materializeProviderOperationForm(row.target, aliases, carrierPaths, carrierTraits, typeDeclarations),
    ...(row.nativeErrorCarriers === undefined ? {} : {
      nativeErrorCarriers: row.nativeErrorCarriers.map(carrier => materializeProviderCarrier(carrier, carrierPaths, carrierTraits, typeDeclarations)),
    }),
    resultCarrier: materializeProviderCarrier(row.resultCarrier, carrierPaths, carrierTraits, typeDeclarations),
    ...(row.receiverCarrier === undefined
      ? {}
      : { receiverCarrier: materializeProviderCarrier(row.receiverCarrier, carrierPaths, carrierTraits, typeDeclarations) }),
    ...(row.parameterCarriers === undefined
      ? {}
      : { parameterCarriers: row.parameterCarriers.map((carrier) => materializeProviderCarrier(carrier, carrierPaths, carrierTraits, typeDeclarations)) }),
    ...(row.genericParameters === undefined
      ? {}
      : {
          genericParameters: row.genericParameters.map((parameter) =>
            materializeProviderGenericParameter(parameter, carrierPaths, carrierTraits, typeDeclarations)),
        }),
    ...(row.targetGenericArguments === undefined
      ? {}
      : {
          targetGenericArguments: materializeProviderGenericArguments(
            row.targetGenericArguments,
            carrierPaths,
            carrierTraits,
            typeDeclarations,
          ),
        }),
    ...(row.resultConversion === undefined
      ? {}
      : {
          resultConversion: materializeProviderValueConversion(
            row.resultConversion,
            carrierPaths,
            carrierTraits,
            typeDeclarations,
          ),
        }),
    ...(row.immediateCallback === undefined
      ? {}
      : {
          immediateCallback: {
            ...row.immediateCallback,
            fallibleTarget: materializeProviderOperationForm(
              row.immediateCallback.fallibleTarget,
              aliases,
              carrierPaths,
              carrierTraits,
              typeDeclarations,
            ),
          },
        }),
  };
  if (isFallible !== true) {
    return materialized;
  }
  if (errorBoundary === "provider-native") {
    return {
      ...materialized,
      isFallible: true,
      errorBoundary,
      errorCarrier: materializeProviderCarrier(
        errorCarrier,
        carrierPaths,
        carrierTraits,
        typeDeclarations,
      ),
    };
  }
  return {
    ...materialized,
    isFallible: true,
    errorBoundary,
  };
}

export function materializeProviderBinaryHookRow(
  epilogue: RustProviderBinaryHookDefinition,
  aliases: ReadonlyMap<string, string>,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderBinaryHookRow, "providerPackageId" | "providerVersion">,
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): RustProviderBinaryHookRow {
  const base = {
    id: epilogue.id,
    phase: epilogue.phase,
    path: expandProviderPath(epilogue.path, aliases),
    requiredCrate: epilogue.requiredCrate,
    ...(epilogue.dispatchGroups === undefined ? {} : {
      dispatchGroups: epilogue.dispatchGroups.map(group => ({
        ...group,
        empty: { ...group.empty,
          owner: materializeProviderCarrier(group.empty.owner, carrierPaths, carrierTraits, typeDeclarations) },
        prepend: { ...group.prepend, path: expandProviderPath(group.prepend.path, aliases) },
      })),
    }),
    ...owner,
  };
  if (epilogue.isFallible !== true) {
    return base;
  }
  if (epilogue.errorBoundary === "provider-native") {
    return {
      ...base,
      isFallible: true,
      errorBoundary: "provider-native",
      errorCarrier: materializeProviderCarrier(
        epilogue.errorCarrier,
        carrierPaths,
        carrierTraits,
        typeDeclarations,
      ),
    };
  }
  return {
    ...base,
    isFallible: true,
    errorBoundary: epilogue.errorBoundary,
  };
}

function materializeProviderOperationForm(
  form: RustProviderOperationForm,
  aliases: ReadonlyMap<string, string>,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): RustProviderOperationForm {
  if ("trailingArguments" in form && form.trailingArguments !== undefined) {
    form = { ...form,
      trailingArguments: form.trailingArguments.map(argument =>
        argument.kind === "none" && argument.element !== undefined ? { ...argument,
          element: materializeProviderCarrier(argument.element, carrierPaths, carrierTraits, typeDeclarations) } : argument),
    };
  }
  const argConversions = "argConversions" in form && form.argConversions !== undefined
    ? [...form.argConversions]
    : undefined;
  if (form.form === "call" || form.form === "source-module-construction") {
    return {
      ...form,
      path: expandProviderPath(form.path, aliases),
      ...(form.form !== "source-module-construction"
        ? {}
        : {
            bootstrap: {
              ...form.bootstrap,
              path: expandProviderPath(form.bootstrap.path, aliases),
              ...(form.bootstrap.errorCarrier === undefined
                ? {}
                : {
                    errorCarrier: materializeProviderCarrier(
                      form.bootstrap.errorCarrier,
                      carrierPaths,
                      carrierTraits,
                      typeDeclarations,
                    ),
                  }),
            },
          }),
      ...(argConversions === undefined ? {} : { argConversions }),
    };
  }
  if (form.form === "call-c-variadic") {
    return {
      ...form,
      path: expandProviderPath(form.path, aliases),
      fixedArgumentModes: [...form.fixedArgumentModes],
    };
  }
  if (form.form === "call-value-slice" || form.form === "call-value-array" ||
    form.form === "receiver-value-array") {
    return {
      ...form,
      ...(form.form === "call-value-slice" || form.form === "call-value-array"
        ? { path: expandProviderPath(form.path, aliases) }
        : {}),
      leadingArguments: form.leadingArguments.map((argument) => ({
        ...argument,
        carrier: materializeProviderCarrier(argument.carrier, carrierPaths, carrierTraits, typeDeclarations),
      })),
      elementCarrier: materializeProviderCarrier(form.elementCarrier, carrierPaths, carrierTraits, typeDeclarations),
    };
  }
  if (form.form === "receiver-tagged-array") {
    return {
      ...form,
      leadingArguments: form.leadingArguments.map((argument) => ({
        ...argument,
        carrier: materializeProviderCarrier(argument.carrier, carrierPaths, carrierTraits, typeDeclarations),
      })),
      elementCarrier: materializeProviderCarrier(form.elementCarrier, carrierPaths, carrierTraits, typeDeclarations),
      alternatives: form.alternatives.map((alternative) => ({
        ...alternative,
        inputCarrier: materializeProviderCarrier(alternative.inputCarrier, carrierPaths, carrierTraits, typeDeclarations),
        constructorPath: expandProviderPath(alternative.constructorPath, aliases),
      })),
    };
  }
  if (form.form === "call-str-slice" || form.form === "path" ||
    form.form === "reference-path" || form.form === "struct-variant" ||
    form.form === "expression-macro" || form.form === "static") {
    return { ...form, path: expandProviderPath(form.path, aliases) };
  }
  if (form.form === "binary-operator") {
    return { ...form, trait: expandProviderPath(form.trait, aliases) };
  }
  if (form.form === "trait-call" || form.form === "trait-associated-value") {
    return {
      ...form,
      owner: materializeProviderCarrier(form.owner, carrierPaths, carrierTraits, typeDeclarations),
      traitPath: expandProviderPath(form.traitPath, aliases),
      traitGenericArguments: materializeProviderGenericArguments(
        form.traitGenericArguments,
        carrierPaths,
        carrierTraits,
        typeDeclarations,
      ),
    };
  }
  if (form.form === "associated-value" || form.form === "associated-call") {
    return {
      ...form,
      owner: materializeProviderCarrier(form.owner, carrierPaths, carrierTraits, typeDeclarations),
    };
  }
  if (form.form === "index" && form.indexConversion !== undefined) {
    return form;
  }
  if (form.form === "receiver-method" || form.form === "free-call" || form.form === "free-call-str-slice") {
    return {
      ...form,
      ...(form.form === "receiver-method" ? {} : { path: expandProviderPath(form.path, aliases) }),
      ...(argConversions === undefined ? {} : { argConversions }),
      ...(form.receiverConversion === undefined ? {} : {
        receiverConversion: materializeProviderValueConversion(form.receiverConversion, carrierPaths, carrierTraits, typeDeclarations),
      }),
    };
  }
  if (form.form === "arg-receiver-method" &&
    argConversions !== undefined) {
    return { ...form, argConversions };
  }
  return form;
}

export function expandProviderPath(path: string, aliases: ReadonlyMap<string, string>): string {
  const separator = path.indexOf("::");
  const root = separator < 0 ? path : path.slice(0, separator);
  const replacement = aliases.get(root);
  return replacement === undefined
    ? path
    : separator < 0 ? replacement : `${replacement}${path.slice(separator)}`;
}

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

function materializeProviderGenericArguments(
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

function materializeProviderValueConversion(
  conversion: RustValueConversion,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  typeDeclarations: readonly RustProviderTypeDefinition[] = [],
): RustValueConversion {
  switch (conversion.kind) {
    case "program-error": {
      const materialize = (carrier: TargetTypeRef): TargetTypeRef =>
        materializeProviderCarrier(carrier, carrierPaths, carrierTraits, typeDeclarations);
      return { ...conversion, source: materialize(conversion.source), target: materialize(conversion.target),
        route: mapRustProgramErrorRoute(conversion.route, materialize) };
    }
    case "union-map":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, typeDeclarations),
        arms: conversion.arms.map(arm => ({ ...arm,
          carrier: materializeProviderCarrier(arm.carrier, carrierPaths, carrierTraits, typeDeclarations),
          source: arm.source.map(step => ({ ...step, union: materializeProviderCarrier(step.union, carrierPaths, carrierTraits, typeDeclarations) })),
          target: arm.target.map(step => ({ ...step, union: materializeProviderCarrier(step.union, carrierPaths, carrierTraits, typeDeclarations) })),
        })),
      };
    case "rest-sequence":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        elementTarget: materializeProviderCarrier(conversion.elementTarget, carrierPaths, carrierTraits, typeDeclarations),
        elementConversions: conversion.elementConversions.map(element => element === null ? null :
          materializeProviderValueConversion(element, carrierPaths, carrierTraits, typeDeclarations)) as typeof conversion.elementConversions,
      };
    case "copy-from-reference":
      return {
        ...conversion,
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "raw-pointer-mut-to-const":
      return {
        ...conversion,
        pointee: materializeProviderCarrier(conversion.pointee, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "source-union-variant":
      return { ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, typeDeclarations),
        payloadCarrier: materializeProviderCarrier(conversion.payloadCarrier, carrierPaths, carrierTraits, typeDeclarations),
        payloadConversion: conversion.payloadConversion === null ? null :
          materializeProviderValueConversion(conversion.payloadConversion, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "union-project":
    case "exact-integer":
    case "native-representation":
    case "callable-input":
    case "native-upcast":
    case "bottom-coercion":
    case "js-argument-vector-callback":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "js-array-backing":
      return { ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        element: materializeProviderCarrier(conversion.element, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "closed-value-from-option":
    case "js-value-from-array":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        element: materializeProviderCarrier(conversion.element, carrierPaths, carrierTraits, typeDeclarations),
        elementConversion: materializeProviderValueConversion(
          conversion.elementConversion,
          carrierPaths,
          carrierTraits,
          typeDeclarations,
        ) as typeof conversion.elementConversion,
      };
    case "js-value-from-closed-carrier":
    case "ts-value-from-closed-carrier":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "union-fold":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, typeDeclarations),
        arms: conversion.arms.map((arm) => ({
          ...arm,
          carrier: materializeProviderCarrier(
            arm.carrier,
            carrierPaths,
            carrierTraits,
            typeDeclarations,
          ),
          path: arm.path.map(step => ({ ...step,
            union: materializeProviderCarrier(step.union, carrierPaths, carrierTraits, typeDeclarations),
          })),
          conversion: materializeProviderValueConversion(
            arm.conversion,
            carrierPaths,
            carrierTraits,
            typeDeclarations,
          ) as typeof arm.conversion,
        })),
      };
    case "js-value-from-structural-to-json":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        resultCarrier: materializeProviderCarrier(
          conversion.resultCarrier,
          carrierPaths,
          carrierTraits,
          typeDeclarations,
        ),
        resultConversion: materializeProviderValueConversion(
          conversion.resultConversion,
          carrierPaths,
          carrierTraits,
          typeDeclarations,
        ) as typeof conversion.resultConversion,
      };
    case "js-value-from-properties":
    case "js-value-from-structural-object": {
      const source = materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations);
      const mapField = <Field extends (typeof conversion.fields)[number]>(field: Field) => ({
          ...field,
          sourceCarrier: materializeProviderCarrier(
            field.sourceCarrier,
            carrierPaths,
            carrierTraits,
            typeDeclarations,
          ),
          conversion: materializeProviderValueConversion(
            field.conversion,
            carrierPaths,
            carrierTraits,
            typeDeclarations,
          ) as typeof field.conversion,
        });
      return conversion.kind === "js-value-from-properties"
        ? { ...conversion, source, fields: conversion.fields.map(mapField) }
        : { ...conversion, source, fields: conversion.fields.map(mapField) };
    }
    case "option-some":
      return { ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, typeDeclarations),
        element: materializeProviderCarrier(conversion.element, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "source-optional":
      return {
        ...conversion,
        element: materializeProviderCarrier(conversion.element, carrierPaths, carrierTraits, typeDeclarations),
      };
    case "option-map":
      return {
        ...conversion,
        elementConversion: materializeProviderValueConversion(
          conversion.elementConversion,
          carrierPaths,
          carrierTraits,
          typeDeclarations,
        ) as typeof conversion.elementConversion,
      };
    case "semantic-conversion":
    case "numeric-promotion":
    case "integer-refinement":
      return conversion;
  }
}
