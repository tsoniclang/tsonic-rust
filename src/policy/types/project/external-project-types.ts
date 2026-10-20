import type { Node } from "@tsonic/tsts";
import type { SourceDeclaredHeritageEdge } from "@tsonic/target-api/source";
import { rustJsErrorTargetType, rustOptionTargetType, rustStringTargetType } from "../../../target-model/types/index.js";
import type { RustSourceProfileRegistry } from "../model/source-profile.js";
import type { RustExternalProjectBase, RustExternalProjectField } from "../../../target-model/types/external-project-types.js";

const errorFieldPolicy = Object.freeze([
  Object.freeze({ sourceName: "name" as const, initializer: Object.freeze({ kind: "string" as const, value: "Error" }) }),
  Object.freeze({ sourceName: "message" as const, initializer: Object.freeze({ kind: "message" as const, parameterIndex: 0 }) }),
  Object.freeze({ sourceName: "stack" as const, initializer: Object.freeze({ kind: "none" as const }) }),
]);

export function resolveRustExternalProjectBase(
  edge: SourceDeclaredHeritageEdge,
  sourceProfiles: RustSourceProfileRegistry,
): RustExternalProjectBase | undefined {
  if (edge.kind !== "extends" || edge.target.project ||
    edge.selectedTypeArguments.length !== 0 || edge.typeArguments.length !== 0) return undefined;
  return resolveRustSourceErrorDeclaration(edge.target.declaration, sourceProfiles);
}

export function resolveRustSourceErrorDeclaration(
  valueDeclaration: Node,
  sourceProfiles: RustSourceProfileRegistry,
): RustExternalProjectBase | undefined {
  const contract = sourceProfiles.errorForDeclaration(valueDeclaration);
  if (contract === undefined) return undefined;
  const fields: RustExternalProjectField[] = errorFieldPolicy.map((policy, storageIndex) => Object.freeze({
    declaration: contract.fields[policy.sourceName],
    sourceName: policy.sourceName,
    storageIndex,
    carrier: policy.sourceName === "stack" ? rustOptionTargetType(rustStringTargetType()) : rustStringTargetType(),
    initializer: policy.initializer,
  }));
  return Object.freeze({
    id: "rust.source-profile.Error",
    declaration: contract.instance,
    targetType: rustJsErrorTargetType(),
    constructorOperationId: "tsonic.rust.error.constructor",
    constructorPath: "rt::JsError::error",
    constructorDeclarations: contract.constructors,
    fields: Object.freeze(fields),
    programError: true,
  });
}
