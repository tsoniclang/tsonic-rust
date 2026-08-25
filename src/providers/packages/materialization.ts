import { rustPathTargetType } from "../../target-model/types/index.js";
import type {
  RustBound,
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
  RustSemanticIdentity,
  RustTraitImplementationEvidence,
  RustTraitRef,
} from "../../target-model/semantics/index.js";
import { rustSemanticIdentityItemId } from "../../target-model/semantics/index.js";
import type { RustNamedTypeTraitContract } from "../../target-model/types/model.js";
import type {
  RustProviderBinaryEpilogueDefinition,
  RustProviderBinaryEpilogueRow,
  RustProviderOperationDefinition,
  RustProviderOperationRow,
} from "./model.js";
import type {
  RustProviderOperationForm,
  RustProviderSourceGenericBinding,
  RustValueConversion,
} from "../../target-model/operations/model.js";
import type { RustProviderTypeParameterRequirement } from "../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function canonicalizeProviderOperationRow(
  row: RustProviderOperationRow,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
): RustProviderOperationRow {
  return materializeProviderOperationRow(
    row,
    new Map(),
    carrierPaths,
    carrierTraits,
    row,
  );
}

export function materializeProviderOperationRow(
  row: RustProviderOperationDefinition,
  aliases: ReadonlyMap<string, string>,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion" | "providerModuleId" | "moduleSpecifier">,
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
    target: materializeProviderOperationForm(row.target, aliases, carrierPaths, carrierTraits, owner),
    resultCarrier: materializeProviderCarrier(row.resultCarrier, carrierPaths, carrierTraits, owner),
    ...(row.receiverCarrier === undefined
      ? {}
      : { receiverCarrier: materializeProviderCarrier(row.receiverCarrier, carrierPaths, carrierTraits, owner) }),
    ...(row.targetReceiver === undefined
      ? {}
      : {
          targetReceiver: Object.freeze({
            ...row.targetReceiver,
            type: materializeProviderCarrier(
              row.targetReceiver.type,
              carrierPaths,
              carrierTraits,
              owner,
            ),
          }),
        }),
    ...(row.parameterCarriers === undefined
      ? {}
      : { parameterCarriers: row.parameterCarriers.map((carrier) => materializeProviderCarrier(carrier, carrierPaths, carrierTraits, owner)) }),
    ...(row.sourceGenericBindings === undefined
      ? {}
      : {
          sourceGenericBindings: row.sourceGenericBindings.map((binding) =>
            materializeProviderSourceGenericBinding(
              binding,
              carrierPaths,
              carrierTraits,
              owner,
            )),
        }),
    ...(row.targetInferenceParameters === undefined
      ? {}
      : {
          targetInferenceParameters: row.targetInferenceParameters.map((argument) =>
            materializeProviderGenericArgument(
              argument,
              carrierPaths,
              carrierTraits,
              owner,
            )),
        }),
    ...(row.targetGenerics === undefined
      ? {}
      : {
          targetGenerics: materializeProviderGenerics(
            row.targetGenerics,
            carrierPaths,
            carrierTraits,
            owner,
          ),
        }),
    ...(row.targetCallableGenerics === undefined
      ? {}
      : {
          targetCallableGenerics: materializeProviderGenerics(
            row.targetCallableGenerics,
            carrierPaths,
            carrierTraits,
            owner,
          ),
        }),
    ...(row.targetGenericArguments === undefined
      ? {}
      : {
          targetGenericArguments: row.targetGenericArguments.map((argument) =>
            materializeProviderGenericArgument(argument, carrierPaths, carrierTraits, owner)),
        }),
    ...(row.typeRequirements === undefined
      ? {}
      : {
          typeRequirements: row.typeRequirements.map((parameter) => Object.freeze({
            ...parameter,
            requirements: Object.freeze(parameter.requirements.map((bound) =>
              materializeBound(bound, carrierPaths, carrierTraits, owner))),
          })),
        }),
    ...(row.resultConversion === undefined
      ? {}
      : {
          resultConversion: materializeProviderValueConversion(
            row.resultConversion,
            carrierPaths,
            carrierTraits,
            owner,
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
              owner,
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
        owner,
      ),
    };
  }
  return {
    ...materialized,
    isFallible: true,
    errorBoundary,
  };
}

