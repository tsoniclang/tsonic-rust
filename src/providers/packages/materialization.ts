import {
  rustFixedArrayCarrierValue,
  rustFixedArrayTargetType,
  rustMoveOnlyNamedTypeTraits,
  rustNamedTargetType,
  rustNamedTypeCarrierValue,
} from "../../target-model/types/index.js";
import type { RustNamedTypeTraitContract } from "../../target-model/types/model.js";
import type {
  RustProviderBinaryEpilogueDefinition,
  RustProviderBinaryEpilogueRow,
  RustProviderOperationDefinition,
  RustProviderOperationRow,
} from "./model.js";
import type { RustProviderOperationForm, RustValueConversion } from "../../target-model/operations/model.js";
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
  if (form.form === "call-ref-slice" || form.form === "free-call-ref-slice") {
    return {
      ...form,
      path: expandProviderPath(form.path, aliases),
      elementCarrier: materializeProviderCarrier(form.elementCarrier, carrierPaths, carrierTraits),
    };
  }
  if (form.form === "call-str-slice" || form.form === "free-call-str-slice" ||
    form.form === "path" || form.form === "static") {
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
      traitTypeArguments: form.traitTypeArguments.map((argument) =>
        materializeProviderCarrier(argument, carrierPaths, carrierTraits)),
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
    const typeArguments = named.typeArguments.map((argument) =>
      materializeProviderCarrier(argument, carrierPaths, carrierTraits));
    const path = carrierPaths[named.id];
    const traits = carrierTraits[named.id];
    return rustNamedTargetType(
      named.id,
      path ?? named.path,
      typeArguments,
      traits ?? named.traits,
    );
  }
  if (carrier.kind === "target-named") {
    const typeArguments = (carrier.typeArguments ?? []).map((argument) =>
      materializeProviderCarrier(argument, carrierPaths, carrierTraits));
    const path = carrierPaths[carrier.id];
    const traits = carrierTraits[carrier.id];
    return path === undefined
      ? { ...carrier, ...(typeArguments.length === 0 ? {} : { typeArguments }) }
      : rustNamedTargetType(carrier.id, path, typeArguments, traits ?? rustMoveOnlyNamedTypeTraits);
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
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  return fixedArray === undefined
    ? carrier
    : rustFixedArrayTargetType(materializeProviderCarrier(fixedArray.element, carrierPaths, carrierTraits), fixedArray.length);
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
