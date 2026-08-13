import type {
  TargetArtifactDependency,
} from "@tsonic/target-api";
import type {
  RustImplFunction,
  RustItem,
  RustSourceFileModel,
} from "../rust-ast/nodes.js";
import {
  printRustItem,
  printRustSourceFile,
  printRustType,
} from "../../print/rust-printer.js";
import type {
  RustArtifactContractCandidate,
  RustArtifactFacet,
} from "../../translate/artifacts/index.js";
import {
  encodeRustContractParts,
  rustFunctionSurface,
} from "../../translate/artifacts/contracts.js";

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
          value: printRustSourceFile(model),
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
            fallible: item.fallible === true,
            typeParameters: item.typeParams ?? [],
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
      return item.visibility === "public" ? [printRustItem(item)] : [];
    case "struct":
      return item.visibility === "public"
        ? [encodeRustContractParts([
            "struct",
            item.name,
            ...item.attrs ?? [],
            ...item.derives,
            ...(item.typeParams ?? []).map((parameter) =>
              encodeRustContractParts([
                "type-parameter",
                parameter.name,
                ...parameter.bounds.map((bound) =>
                  bound.kind === "trait" ? bound.path : `'${bound.name}`),
              ])),
            ...item.fields.map((field) =>
              encodeRustContractParts([
                "field",
                field.name,
                field.visibility,
                printRustType(field.type),
              ])),
          ])]
        : [];
    case "trait":
      return item.visibility === "public" ? [printRustItem(item)] : [];
    case "impl":
      if (item.trait !== undefined) {
        return [];
      }
      return item.functions
        .filter((fn) => fn.visibility === "public")
        .map((fn) => publicMethodSurface(printRustType(item.target), fn));
    case "mod-decl":
      return item.visibility === "public"
        ? [encodeRustContractParts(["module", item.name])]
        : [];
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
    method.selfParam ?? "static",
    method.fallible === true ? "fallible" : "infallible",
    ...method.params.map((parameter, index) =>
      encodeRustContractParts([
        "parameter",
        String(index),
        parameter.name,
        printRustType(parameter.type),
      ])),
    encodeRustContractParts([
      "return",
      method.returnType === undefined
        ? "unit"
        : printRustType(method.returnType),
    ]),
  ]);
}
