import type { AstReader, Node } from "@tsonic/tsts";
import { sourceClassFieldIsTypeOnly, sourceObjectMemberDeclarations, sourceParameterIsProperty } from "@tsonic/target-api/source";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import type { RustProjectObjectField, RustProjectObjectIndexSignature, RustProjectObjectLayout } from "../../target-model/types/project-types.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";

import type { RustProjectStaticFieldStorage } from "../../target-model/records/objects/project-fields.js";

export function rustProjectObjectLayout(
  declaration: Node,
  ast: AstReader,
  semanticsFor: (node: Node) => SourceFileSemantics,
): RustProjectObjectLayout | undefined {
  const kind = ast.kindName(declaration);
  const objectKind = kind === "KindClassDeclaration" || kind === "KindClassExpression"
    ? "class" as const
    : kind === "KindInterfaceDeclaration"
      ? "interface" as const
      : undefined;
  if (objectKind === undefined) {
    return undefined;
  }
  const members = sourceObjectMemberDeclarations(ast, declaration);
  if (!isDenseDataArray(members) || members.some((member) => member === undefined)) {
    return undefined;
  }
  const fields: RustProjectObjectField[] = [];
  const indexSignatures: RustProjectObjectIndexSignature[] = [];
  const seen = new Set<string>();
  for (const member of members as readonly Node[]) {
    if (sourceClassFieldIsTypeOnly(ast, member)) continue;
    const memberKind = ast.kindName(member);
    const isField = objectKind === "class"
      ? (memberKind === "KindPropertyDeclaration" || sourceParameterIsProperty(ast, member)) &&
        !ast.hasModifierKind(member, "static")
      : memberKind === "KindPropertySignature";
    if (objectKind === "interface" && memberKind === "KindIndexSignature") {
      const parameters = ast.parameters(member);
      const keyParameter = parameters.length === 1 ? parameters[0] : undefined;
      if (keyParameter === undefined) {
        return undefined;
      }
      indexSignatures.push(Object.freeze({ declaration: member, keyParameter }));
      continue;
    }
    if (!isField) {
      continue;
    }
    const nameNode = ast.name(member);
    if (nameNode === undefined) return undefined;
    const nameKind = ast.kindName(nameNode);
    switch (nameKind) {
      case "KindIdentifier":
      case "KindPrivateIdentifier":
      case "KindStringLiteral":
      case "KindNumericLiteral":
      case "KindComputedPropertyName":
        break;
      default:
        return undefined;
    }
    const selected = nameKind === "KindComputedPropertyName" || nameKind === "KindNumericLiteral"
      ? semanticsFor(member).propertyNames.get(nameNode) : undefined;
    const sourceName = nameKind === "KindComputedPropertyName" || nameKind === "KindNumericLiteral"
      ? selected?.kind === "resolved" ? selected.name : undefined : ast.text(nameNode);
    if (sourceName === undefined || seen.has(sourceName)) {
      return undefined;
    }
    seen.add(sourceName);
    fields.push(Object.freeze({ declaration: member, sourceName, storageIndex: fields.length,
      presence: ast.questionToken(member) === undefined ? "required" : "optional" }));
  }
  return Object.freeze({
    declaration,
    kind: objectKind,
    fields: Object.freeze(fields),
    indexSignatures: Object.freeze(indexSignatures),
  });
}

export function rustProjectObjectField(
  declaration: Node,
  projectTypes: Pick<RustProjectTypePolicy, "definitionContainingDeclaration" | "objectLayoutForDefinition">,
): RustProjectObjectField | undefined {
  const owner = projectTypes.definitionContainingDeclaration(declaration);
  return owner === undefined
    ? undefined
    : projectTypes.objectLayoutForDefinition(owner)?.fields.find((field) => field.declaration === declaration);
}

export function rustProjectObjectIndexSignature(
  declaration: Node,
  projectTypes: Pick<RustProjectTypePolicy, "definitionContainingDeclaration" | "objectLayoutForDefinition">,
): RustProjectObjectIndexSignature | undefined {
  const owner = projectTypes.definitionContainingDeclaration(declaration);
  return owner === undefined
    ? undefined
    : projectTypes.objectLayoutForDefinition(owner)?.indexSignatures.find((index) =>
        index.declaration === declaration);
}

export function rustProjectStaticFieldStorage(
  declaration: Node,
  ast: AstReader,
  targetName: string | undefined,
): RustProjectStaticFieldStorage | undefined {
  if (ast.kindName(declaration) !== "KindPropertyDeclaration" ||
    sourceClassFieldIsTypeOnly(ast, declaration) ||
    !ast.hasModifierKind(declaration, "static")) {
    return undefined;
  }
  const owner = ast.parent(declaration);
  if (owner === undefined || (ast.kindName(owner) !== "KindClassDeclaration" && ast.kindName(owner) !== "KindClassExpression")) {
    return undefined;
  }
  const sourceFile = ast.getSourceFile(declaration);
  const fileName = ast.getFileName(sourceFile);
  if (fileName.length === 0 || targetName === undefined) {
    return undefined;
  }
  return {
    declaration,
    fileName,
    targetName,
  };
}
