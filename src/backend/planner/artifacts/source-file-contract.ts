import type { TargetArtifactDependency } from "@tsonic/target-api/artifacts";
import type {
  RustImplFunction,
  RustItem,
  RustSourceFileModel,
} from "../../target-ast/nodes.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import type {
  RustArtifactContractCandidate,
  RustArtifactFacet,
} from "./index.js";
import {
  encodeRustContractParts,
  rustFunctionSurface,
} from "./contracts.js";

export function rustSourceFileContractCandidate(
  owner: string,
  model: RustSourceFileModel,
  dependencies: readonly TargetArtifactDependency<RustArtifactFacet>[],
): RustArtifactContractCandidate {
  return {
    owner,
    contract: {
      facets: [
        {
          facet: "source-file-implementation",
          value: closedMetadataKey(model),
        },
        {
          facet: "source-file-public-surface",
          value: rustPublicSurface(model.items),
        },
      ],
    },
    dependencies,
    artifact: Object.freeze({ kind: "source-file", owner }),
  };
}

function rustPublicSurface(items: readonly RustItem[]): string {
  return encodeRustContractParts(items.flatMap(publicItemSurface));
}

function publicItemSurface(item: RustItem): readonly string[] {
  switch (item.kind) {
    case "function":
      return item.visibility === "public"
        ? [rustFunctionSurface({
            name: item.name,
            isAsync: item.isAsync === true,
            ...(item.errorType === undefined ? {} : { errorType: item.errorType }),
            generics: item.generics,
            parameters: item.params,
            ...(item.returnType === undefined
              ? {}
              : { returnType: item.returnType }),
          })]
        : [];
    case "const":
    case "thread-local":
    case "enum":
    case "type-alias":
      return item.visibility === "public" ? [closedMetadataKey(item)] : [];
    case "struct":
      return item.visibility === "public"
        ? [encodeRustContractParts([
            "struct",
            item.name,
            ...item.attrs ?? [],
            ...item.derives,
            encodeRustContractParts(["generics", closedMetadataKey(item.generics)]),
            ...item.fields.map((field) =>
              encodeRustContractParts([
                "field",
                field.name,
                field.visibility,
                closedMetadataKey(field.type),
              ])),
          ])]
        : [];
    case "trait":
      return item.visibility === "public" ? [closedMetadataKey(item)] : [];
    case "impl":
      if (item.trait !== undefined) {
        return [];
      }
      return item.functions
        .filter((fn) => fn.visibility === "public")
        .map((fn) => publicMethodSurface(closedMetadataKey(item.target), fn));
    case "mod-decl":
      return item.visibility === "public"
        ? [encodeRustContractParts(["module", item.name])]
        : [];
    case "extern-crate":
    case "use":
      return [];
  }
}

function publicMethodSurface(
  owner: string,
  method: RustImplFunction,
): string {
  return encodeRustContractParts([
    "method",
    owner,
    method.name,
    method.selfParam === undefined
      ? "static"
      : encodeRustContractParts(["self", closedMetadataKey(method.selfParam)]),
    encodeRustContractParts(["generics", closedMetadataKey(method.generics)]),
    method.errorType === undefined
      ? "infallible"
      : encodeRustContractParts(["fallible", closedMetadataKey(method.errorType)]),
    ...method.params.map((parameter, index) =>
      encodeRustContractParts([
        "parameter",
        String(index),
        parameter.name,
        closedMetadataKey(parameter.type),
      ])),
    encodeRustContractParts([
      "return",
      method.returnType === undefined
        ? "unit"
        : closedMetadataKey(method.returnType),
    ]),
  ]);
}
