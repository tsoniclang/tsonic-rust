import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceDeclaredHeritageEdge } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  rustJsErrorTargetType,
  rustOptionTargetType,
  rustStringTargetType,
} from "../../target-model/types/index.js";
import type { RustSourceProfileRegistry } from "./source-profile.js";

export interface RustExternalProjectField {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly initializer:
    | { readonly kind: "string"; readonly value: string }
    | { readonly kind: "message"; readonly parameterIndex: number }
    | { readonly kind: "none" };
}

export interface RustExternalProjectBase {
  readonly id: "rust.source-profile.Error";
  readonly declaration: Node;
  readonly targetType: TargetTypeRef;
  readonly constructorOperationId: "tsonic.rust.error.constructor";
  readonly constructorPath: "rt::JsError::error";
  readonly constructorDeclarations: readonly Node[];
  readonly fields: readonly RustExternalProjectField[];
  readonly programError: true;
}

const errorFieldPolicy = Object.freeze([
  Object.freeze({ sourceName: "name", initializer: Object.freeze({ kind: "string" as const, value: "Error" }) }),
  Object.freeze({ sourceName: "message", initializer: Object.freeze({ kind: "message" as const, parameterIndex: 0 }) }),
  Object.freeze({ sourceName: "stack", initializer: Object.freeze({ kind: "none" as const }) }),
]);

export function resolveRustExternalProjectBase(
  edge: SourceDeclaredHeritageEdge,
  ast: AstReader,
  sourceProfiles: RustSourceProfileRegistry,
): RustExternalProjectBase | undefined {
  const valueDeclaration = edge.target.declaration;
  if (edge.kind !== "extends" || edge.target.project ||
    edge.selectedTypeArguments.length !== 0 || edge.typeArguments.length !== 0) return undefined;
  return resolveRustSourceErrorDeclaration(valueDeclaration, ast, sourceProfiles);
}

export function resolveRustSourceErrorDeclaration(
  valueDeclaration: Node,
  ast: AstReader,
  sourceProfiles: RustSourceProfileRegistry,
): RustExternalProjectBase | undefined {
  const profile = sourceProfiles.profileForNode(valueDeclaration, ast);
  const sourceFile = ast.getSourceFile(valueDeclaration);
  if (profile === undefined || sourceFile === undefined ||
    ast.kindName(valueDeclaration) !== "KindVariableDeclaration" ||
    ast.text(ast.name(valueDeclaration)) !== "Error" ||
    ast.variableDeclarationKind(valueDeclaration) !== "var" ||
    !isNamedTypeReference(ast.typeNode(valueDeclaration), "ErrorConstructor", ast)) {
    return undefined;
  }
  const errorDeclarations = ast.statements(sourceFile).filter((statement): statement is Node =>
    statement !== undefined &&
    ast.kindName(statement) === "KindInterfaceDeclaration" &&
    ast.text(ast.name(statement)) === "Error");
  const constructorDeclarations = ast.statements(sourceFile).filter((statement): statement is Node =>
    statement !== undefined &&
    ast.kindName(statement) === "KindInterfaceDeclaration" &&
    ast.text(ast.name(statement)) === "ErrorConstructor");
  if (errorDeclarations.length !== 1 || constructorDeclarations.length !== 1) {
    return undefined;
  }
  const declaration = errorDeclarations[0]!;
  const constructorDeclaration = constructorDeclarations[0]!;
  const nativeConstructors = ast.members(constructorDeclaration).filter((member): member is Node =>
    member !== undefined && ast.kindName(member) === "KindConstructSignature" &&
    isNamedTypeReference(ast.typeNode(member), "Error", ast));
  if (sourceProfiles.profileForNode(declaration, ast) !== profile ||
    sourceProfiles.profileForNode(constructorDeclaration, ast) !== profile ||
    ast.typeParameters(declaration).length !== 0 ||
    ast.typeParameters(constructorDeclaration).length !== 0 ||
    nativeConstructors.length !== 1) {
    return undefined;
  }
  const members = ast.members(declaration);
  if (members.some((member) => member === undefined)) {
    return undefined;
  }
  const fields: RustExternalProjectField[] = [];
  for (const [storageIndex, policy] of errorFieldPolicy.entries()) {
    const matches = (members as readonly Node[]).filter((member) =>
      ast.kindName(member) === "KindPropertySignature" &&
      ast.text(ast.name(member)) === policy.sourceName);
    if (matches.length !== 1) {
      return undefined;
    }
    fields.push(Object.freeze({
      declaration: matches[0]!,
      sourceName: policy.sourceName,
      storageIndex,
      carrier: policy.sourceName === "stack"
        ? rustOptionTargetType(rustStringTargetType())
        : rustStringTargetType(),
      initializer: policy.initializer,
    }));
  }
  return Object.freeze({
    id: "rust.source-profile.Error",
    declaration,
    targetType: rustJsErrorTargetType(),
    constructorOperationId: "tsonic.rust.error.constructor",
    constructorPath: "rt::JsError::error",
    constructorDeclarations: Object.freeze(nativeConstructors),
    fields: Object.freeze(fields),
    programError: true,
  });
}

function isNamedTypeReference(
  node: Node | undefined,
  name: string,
  ast: AstReader,
): boolean {
  if (node === undefined || ast.kindName(node) !== "KindTypeReference" ||
    ast.typeArguments(node).length !== 0) {
    return false;
  }
  const typeName = ast.as.AsTypeReferenceNode(node)?.TypeName;
  return ast.is.IsIdentifier(typeName) && ast.text(typeName) === name;
}
