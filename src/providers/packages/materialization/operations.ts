import type { RustNamedTypeTraitContract } from "../../../target-model/types/model.js";
import type { RustProviderBinaryHookDefinition, RustProviderBinaryHookRow, RustProviderDispatchContextRow } from "../../../target-model/metadata/provider-metadata.js";
import type { RustProviderOperationDefinition, RustProviderOperationRow, RustProviderTypeDefinition } from "../../../target-model/identities/provider-relations.js";
import type { RustProviderOperationForm } from "../../../target-model/operations/model.js";

import { materializeProviderCarrier, materializeProviderGenericArguments, materializeProviderGenericParameter } from "./carriers.js";
import { materializeProviderValueConversion } from "./conversions.js";
import type { RustDispatchContextDefinition } from "../../../target-model/operations/dispatch-contexts.js";

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
    ? form.argConversions.map(conversion => conversion === undefined ? undefined : materializeProviderValueConversion(conversion, carrierPaths, carrierTraits, typeDeclarations))
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
    return { ...form, indexConversion: materializeProviderValueConversion(form.indexConversion, carrierPaths, carrierTraits, typeDeclarations) };
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