export function materializeProviderBinaryEpilogueRow(
  epilogue: RustProviderBinaryEpilogueDefinition,
  aliases: ReadonlyMap<string, string>,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderBinaryEpilogueRow, "providerPackageId" | "providerVersion">,
): RustProviderBinaryEpilogueRow {
  const base = {
    id: epilogue.id,
    path: expandProviderPath(epilogue.path, aliases),
    requiredCrate: epilogue.requiredCrate,
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
  owner?: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion">,
): RustProviderOperationForm {
  const argConversions = "argConversions" in form && form.argConversions !== undefined
    ? [...form.argConversions]
    : undefined;
  if (form.form === "call") {
    return {
      ...form,
      path: expandProviderPath(form.path, aliases),
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
  if (form.form === "free-call") {
    return {
      ...form,
      path: expandProviderPath(form.path, aliases),
      ...(argConversions === undefined ? {} : { argConversions }),
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
        carrier: materializeProviderCarrier(argument.carrier, carrierPaths, carrierTraits, owner),
      })),
      elementCarrier: materializeProviderCarrier(form.elementCarrier, carrierPaths, carrierTraits, owner),
    };
  }
  if (form.form === "receiver-tagged-array") {
    return {
      ...form,
      leadingArguments: form.leadingArguments.map((argument) => ({
        ...argument,
        carrier: materializeProviderCarrier(argument.carrier, carrierPaths, carrierTraits, owner),
      })),
      elementCarrier: materializeProviderCarrier(form.elementCarrier, carrierPaths, carrierTraits, owner),
      alternatives: form.alternatives.map((alternative) => ({
        ...alternative,
        inputCarrier: materializeProviderCarrier(alternative.inputCarrier, carrierPaths, carrierTraits, owner),
        constructorPath: expandProviderPath(alternative.constructorPath, aliases),
      })),
    };
  }
  if (form.form === "call-str-slice" || form.form === "free-call-str-slice" || form.form === "path" ||
    form.form === "static" || form.form === "static-reference" || form.form === "struct-variant") {
    return { ...form, path: expandProviderPath(form.path, aliases) };
  }
  if (form.form === "binary-operator") {
    return { ...form, trait: expandProviderPath(form.trait, aliases) };
  }
  if (form.form === "trait-call" || form.form === "trait-associated-value") {
    return {
      ...form,
      owner: materializeProviderCarrier(form.owner, carrierPaths, carrierTraits, owner),
      trait: materializeTraitReference(form.trait, carrierPaths, carrierTraits, owner),
    };
  }
  if (form.form === "index" && form.indexConversion !== undefined) {
    return form;
  }
  if ((form.form === "receiver-method" || form.form === "arg-receiver-method") &&
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
  owner?: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion">,
  includeTraitImplementations = true,
): TargetTypeRef {
  if (carrier.kind === "path") {
    const itemId = rustSemanticIdentityItemId(carrier.identity);
    const path = itemId === undefined ? undefined : carrierPaths[itemId];
    const identity = path === undefined || owner === undefined || carrier.identity.kind !== "builtin"
      ? carrier.identity
      : providerCarrierIdentity(owner, carrier.identity.itemId);
    return rustPathTargetType({
      identity,
      displayPath: path === undefined ? carrier.displayPath : path.split("::"),
      arguments: carrier.arguments.map((argument) =>
        materializeProviderGenericArgument(
          argument,
          carrierPaths,
          carrierTraits,
          owner,
          includeTraitImplementations,
        )),
      traitImplementations: includeTraitImplementations
        ? materializeTraitImplementations(
            (itemId === undefined ? undefined : carrierTraits[itemId]?.implementations) ??
              carrier.traitImplementations,
            carrierPaths,
            carrierTraits,
            owner,
          )
        : Object.freeze([]),
    });
  }
  if (carrier.kind === "array") {
    return { ...carrier, element: materializeProviderCarrier(carrier.element, carrierPaths, carrierTraits, owner, includeTraitImplementations) };
  }
  if (carrier.kind === "sequence" || carrier.kind === "slice") {
    return { ...carrier, element: materializeProviderCarrier(carrier.element, carrierPaths, carrierTraits, owner, includeTraitImplementations) };
  }
  if (carrier.kind === "tuple") {
    return { ...carrier, elements: carrier.elements.map((element) => materializeProviderCarrier(element, carrierPaths, carrierTraits, owner, includeTraitImplementations)) };
  }
  if (carrier.kind === "reference") {
    return { ...carrier, target: materializeProviderCarrier(carrier.target, carrierPaths, carrierTraits, owner, includeTraitImplementations) };
  }
  if (carrier.kind === "raw-pointer") {
    return { ...carrier, target: materializeProviderCarrier(carrier.target, carrierPaths, carrierTraits, owner, includeTraitImplementations) };
  }
  if (carrier.kind === "function-pointer") {
    return {
      ...carrier,
      parameters: carrier.parameters.map((argument) => materializeProviderCarrier(argument, carrierPaths, carrierTraits, owner, includeTraitImplementations)),
      result: materializeProviderCarrier(carrier.result, carrierPaths, carrierTraits, owner, includeTraitImplementations),
    };
  }
  if (carrier.kind === "closure") {
    return {
      ...carrier,
      parameters: carrier.parameters.map((argument) => materializeProviderCarrier(argument, carrierPaths, carrierTraits, owner, includeTraitImplementations)),
      result: materializeProviderCarrier(carrier.result, carrierPaths, carrierTraits, owner, includeTraitImplementations),
    };
  }
  if (carrier.kind === "associated-type") {
    return {
      ...carrier,
      owner: materializeProviderCarrier(carrier.owner, carrierPaths, carrierTraits, owner, includeTraitImplementations),
      trait: materializeTraitReference(carrier.trait, carrierPaths, carrierTraits, owner),
      arguments: carrier.arguments.map((argument) =>
        materializeProviderGenericArgument(argument, carrierPaths, carrierTraits, owner, includeTraitImplementations)),
    };
  }
  if (carrier.kind === "trait-object") {
    return {
      ...carrier,
      principal: materializeTraitReference(carrier.principal, carrierPaths, carrierTraits, owner),
      autoTraits: carrier.autoTraits.map((trait) =>
        materializeTraitReference(trait, carrierPaths, carrierTraits, owner)),
    };
  }
  if (carrier.kind === "opaque") {
    return {
      ...carrier,
      bounds: carrier.bounds.map((bound) =>
        materializeBound(bound, carrierPaths, carrierTraits, owner, includeTraitImplementations)),
    };
  }
  return carrier;
}

export function materializeProviderTypeRequirements(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion">,
): readonly RustProviderTypeParameterRequirement[] | undefined {
  return requirements === undefined
    ? undefined
    : Object.freeze(requirements.map((parameter) => Object.freeze({
        ...parameter,
        requirements: Object.freeze(parameter.requirements.map((bound) =>
          materializeBound(bound, carrierPaths, carrierTraits, owner))),
      })));
}

function materializeProviderValueConversion(
  conversion: RustValueConversion,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner?: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion">,
): RustValueConversion {
  switch (conversion.kind) {
    case "copy-from-reference":
      return {
        ...conversion,
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, owner),
      };
    case "raw-pointer-mut-to-const":
      return {
        ...conversion,
        pointee: materializeProviderCarrier(conversion.pointee, carrierPaths, carrierTraits, owner),
      };
    case "source-union-variant":
    case "bottom-coercion":
    case "js-argument-vector-callback":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits, owner),
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits, owner),
      };
    case "option-some":
      return {
        ...conversion,
        element: materializeProviderCarrier(conversion.element, carrierPaths, carrierTraits, owner),
      };
    case "option-map":
      return {
        ...conversion,
        elementConversion: materializeProviderValueConversion(
          conversion.elementConversion,
          carrierPaths,
          carrierTraits,
          owner,
        ) as typeof conversion.elementConversion,
      };
    case "semantic-conversion":
    case "numeric-promotion":
      return conversion;
  }
}

