import type { AstReader, Node } from "@tsonic/tsts";
import { isDenseDataArray } from "../../policy/model/closed-data.js";

export interface RustProjectObjectField {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly storageIndex: number;
}

export interface RustProjectObjectIndexSignature {
  readonly declaration: Node;
  readonly keyParameter: Node;
}

export interface RustProjectObjectLayout {
  readonly declaration: Node;
  readonly kind: "class" | "interface";
  readonly fields: readonly RustProjectObjectField[];
  readonly indexSignatures: readonly RustProjectObjectIndexSignature[];
}

export interface RustProjectStaticFieldStorage {
  readonly declaration: Node;
  readonly fileName: string;
  readonly targetName: string;
}

export function rustProjectObjectLayout(
  declaration: Node,
  ast: AstReader,
): RustProjectObjectLayout | undefined {
  const kind = ast.kindName(declaration);
  const objectKind = kind === "KindClassDeclaration"
    ? "class" as const
    : kind === "KindInterfaceDeclaration"
      ? "interface" as const
      : undefined;
  if (objectKind === undefined) {
    return undefined;
  }
  const members = ast.members(declaration);
  if (!isDenseDataArray(members) || members.some((member) => member === undefined)) {
    return undefined;
  }
  const fields: RustProjectObjectField[] = [];
  const indexSignatures: RustProjectObjectIndexSignature[] = [];
  const seen = new Set<string>();
  for (const member of members as readonly Node[]) {
    const memberKind = ast.kindName(member);
    const isField = objectKind === "class"
      ? memberKind === "KindPropertyDeclaration" && !ast.hasModifierKind(member, "static")
      : memberKind === "KindPropertySignature";
    if (objectKind === "interface" && memberKind === "KindIndexSignature") {
      const parameters = ast.parameters(member);
      const keyParameter = parameters.length === 1 ? parameters[0] : undefined;
      if (keyParameter === undefined) {
        return undefined;
      }
      indexSignatures.push({ declaration: member, keyParameter });
      continue;
    }
    if (!isField) {
      continue;
    }
    const nameNode = ast.name(member);
    const sourceName = nameNode === undefined ? "" : ast.text(nameNode);
    if (sourceName.length === 0 || seen.has(sourceName)) {
      return undefined;
    }
    seen.add(sourceName);
    fields.push({ declaration: member, sourceName, storageIndex: fields.length });
  }
  return {
    declaration,
    kind: objectKind,
    fields: Object.freeze(fields),
    indexSignatures: Object.freeze(indexSignatures),
  };
}

export function rustProjectObjectField(
  declaration: Node,
  ast: AstReader,
): RustProjectObjectField | undefined {
  const owner = ast.parent(declaration);
  return owner === undefined
    ? undefined
    : rustProjectObjectLayout(owner, ast)?.fields.find((field) => field.declaration === declaration);
}

export function rustProjectObjectIndexSignature(
  declaration: Node,
  ast: AstReader,
): RustProjectObjectIndexSignature | undefined {
  const owner = ast.parent(declaration);
  return owner === undefined
    ? undefined
    : rustProjectObjectLayout(owner, ast)?.indexSignatures.find((index) =>
        index.declaration === declaration);
}

export function rustProjectStaticFieldStorage(
  declaration: Node,
  ast: AstReader,
  targetName: string | undefined,
): RustProjectStaticFieldStorage | undefined {
  if (ast.kindName(declaration) !== "KindPropertyDeclaration" ||
    !ast.hasModifierKind(declaration, "static")) {
    return undefined;
  }
  const owner = ast.parent(declaration);
  if (owner === undefined || ast.kindName(owner) !== "KindClassDeclaration") {
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
