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
  RustProviderBinaryEpilogueDefinition,
  RustProviderBinaryEpilogueRow,
  RustProviderOperationDefinition,
  RustProviderOperationRow,
} from "./model.js";
import type {
  RustProviderGenericParameter,
  RustProviderOperationForm,
  RustValueConversion,
} from "../../target-model/operations/model.js";
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
    target: materializeProviderOperationForm(row.target, aliases, carrierPaths, carrierTraits),
    resultCarrier: materializeProviderCarrier(row.resultCarrier, carrierPaths, carrierTraits),
    ...(row.receiverCarrier === undefined
      ? {}
      : { receiverCarrier: materializeProviderCarrier(row.receiverCarrier, carrierPaths, carrierTraits) }),
    ...(row.parameterCarriers === undefined
      ? {}
      : { parameterCarriers: row.parameterCarriers.map((carrier) => materializeProviderCarrier(carrier, carrierPaths, carrierTraits)) }),
    ...(row.genericParameters === undefined
      ? {}
      : {
          genericParameters: row.genericParameters.map((parameter) =>
            materializeProviderGenericParameter(parameter, carrierPaths, carrierTraits)),
        }),
    ...(row.targetGenericArguments === undefined
      ? {}
      : {
          targetGenericArguments: materializeProviderGenericArguments(
            row.targetGenericArguments,
            carrierPaths,
            carrierTraits,
          ),
        }),
    ...(row.resultConversion === undefined
      ? {}
      : {
          resultConversion: materializeProviderValueConversion(
            row.resultConversion,
            carrierPaths,
            carrierTraits,
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
        carrier: materializeProviderCarrier(argument.carrier, carrierPaths, carrierTraits),
      })),
      elementCarrier: materializeProviderCarrier(form.elementCarrier, carrierPaths, carrierTraits),
    };
  }
  if (form.form === "receiver-tagged-array") {
    return {
      ...form,
      leadingArguments: form.leadingArguments.map((argument) => ({
        ...argument,
        carrier: materializeProviderCarrier(argument.carrier, carrierPaths, carrierTraits),
      })),
      elementCarrier: materializeProviderCarrier(form.elementCarrier, carrierPaths, carrierTraits),
      alternatives: form.alternatives.map((alternative) => ({
        ...alternative,
        inputCarrier: materializeProviderCarrier(alternative.inputCarrier, carrierPaths, carrierTraits),
        constructorPath: expandProviderPath(alternative.constructorPath, aliases),
      })),
    };
  }
  if (form.form === "call-str-slice" || form.form === "free-call-str-slice" || form.form === "path" ||
    form.form === "static") {
    return { ...form, path: expandProviderPath(form.path, aliases) };
  }
  if (form.form === "binary-operator") {
    return { ...form, trait: expandProviderPath(form.trait, aliases) };
  }
  if (form.form === "trait-call" || form.form === "trait-associated-value") {
    return {
      ...form,
      owner: materializeProviderCarrier(form.owner, carrierPaths, carrierTraits),
      traitPath: expandProviderPath(form.traitPath, aliases),
      traitGenericArguments: materializeProviderGenericArguments(
        form.traitGenericArguments,
        carrierPaths,
        carrierTraits,
      ),
    };
  }
  if (form.form === "associated-value") {
    return {
      ...form,
      owner: materializeProviderCarrier(form.owner, carrierPaths, carrierTraits),
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
): TargetTypeRef {
  const named = rustNamedTypeCarrierValue(carrier);
  if (named !== undefined) {
    const genericArguments = materializeProviderGenericArguments(
      named.genericArguments,
      carrierPaths,
      carrierTraits,
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
      ),
      traits ?? named.traits,
    );
  }
  if (carrier.kind === "target-named") {
    const genericArguments = materializeProviderGenericArguments(
      carrier.genericArguments ?? [],
      carrierPaths,
      carrierTraits,
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
          traits ?? rustMoveOnlyNamedTypeTraits,
        );
  }
  if (carrier.kind === "array") {
    return { ...carrier, element: materializeProviderCarrier(carrier.element, carrierPaths, carrierTraits) };
  }
  if (carrier.kind === "slice") {
    return { ...carrier, element: materializeProviderCarrier(carrier.element, carrierPaths, carrierTraits) };
  }
  if (carrier.kind === "tuple") {
    return { ...carrier, elements: carrier.elements.map((element) => materializeProviderCarrier(element, carrierPaths, carrierTraits)) };
  }
  if (carrier.kind === "reference") {
    return { ...carrier, referent: materializeProviderCarrier(carrier.referent, carrierPaths, carrierTraits) };
  }
  if (carrier.kind === "pointer") {
    return { ...carrier, pointee: materializeProviderCarrier(carrier.pointee, carrierPaths, carrierTraits) };
  }
  if (carrier.kind === "function-pointer") {
    return {
      ...carrier,
      args: carrier.args.map((argument) => materializeProviderCarrier(argument, carrierPaths, carrierTraits)),
      result: materializeProviderCarrier(carrier.result, carrierPaths, carrierTraits),
    };
  }
  if (carrier.kind === "closure") {
    return {
      ...carrier,
      args: carrier.args.map((argument) =>
        materializeProviderCarrier(argument, carrierPaths, carrierTraits)),
      result: materializeProviderCarrier(carrier.result, carrierPaths, carrierTraits),
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
      ),
      associatedConstraints: carrier.associatedConstraints.map((constraint) =>
        constraint.kind === "equality"
          ? {
              ...constraint,
              genericArguments: materializeProviderGenericArguments(
                constraint.genericArguments,
                carrierPaths,
                carrierTraits,
              ),
              type: materializeProviderCarrier(
                constraint.type,
                carrierPaths,
                carrierTraits,
              ),
            }
          : {
              ...constraint,
              genericArguments: materializeProviderGenericArguments(
                constraint.genericArguments,
                carrierPaths,
                carrierTraits,
              ),
              traits: constraint.traits.map((trait) =>
                materializeProviderTraitRef(trait, carrierPaths, carrierTraits)),
            }),
    };
  }
  if (carrier.kind === "trait-object") {
    return {
      ...carrier,
      principal: materializeProviderTraitRef(carrier.principal, carrierPaths, carrierTraits),
      autoTraits: carrier.autoTraits.map((trait) =>
        materializeProviderTraitRef(trait, carrierPaths, carrierTraits)),
    };
  }
  if (carrier.kind === "impl-trait") {
    return {
      ...carrier,
      bounds: carrier.bounds.map((bound) =>
        materializeProviderTraitRef(bound, carrierPaths, carrierTraits)),
    };
  }
  if (carrier.kind === "associated-type") {
    return {
      ...carrier,
      owner: materializeProviderCarrier(carrier.owner, carrierPaths, carrierTraits),
      ...(carrier.trait === undefined
        ? {}
        : { trait: materializeProviderTraitRef(carrier.trait, carrierPaths, carrierTraits) }),
      ...(carrier.genericArguments === undefined
        ? {}
        : {
            genericArguments: materializeProviderGenericArguments(
              carrier.genericArguments,
              carrierPaths,
              carrierTraits,
            ),
          }),
    };
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  return fixedArray === undefined
    ? carrier
    : rustFixedArrayTargetType(materializeProviderCarrier(fixedArray.element, carrierPaths, carrierTraits), fixedArray.length);
}