function providerCarrierIdentity(
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion">,
  itemId: string,
): RustSemanticIdentity {
  return Object.freeze({
    kind: "provider",
    providerId: owner.providerId,
    providerVersion: owner.providerVersion,
    compilationSnapshotId: `${owner.providerPackageId}@${owner.providerVersion}`,
    itemId,
  });
}

export function materializeProviderGenericArgument(
  argument: RustGenericArgument,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion"> | undefined,
  includeTraitImplementations = true,
): RustGenericArgument {
  return argument.kind === "type"
    ? Object.freeze({
        kind: "type",
        value: materializeProviderCarrier(
          argument.value,
          carrierPaths,
          carrierTraits,
          owner,
          includeTraitImplementations,
        ),
      })
    : argument;
}

export function materializeProviderSourceGenericBinding(
  binding: RustProviderSourceGenericBinding,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion">,
): RustProviderSourceGenericBinding {
  if (binding.target.kind === "semantic-parameter") {
    return Object.freeze({
      sourceName: binding.sourceName,
      target: Object.freeze({
        kind: "semantic-parameter" as const,
        role: binding.target.role,
      }),
    });
  }
  return Object.freeze({
    sourceName: binding.sourceName,
    target: binding.target.kind === "generic-parameter"
      ? Object.freeze({
          kind: "generic-parameter" as const,
          parameter: materializeProviderGenericArgument(
            binding.target.parameter,
            carrierPaths,
            carrierTraits,
            owner,
          ),
        })
      : Object.freeze({
          kind: "associated-type" as const,
          projection: materializeAssociatedTypeProjection(
            binding.target.projection,
            carrierPaths,
            carrierTraits,
            owner,
          ),
        }),
  });
}

