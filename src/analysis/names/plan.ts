import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustNamePlan } from "../../target-model/names/model.js";
import {
  rustScreamingSnakeIdentifier,
  rustSnakeCaseIdentifier,
  rustTargetIdentifier,
  isValidRustIdentifier,
  isValidRustAuthoredIdentifier,
} from "../../target-model/names/identifiers.js";
import { ObjectLiteralProperty_SourceName } from "@tsonic/target-api/source";
import type { RustRuntimeValueUsePlan } from "../program/runtime-value-uses.js";
import { rustSourceDeclarationTypeName } from "../../policy/types/source-declarations.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustPropertyStorageNames } from "../../target-model/names/property-storage.js";

type RustNameRole =
  | "module-value"
  | "type"
  | "type-parameter"
  | "value"
  | "variant";

interface RustNameCandidate {
  readonly declaration: Node;
  readonly scope: Node;
  readonly sourceName: string;
  readonly role: RustNameRole;
  readonly start: number;
  readonly end: number;
}

export function createRustNamePlan(input: {
  readonly ast: AstReader;
  readonly runtimeValueUses: RustRuntimeValueUsePlan;
  readonly sourceFiles: readonly SourceFile[];
}): RustNamePlan {
  const candidates: RustNameCandidate[] = [];
  for (const sourceFile of input.sourceFiles) {
    collectNameCandidates(
      sourceFile,
      sourceFile,
      input.ast,
      candidates,
    );
  }
  const names = new WeakMap<Node, string>();
  const functionNames = new WeakMap<Node, string>();
  const callableValueNames = new WeakMap<Node, string>();
  const declarationScopes = new WeakMap<Node, string>();
  const sourceTypeNames = new Map<string, string>();
  const diagnostics: TargetDiagnostic[] = [];
  const reservedNames = new Map<Node, Set<string>>();
  const privateNames = new Map<Node, Map<string, string>>();
  const propertyNames = new Map<Node, ReadonlyMap<string, string>>();
  const candidatesByScope = new Map<Node, RustNameCandidate[]>();
  for (const candidate of candidates) {
    const scoped = candidatesByScope.get(candidate.scope) ?? [];
    scoped.push(candidate);
    candidatesByScope.set(candidate.scope, scoped);
  }
  for (const [scope, scoped] of candidatesByScope) {
    const publicNames = scoped.filter(candidate =>
      input.ast.kindName(input.ast.name(candidate.declaration)) !== "KindPrivateIdentifier");
    const selected = rustPropertyStorageNames(publicNames.map(candidate => candidate.sourceName));
    propertyNames.set(scope, selected);
    reservedNames.set(scope, new Set(selected.values()));
  }
  for (const candidate of candidates) {
    const privateName = input.ast.kindName(input.ast.name(candidate.declaration)) === "KindPrivateIdentifier";
    const sourceNameNode = input.ast.name(candidate.declaration);
    const literalKey = sourceNameNode !== undefined &&
      (input.ast.is.IsStringLiteral(sourceNameNode) || input.ast.is.IsNumericLiteral(sourceNameNode));
    let name = rustTargetIdentifier(candidate.sourceName);
    if (literalKey) {
      name = propertyNames.get(candidate.scope)!.get(candidate.sourceName)!;
    }
    if (privateName) {
      const selected = privateNames.get(candidate.scope) ?? new Map<string, string>();
      name = selected.get(candidate.sourceName) ?? allocateRustGeneratedName(
        reservedNames.get(candidate.scope)!, candidate.sourceName.slice(1));
      selected.set(candidate.sourceName, name);
      privateNames.set(candidate.scope, selected);
    }
    names.set(candidate.declaration, name);
    if (!isValidRustIdentifier(name) || !privateName && !literalKey && !isValidRustAuthoredIdentifier(candidate.sourceName)) {
      diagnostics.push({
        code: "RUST_AUTHORED_IDENTIFIER_UNREPRESENTABLE",
        category: "error",
        source: "tsonic-rust",
        sourceNode: candidate.declaration,
        message: `Authored identifier '${candidate.sourceName}' cannot be preserved as a Rust identifier.`,
      });
    }
    if (candidate.role === "type") {
      const fileName = input.ast.getFileName(input.ast.getSourceFile(candidate.declaration));
      sourceTypeNames.set(sourceTypeIdentity(fileName, rustSourceDeclarationTypeName(candidate.declaration, input.ast)), name);
    }
  }
  const localClassesByFile = new Map<SourceFile, RustNameCandidate[]>();
  const moduleNamesByFile = new Map<SourceFile, Set<string>>();
  for (const candidate of candidates) {
    const sourceFile = input.ast.getSourceFile(candidate.declaration);
    if (sourceFile === undefined) continue;
    if (candidate.scope === sourceFile) {
      const used = moduleNamesByFile.get(sourceFile) ?? new Set<string>();
      const name = names.get(candidate.declaration);
      if (name !== undefined) used.add(name);
      moduleNamesByFile.set(sourceFile, used);
    }
    if ((input.ast.kindName(candidate.declaration) === "KindClassDeclaration" || input.ast.kindName(candidate.declaration) === "KindClassExpression") &&
      input.ast.parent(candidate.declaration) !== sourceFile) {
      const localClasses = localClassesByFile.get(sourceFile) ?? [];
      localClasses.push(candidate);
      localClassesByFile.set(sourceFile, localClasses);
    }
  }
  for (const [sourceFile, localClasses] of localClassesByFile) {
    const usedNames = moduleNamesByFile.get(sourceFile) ?? new Set<string>();
    for (const candidate of localClasses) {
      const parts = [candidate.sourceName];
      let owner = input.ast.parent(candidate.declaration);
      while (owner !== undefined && owner !== sourceFile) {
        if (isCallableScope(input.ast.kindName(owner)) || isMemberScope(input.ast.kindName(owner))) {
          const name = input.ast.name(owner);
          if (name !== undefined && input.ast.kindName(name) === "KindIdentifier") parts.unshift(input.ast.text(name));
        }
        owner = input.ast.parent(owner);
      }
      const scope = allocateRustGeneratedName(usedNames, rustSnakeCaseIdentifier(`${parts.join("_")}_scope`));
      const name = names.get(candidate.declaration)!;
      declarationScopes.set(candidate.declaration, scope);
      sourceTypeNames.set(sourceTypeIdentity(input.ast.getFileName(sourceFile),
        rustSourceDeclarationTypeName(candidate.declaration, input.ast)), `${scope}::${name}`);
    }
  }
  for (const candidate of candidates) {
    if (input.ast.kindName(candidate.scope) !== "KindSourceFile" ||
      (input.ast.kindName(candidate.declaration) !== "KindFunctionDeclaration" &&
        input.ast.kindName(candidate.declaration) !== "KindVariableDeclaration")) {
      continue;
    }
    const name = names.get(candidate.declaration);
    if (name !== undefined) {
      functionNames.set(candidate.declaration, name);
    }
  }
  const moduleValueNames = new Map<Node, Set<string>>();
  for (const candidate of candidates) {
    if (input.ast.kindName(candidate.scope) !== "KindSourceFile") {
      continue;
    }
    const used = moduleValueNames.get(candidate.scope) ?? new Set<string>();
    const name = names.get(candidate.declaration);
    if (name !== undefined) {
      used.add(name);
    }
    moduleValueNames.set(candidate.scope, used);
  }
  const topLevelCallables = candidates
    .filter((candidate) => input.ast.kindName(candidate.scope) === "KindSourceFile" &&
      (input.ast.kindName(candidate.declaration) === "KindFunctionDeclaration" ||
        input.ast.kindName(candidate.declaration) === "KindVariableDeclaration"))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  for (const candidate of topLevelCallables) {
    if (!input.runtimeValueUses.hasFirstClassUse(candidate.declaration)) {
      continue;
    }
    const used = moduleValueNames.get(candidate.scope) ?? new Set<string>();
    const base = `${rustScreamingSnakeIdentifier(candidate.sourceName)}_CALLABLE`;
    const valueName = allocateRustGeneratedName(used, base);
    moduleValueNames.set(candidate.scope, used);
    callableValueNames.set(candidate.declaration, valueName);
  }
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    nameForDeclaration(declaration: Node | undefined) {
      return declaration === undefined ? undefined : names.get(declaration);
    },
    functionNameForDeclaration(declaration: Node | undefined) {
      return declaration === undefined ? undefined : functionNames.get(declaration);
    },
    callableValueNameForDeclaration(declaration: Node | undefined) {
      return declaration === undefined ? undefined : callableValueNames.get(declaration);
    },
    scopeForDeclaration(declaration: Node | undefined) {
      return declaration === undefined ? undefined : declarationScopes.get(declaration);
    },
    nameForSourceType(fileName: string, sourceName: string) {
      return sourceTypeNames.get(sourceTypeIdentity(fileName, sourceName));
    },
  });
}