function materializeProviderTraitRef(
  trait: RustTargetTraitRef,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
): RustTargetTraitRef {
  const materialized = materializeProviderCarrier(trait, carrierPaths, carrierTraits);
  if (materialized.kind !== "trait-ref") {
    throw new Error("Rust provider trait materialization changed the exact target trait carrier kind.");
  }
  return materialized;
}

function materializeProviderGenericArguments(
  arguments_: readonly RustTargetGenericArgument[],
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
): readonly RustTargetGenericArgument[] {
  return Object.freeze(arguments_.map((argument): RustTargetGenericArgument =>
    argument.kind === "type"
      ? {
          kind: "type",
          type: materializeProviderCarrier(argument.type, carrierPaths, carrierTraits),
        }
      : argument));
}

export function materializeProviderGenericParameter(
  parameter: RustProviderGenericParameter,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
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
    )[0]!,
  });
}

function materializeProviderValueConversion(
  conversion: RustValueConversion,
  carrierPaths: Readonly<Record<string, string>>,
  carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>,
): RustValueConversion {
  switch (conversion.kind) {
    case "copy-from-reference":
      return {
        ...conversion,
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits),
      };
    case "raw-pointer-mut-to-const":
      return {
        ...conversion,
        pointee: materializeProviderCarrier(conversion.pointee, carrierPaths, carrierTraits),
      };
    case "source-union-variant":
    case "bottom-coercion":
    case "js-argument-vector-callback":
      return {
        ...conversion,
        source: materializeProviderCarrier(conversion.source, carrierPaths, carrierTraits),
        target: materializeProviderCarrier(conversion.target, carrierPaths, carrierTraits),
      };
    case "option-some":
      return {
        ...conversion,
        element: materializeProviderCarrier(conversion.element, carrierPaths, carrierTraits),
      };
    case "option-map":
      return {
        ...conversion,
        elementConversion: materializeProviderValueConversion(
          conversion.elementConversion,
          carrierPaths,
          carrierTraits,
        ) as typeof conversion.elementConversion,
      };
    case "semantic-conversion":
    case "numeric-promotion":
      return conversion;
  }
}
