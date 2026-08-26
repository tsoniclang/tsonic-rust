import type {
  RustProviderBinaryEpilogueDefinition,
  RustProviderBinaryEpilogueRow,
  RustProviderOperationDefinition,
  RustProviderOperationRow,
} from "./model.js";
import type { RustProviderOperationForm } from "../../target-model/operations/model.js";

export function materializeProviderOperationRow(
  row: RustProviderOperationDefinition,
  aliases: ReadonlyMap<string, string>,
  owner: Pick<
    RustProviderOperationRow,
    "providerPackageId" | "providerId" | "providerVersion" | "providerModuleId" | "moduleSpecifier"
  >,
): RustProviderOperationRow {
  return {
    ...row,
    ...owner,
    target: materializeProviderOperationForm(row.target, aliases),
    ...(row.immediateCallback === undefined
      ? {}
      : {
          immediateCallback: {
            ...row.immediateCallback,
            fallibleTarget: materializeProviderOperationForm(
              row.immediateCallback.fallibleTarget,
              aliases,
            ),
          },
        }),
  };
}

export function materializeProviderBinaryEpilogueRow(
  epilogue: RustProviderBinaryEpilogueDefinition,
  aliases: ReadonlyMap<string, string>,
  owner: Pick<RustProviderBinaryEpilogueRow, "providerPackageId" | "providerVersion">,
): RustProviderBinaryEpilogueRow {
  return {
    ...epilogue,
    ...owner,
    path: expandProviderPath(epilogue.path, aliases),
  };
}

function materializeProviderOperationForm(
  form: RustProviderOperationForm,
  aliases: ReadonlyMap<string, string>,
): RustProviderOperationForm {
  switch (form.form) {
    case "call":
    case "call-c-variadic":
    case "free-call":
    case "call-str-slice":
    case "free-call-str-slice":
    case "path":
    case "static":
    case "static-reference":
    case "struct-variant":
    case "call-value-slice":
    case "call-value-array":
      return { ...form, path: expandProviderPath(form.path, aliases) };
    case "receiver-tagged-array":
      return {
        ...form,
        alternatives: form.alternatives.map((alternative) => ({
          ...alternative,
          constructorPath: expandProviderPath(alternative.constructorPath, aliases),
        })),
      };
    case "binary-operator":
      return { ...form, trait: expandProviderPath(form.trait, aliases) };
    default:
      return form;
  }
}

export function expandProviderPath(
  path: string,
  aliases: ReadonlyMap<string, string>,
): string {
  const separator = path.indexOf("::");
  const root = separator < 0 ? path : path.slice(0, separator);
  const replacement = aliases.get(root);
  return replacement === undefined
    ? path
    : separator < 0
      ? replacement
      : `${replacement}${path.slice(separator)}`;
}
