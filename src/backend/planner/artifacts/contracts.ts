import type {
  TargetArtifactContract,
  TargetArtifactDependency,
} from "@tsonic/target-api/artifacts";
import type {
  RustFunctionParam,
  RustGenerics,
  RustType,
} from "../../target-ast/nodes.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

export type RustArtifactFacet =
  | "source-file-implementation"
  | "source-file-public-surface";

export interface RustArtifactSnapshot {
  readonly kind: "source-file";
  readonly owner: string;
}

export interface RustArtifactContractCandidate {
  readonly owner: string;
  readonly contract: TargetArtifactContract<RustArtifactFacet>;
  readonly dependencies: readonly TargetArtifactDependency<RustArtifactFacet>[];
  readonly artifact: RustArtifactSnapshot;
}

export function rustFunctionSurface(
  callable: {
    readonly name: string;
    readonly isAsync: boolean;
    readonly errorType?: RustType;
    readonly generics: RustGenerics;
    readonly parameters: readonly RustFunctionParam[];
    readonly returnType?: RustType;
  },
): string {
  return encodeRustContractParts([
    "source-callable",
    callable.name,
    callable.isAsync ? "async" : "sync",
    callable.errorType === undefined
      ? "infallible"
      : encodeRustContractParts(["fallible", closedMetadataKey(callable.errorType)]),
    encodeRustContractParts(["generics", closedMetadataKey(callable.generics)]),
    ...callable.parameters.map((parameter, index) =>
      encodeRustContractParts([
        "parameter",
        String(index),
        parameter.name,
        closedMetadataKey(parameter.type),
      ])),
    encodeRustContractParts([
      "return",
      callable.returnType === undefined
        ? "unit"
        : closedMetadataKey(callable.returnType),
    ]),
  ]);
}

export function encodeRustContractParts(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("");
}