function sourceTypeIdentity(fileName: string, sourceName: string): string {
  return `${fileName.length}:${fileName}${sourceName.length}:${sourceName}`;
}

function collectNameCandidates(
  node: Node,
  sourceFile: SourceFile,
  ast: AstReader,
  candidates: RustNameCandidate[],
): void {
  const scope = declarationScope(node, sourceFile, ast);
  const role = scope === undefined
    ? undefined
    : declarationNameRole(node, scope, ast);
  if (role !== undefined && scope !== undefined) {
    const name = ast.name(node);
    const nameKind = name === undefined ? undefined : ast.kindName(name);
    const propertyName = ObjectLiteralProperty_SourceName(ast, node);
    const sourceName = ast.kindName(node) === "KindExportAssignment" &&
        ast.as.AsExportAssignment(node)?.IsExportEquals !== true
      ? "default"
      : name === undefined && ast.kindName(node) === "KindClassExpression"
        ? "Anonymous"
      : nameKind === "KindPrivateIdentifier"
        ? ast.text(name)
        : propertyName.kind === "resolved" ? propertyName.name : "";
    if (sourceName.length > 0) {
      candidates.push({
        declaration: node,
        scope,
        sourceName,
        role,
        start: ast.pos(node),
        end: ast.end(node),
      });
    }
  }
  ast.forEachChild(node, (child) => {
    if (child !== undefined) {
      collectNameCandidates(child, sourceFile, ast, candidates);
    }
  });
}

