import type { Node } from "@tsonic/tsts";
import type {
  TargetArtifactContract,
  TargetArtifactDependency,
} from "@tsonic/target-api";
import type {
  RustFunctionParam,
  RustType,
  RustTypeParameter,
} from "../../backend/rust-ast/nodes.js";
import { closedMetadataKey } from "../../common/closed-metadata.js";
import type { TargetTypeRef } from "../../policy/types.js";
import { printRustType } from "../../print/rust-printer.js";

export type RustArtifactFacet =
  | "source-callable-surface"
  | "source-file-implementation"
  | "source-file-public-surface";

export interface RustSourceCallableContract {
  readonly sourceDeclaration: Node;
  readonly sourceTypeArguments?: readonly TargetTypeRef[];
  readonly name: string;
  readonly isAsync: boolean;
  readonly fallible: boolean;
  readonly typeParameters: readonly RustTypeParameter[];
  readonly parameters: readonly RustFunctionParam[];
  readonly returnType?: RustType;
}

export type RustArtifactSnapshot =
  | {
      readonly kind: "source-callable";
      readonly contract: RustSourceCallableContract;
    }
  | {
      readonly kind: "source-file";
      readonly owner: string;
    };

export interface RustArtifactContractCandidate {
  readonly owner: string;
  readonly contract: TargetArtifactContract<RustArtifactFacet>;
  readonly dependencies: readonly TargetArtifactDependency<RustArtifactFacet>[];
  readonly artifact: RustArtifactSnapshot;
}

export function rustSourceCallableContractCandidate(
  owner: string,
  callable: RustSourceCallableContract,
): RustArtifactContractCandidate {
  return {
    owner,
    contract: {
      facets: [{
        facet: "source-callable-surface",
        value: rustSourceCallableSurface(callable),
      }],
    },
    dependencies: Object.freeze([]),
    artifact: Object.freeze({
      kind: "source-callable",
      contract: callable,
    }),
  };
}

export function rustSourceCallableSurface(
  callable: RustSourceCallableContract,
): string {
  return rustFunctionSurface({
    name: callable.name,
    isAsync: callable.isAsync,
    fallible: callable.fallible,
    typeParameters: callable.typeParameters,
    parameters: callable.parameters,
    identityParts: [
      callable.sourceTypeArguments === undefined
        ? "open-source-callable"
        : `closed-source-callable:${closedMetadataKey(callable.sourceTypeArguments)}`,
    ],
    ...(callable.returnType === undefined
      ? {}
      : { returnType: callable.returnType }),
  });
}

export function rustFunctionSurface(
  callable: {
    readonly name: string;
    readonly isAsync: boolean;
    readonly fallible: boolean;
    readonly typeParameters: readonly RustTypeParameter[];
    readonly parameters: readonly RustFunctionParam[];
    readonly returnType?: RustType;
    readonly identityParts?: readonly string[];
  },
): string {
  return encodeRustContractParts([
    "source-callable",
    callable.name,
    callable.isAsync ? "async" : "sync",
    callable.fallible ? "fallible" : "infallible",
    ...(callable.identityParts ?? []),
    ...callable.typeParameters.map((parameter) =>
      encodeRustContractParts([
        "type-parameter",
        parameter.name,
        ...parameter.bounds.map((bound) =>
          encodeRustContractParts([
            bound.kind,
            bound.kind === "trait" ? bound.path : bound.name,
          ])),
      ])),
    ...callable.parameters.map((parameter, index) =>
      encodeRustContractParts([
        "parameter",
        String(index),
        parameter.name,
        printRustType(parameter.type),
      ])),
    encodeRustContractParts([
      "return",
      callable.returnType === undefined
        ? "unit"
        : printRustType(callable.returnType),
    ]),
  ]);
}

export function encodeRustContractParts(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("");
}