function materializeAssociatedTypeProjection(
  projection: Extract<TargetTypeRef, { readonly kind: "associated-type" }>,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion">,
): Extract<TargetTypeRef, { readonly kind: "associated-type" }> {
  const materialized = materializeProviderCarrier(
    projection,
    carrierPaths,
    carrierTraits,
    owner,
  );
  if (materialized.kind !== "associated-type") {
    throw new Error("Rust provider associated source binding changed semantic kind during materialization.");
  }
  return materialized;
}

export function materializeProviderGenerics(
  generics: RustGenerics,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion"> | undefined,
): RustGenerics {
  const parameters = generics.parameters.map((parameter): RustGenericParameter => {
    if (parameter.kind === "lifetime") return parameter;
    if (parameter.kind === "type") {
      return Object.freeze({
        ...parameter,
        bounds: Object.freeze(parameter.bounds.map((bound) =>
          materializeBound(bound, carrierPaths, carrierTraits, owner))),
        ...(parameter.defaultType === undefined
          ? {}
          : {
              defaultType: materializeProviderCarrier(
                parameter.defaultType,
                carrierPaths,
                carrierTraits,
                owner,
              ),
            }),
      });
    }
    return Object.freeze({
      ...parameter,
      type: materializeProviderCarrier(parameter.type, carrierPaths, carrierTraits, owner),
    });
  });
  const wherePredicates = generics.wherePredicates.map((predicate) => {
    if (predicate.kind === "lifetime") return predicate;
    if (predicate.kind === "equality") {
      const projection = materializeProviderCarrier(
        predicate.projection,
        carrierPaths,
        carrierTraits,
        owner,
      );
      if (projection.kind !== "associated-type") {
        throw new Error("Rust provider where equality changed semantic kind during materialization.");
      }
      return Object.freeze({
        ...predicate,
        projection,
        value: materializeProviderCarrier(
          predicate.value,
          carrierPaths,
          carrierTraits,
          owner,
        ),
      });
    }
    return Object.freeze({
      ...predicate,
      type: materializeProviderCarrier(predicate.type, carrierPaths, carrierTraits, owner),
      bounds: Object.freeze(predicate.bounds.map((bound) =>
        materializeBound(bound, carrierPaths, carrierTraits, owner))),
    });
  });
  return Object.freeze({
    parameters: Object.freeze(parameters),
    wherePredicates: Object.freeze(wherePredicates),
  });
}