function declarationNameRole(
  declaration: Node,
  scope: Node,
  ast: AstReader,
): RustNameRole | undefined {
  switch (ast.kindName(declaration)) {
    case "KindClassDeclaration":
    case "KindClassExpression":
    case "KindEnumDeclaration":
    case "KindInterfaceDeclaration":
    case "KindTypeAliasDeclaration":
      return "type";
    case "KindTypeParameter":
      return "type-parameter";
    case "KindEnumMember":
      return "variant";
    case "KindVariableDeclaration":
      return ast.kindName(scope) === "KindSourceFile" ? "module-value" : "value";
    case "KindExportAssignment":
      return ast.kindName(scope) === "KindSourceFile" ? "module-value" : undefined;
    case "KindBindingElement":
    case "KindFunctionDeclaration":
    case "KindFunctionExpression":
    case "KindGetAccessor":
    case "KindMethodDeclaration":
    case "KindMethodSignature":
    case "KindParameter":
    case "KindPropertyDeclaration":
    case "KindPropertySignature":
    case "KindSetAccessor":
      return "value";
    default:
      return undefined;
  }
}

function declarationScope(
  declaration: Node,
  sourceFile: SourceFile,
  ast: AstReader,
): Node | undefined {
  const parent = ast.parent(declaration);
  if (ast.kindName(declaration) === "KindFunctionExpression" || ast.kindName(declaration) === "KindClassExpression") {
    return declaration;
  }
  if (parent !== undefined && isMemberScope(ast.kindName(parent))) {
    return parent;
  }
  if (ast.kindName(declaration) === "KindParameter" ||
    ast.kindName(declaration) === "KindTypeParameter") {
    return nearestScope(parent, sourceFile, ast, true);
  }
  return nearestScope(parent, sourceFile, ast, false);
}

function nearestScope(
  start: Node | undefined,
  sourceFile: SourceFile,
  ast: AstReader,
  callableOnly: boolean,
): Node | undefined {
  let current = start;
  while (current !== undefined) {
    const kind = ast.kindName(current);
    if (current === sourceFile || isCallableScope(kind) ||
      (!callableOnly && isLexicalScope(kind))) {
      return current;
    }
    current = ast.parent(current);
  }
  return undefined;
}

function isMemberScope(kind: string | undefined): boolean {
  return kind === "KindClassDeclaration" || kind === "KindClassExpression" || kind === "KindEnumDeclaration" ||
    kind === "KindInterfaceDeclaration";
}

function isCallableScope(kind: string | undefined): boolean {
  return kind === "KindArrowFunction" || kind === "KindConstructor" ||
    kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindGetAccessor" || kind === "KindMethodDeclaration" ||
    kind === "KindMethodSignature" || kind === "KindSetAccessor";
}

function isLexicalScope(kind: string | undefined): boolean {
  return kind === "KindBlock" || kind === "KindCaseBlock" ||
    kind === "KindCatchClause" || kind === "KindForInStatement" ||
    kind === "KindForOfStatement" || kind === "KindForStatement";
}
