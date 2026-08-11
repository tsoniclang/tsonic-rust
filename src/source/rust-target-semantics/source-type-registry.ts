import type {
  AstReader,
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  KindStringLiteral,
  Node_Type,
} from "../../common/source-ast.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
} from "../rust-target-types.js";

export interface RustSourceEnumVariant {
  readonly name: string;
  readonly literal: string;
}

export interface RustSourceTypeRegistry {
  registerSourceFile(sourceFile: SourceFile, ast: AstReader): void;
  carrierForDeclaration(declaration: Node, ast: AstReader): TargetTypeRef | undefined;
  declarationForCarrier(carrier: TargetTypeRef): Node | undefined;
  propertyKeysForCarrier(carrier: TargetTypeRef, ast: AstReader): readonly string[] | undefined;
  enumVariantsForDeclaration(declaration: Node): readonly RustSourceEnumVariant[] | undefined;
  enumVariantForLiteral(carrier: TargetTypeRef, literal: string): RustSourceEnumVariant | undefined;
}

export function createRustSourceTypeRegistry(): RustSourceTypeRegistry {
  const declarations = new Map<string, Node>();
  const variantsByDeclaration = new Map<Node, readonly RustSourceEnumVariant[]>();

  const keyForCarrier = (carrier: TargetTypeRef): string | undefined => {
    const value = rustSourceTypeCarrierValue(carrier);
    return value === undefined ? undefined : `${value.fileName}::${value.typeName}`;
  };

  const carrierForDeclaration = (declaration: Node, ast: AstReader): TargetTypeRef | undefined => {
    const sourceFile = ast.getSourceFile(declaration);
    const fileName = ast.getFileName(sourceFile);
    if (fileName.length === 0 || ast.isDeclarationFile(sourceFile)) {
      return undefined;
    }
    const kind = ast.kindName(declaration);
    const shape = kind === "KindClassDeclaration" || kind === "KindInterfaceDeclaration"
      ? "object"
      : kind === "KindEnumDeclaration" ||
          (kind === "KindTypeAliasDeclaration" && variantsByDeclaration.has(declaration))
        ? "enum"
        : undefined;
    const typeName = ast.text(ast.name(declaration));
    return shape === undefined || typeName.length === 0
      ? undefined
      : rustSourceTypeCarrier(fileName, typeName, shape);
  };

  return {
    registerSourceFile(sourceFile, ast) {
      const fileName = ast.getFileName(sourceFile);
      if (fileName.length === 0 || ast.isDeclarationFile(sourceFile)) {
        return;
      }
      const statements = ast.statements(sourceFile);
      if (!isDenseDataArray(statements) || statements.some((declaration) => declaration === undefined)) {
        return;
      }
      for (const declaration of statements as readonly Node[]) {
        if (ast.kindName(declaration) === "KindTypeAliasDeclaration") {
          const variants = closedStringUnionVariants(declaration, ast);
          if (variants !== undefined) {
            variantsByDeclaration.set(declaration, variants);
          }
        }
        const carrier = carrierForDeclaration(declaration, ast);
        const key = carrier === undefined ? undefined : keyForCarrier(carrier);
        if (key !== undefined) {
          declarations.set(key, declaration);
        }
      }
    },
    carrierForDeclaration,
    declarationForCarrier(carrier) {
      const key = keyForCarrier(carrier);
      return key === undefined ? undefined : declarations.get(key);
    },
    propertyKeysForCarrier(carrier, ast) {
      const key = keyForCarrier(carrier);
      const declaration = key === undefined ? undefined : declarations.get(key);
      if (declaration === undefined ||
        (ast.kindName(declaration) !== "KindInterfaceDeclaration" &&
          ast.kindName(declaration) !== "KindClassDeclaration") ||
        ast.extendsHeritageElements(declaration).length !== 0) {
        return undefined;
      }
      const declarationKind = ast.kindName(declaration);
      const members = denseNodes(ast.members(declaration));
      if (members === undefined) {
        return undefined;
      }
      const keys: string[] = [];
      const seen = new Set<string>();
      for (const member of members) {
        const kind = ast.kindName(member);
        if ((declarationKind === "KindInterfaceDeclaration" && kind === "KindPropertySignature") ||
          (declarationKind === "KindClassDeclaration" && kind === "KindPropertyDeclaration")) {
          if (ast.hasModifierKind(member, "static")) {
            continue;
          }
          const nameNode = ast.name(member);
          const name = nameNode === undefined ? "" : ast.text(nameNode);
          if (name.length === 0 || seen.has(name)) {
            return undefined;
          }
          seen.add(name);
          keys.push(name);
          continue;
        }
        if (declarationKind === "KindClassDeclaration" &&
          (kind === "KindConstructor" || kind === "KindMethodDeclaration" ||
            kind === "KindGetAccessor" || kind === "KindSetAccessor")) {
          continue;
        }
        return undefined;
      }
      return Object.freeze(keys);
    },
    enumVariantsForDeclaration(declaration) {
      return variantsByDeclaration.get(declaration);
    },
    enumVariantForLiteral(carrier, literal) {
      const key = keyForCarrier(carrier);
      const declaration = key === undefined ? undefined : declarations.get(key);
      return declaration === undefined
        ? undefined
        : variantsByDeclaration.get(declaration)?.find((variant) => variant.literal === literal);
    },
  };
}

function closedStringUnionVariants(
  declaration: Node,
  ast: AstReader,
): readonly RustSourceEnumVariant[] | undefined {
  const aliasType = Node_Type(ast, declaration);
  if (aliasType === undefined || ast.kindName(aliasType) !== "KindUnionType") {
    return undefined;
  }
  const aliasChildren = denseNodes(ast.children(aliasType));
  if (aliasChildren === undefined) {
    return undefined;
  }
  const members: Node[] = [];
  for (const child of aliasChildren) {
    if (ast.kindName(child) === "KindSyntaxList") {
      const entries = denseNodes(ast.children(child));
      if (entries === undefined) {
        return undefined;
      }
      members.push(...entries);
    } else {
      members.push(child);
    }
  }
  const semanticMembers = members.filter((child) => !ast.kindName(child).endsWith("Token"));
  const variants: RustSourceEnumVariant[] = [];
  for (const member of semanticMembers) {
    const literalNode = ast.kindName(member) === "KindLiteralType"
      ? ast.children(member)[0]
      : undefined;
    if (literalNode === undefined || ast.kindName(literalNode) !== KindStringLiteral) {
      return undefined;
    }
    const literal = ast.text(literalNode);
    const name = rustVariantName(literal);
    if (name === undefined || variants.some((variant) => variant.name === name)) {
      return undefined;
    }
    variants.push({ name, literal });
  }
  return variants.length === 0 ? undefined : variants;
}

function denseNodes(values: readonly (Node | undefined)[]): readonly Node[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly Node[]
    : undefined;
}

function rustVariantName(literal: string): string | undefined {
  const cleaned = literal.replace(/[^A-Za-z0-9]+([A-Za-z0-9])/gu, (_, character: string) => character.toUpperCase());
  if (cleaned.length === 0 || /^[0-9]/u.test(cleaned)) {
    return undefined;
  }
  return cleaned[0]!.toUpperCase() + cleaned.slice(1);
}