function materializeTraitReference(
  trait: RustTraitRef,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion"> | undefined,
): RustTraitRef {
  const itemId = rustSemanticIdentityItemId(trait.identity);
  const path = itemId === undefined ? undefined : carrierPaths[itemId];
  return Object.freeze({
    ...trait,
    identity: path !== undefined && owner !== undefined && trait.identity.kind === "builtin"
      ? providerCarrierIdentity(owner, trait.identity.itemId)
      : trait.identity,
    displayPath: Object.freeze(path === undefined ? [...trait.displayPath] : path.split("::")),
    arguments: Object.freeze(trait.arguments.map((argument) =>
      materializeProviderGenericArgument(argument, carrierPaths, carrierTraits, owner, false))),
    associatedConstraints: Object.freeze(trait.associatedConstraints.map((constraint) =>
      constraint.kind === "equality"
        ? Object.freeze({
            ...constraint,
            arguments: Object.freeze(constraint.arguments.map((argument) =>
              materializeProviderGenericArgument(argument, carrierPaths, carrierTraits, owner, false))),
            type: materializeProviderCarrier(constraint.type, carrierPaths, carrierTraits, owner, false),
          })
        : Object.freeze({
            ...constraint,
            arguments: Object.freeze(constraint.arguments.map((argument) =>
              materializeProviderGenericArgument(argument, carrierPaths, carrierTraits, owner, false))),
            bounds: Object.freeze(constraint.bounds.map((bound) =>
              materializeBound(bound, carrierPaths, carrierTraits, owner, false))),
          }))),
  });
}

function materializeBound(
  bound: RustBound,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion"> | undefined,
  includeTraitImplementations = true,
): RustBound {
  switch (bound.kind) {
    case "trait":
      return Object.freeze({
        ...bound,
        trait: materializeTraitReference(bound.trait, carrierPaths, carrierTraits, owner),
      });
    case "type-outlives":
      return Object.freeze({
        ...bound,
        type: materializeProviderCarrier(bound.type, carrierPaths, carrierTraits, owner, includeTraitImplementations),
      });
    case "associated-equality": {
      const projection = materializeProviderCarrier(
        bound.projection,
        carrierPaths,
        carrierTraits,
        owner,
        includeTraitImplementations,
      );
      if (projection.kind !== "associated-type") {
        throw new Error("Rust provider associated equality changed semantic kind during materialization.");
      }
      return Object.freeze({
        ...bound,
        projection,
        value: materializeProviderCarrier(bound.value, carrierPaths, carrierTraits, owner, includeTraitImplementations),
      });
    }
    case "lifetime-outlives":
    case "precise-capture":
      return bound;
  }
}

function materializeTraitImplementations(
  implementations: readonly RustTraitImplementationEvidence[],
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
  owner: Pick<RustProviderOperationRow, "providerPackageId" | "providerId" | "providerVersion"> | undefined,
): readonly RustTraitImplementationEvidence[] {
  return Object.freeze(implementations.map((implementation) => Object.freeze({
    trait: materializeTraitReference(implementation.trait, carrierPaths, carrierTraits, owner),
    requirements: Object.freeze(implementation.requirements.map((requirement) => Object.freeze({
      typeArgumentIndex: requirement.typeArgumentIndex,
      trait: materializeTraitReference(requirement.trait, carrierPaths, carrierTraits, owner),
    }))),
  })));
}
