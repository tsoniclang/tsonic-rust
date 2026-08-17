import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api";
import {
  rustPascalCaseIdentifier,
  rustScreamingSnakeIdentifier,
  rustSnakeCaseIdentifier,
} from "./rust-identifiers.js";

export interface RustNamePlan {
  nameForDeclaration(declaration: Node | undefined): string | undefined;
  functionNameForDeclaration(declaration: Node | undefined): string | undefined;
  nameForSourceType(fileName: string, sourceName: string): string | undefined;
}

type RustNameRole =
  | "module-value"
  | "type"
  | "type-parameter"
  | "unused-value"
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
  readonly navigation: SourceProgramNavigation;
  readonly sourceFiles: readonly SourceFile[];
}): RustNamePlan {
  const candidates: RustNameCandidate[] = [];
  for (const sourceFile of input.sourceFiles) {
    collectNameCandidates(
      sourceFile,
      sourceFile,
      input.ast,
      input.navigation,
      candidates,
    );
  }
  const names = new WeakMap<Node, string>();
  const functionNames = new WeakMap<Node, string>();
  const sourceTypeNames = new Map<string, string>();
  const scopes = groupCandidates(candidates);
  for (const bases of scopes.values()) {
    for (const [base, sourceGroups] of bases) {
      const orderedGroups = [...sourceGroups.entries()].sort(([left], [right]) =>
        compareSourceNames(left, right, base));
      orderedGroups.forEach(([sourceName, group], index) => {
        const name = index === 0 ? base : `${base}_${index + 1}`;
        for (const candidate of group) {
          names.set(candidate.declaration, name);
          if (candidate.role === "type") {
            const fileName = input.ast.getFileName(input.ast.getSourceFile(candidate.declaration));
            sourceTypeNames.set(sourceTypeIdentity(fileName, sourceName), name);
          }
        }
      });
    }
  }
  const reservedFunctionNames = new Map<Node, Set<string>>();
  for (const candidate of candidates) {
    if (input.ast.kindName(candidate.scope) !== "KindSourceFile" ||
      input.ast.kindName(candidate.declaration) !== "KindFunctionDeclaration") {
      continue;
    }
    const name = names.get(candidate.declaration);
    if (name !== undefined) {
      functionNames.set(candidate.declaration, name);
      const reserved = reservedFunctionNames.get(candidate.scope) ?? new Set<string>();
      reserved.add(name);
      reservedFunctionNames.set(candidate.scope, reserved);
    }
  }
  const moduleValueCandidates = candidates
    .filter((candidate) => input.ast.kindName(candidate.scope) === "KindSourceFile" &&
      input.ast.kindName(candidate.declaration) === "KindVariableDeclaration")
    .map((candidate): RustNameCandidate => ({ ...candidate, role: "value" }));
  for (const [scope, bases] of groupCandidates(moduleValueCandidates)) {
    const reserved = reservedFunctionNames.get(scope) ?? new Set<string>();
    for (const [base, sourceGroups] of bases) {
      const orderedGroups = [...sourceGroups.entries()].sort(([left], [right]) =>
        compareSourceNames(left, right, base));
      let suffix = 1;
      orderedGroups.forEach(([, group]) => {
        let name = suffix === 1 ? base : `${base}_${suffix}`;
        while (reserved.has(name)) {
          suffix += 1;
          name = `${base}_${suffix}`;
        }
        reserved.add(name);
        suffix += 1;
        for (const candidate of group) {
          functionNames.set(candidate.declaration, name);
        }
      });
    }
  }
  return Object.freeze({
    nameForDeclaration(declaration: Node | undefined) {
      return declaration === undefined ? undefined : names.get(declaration);
    },
    functionNameForDeclaration(declaration: Node | undefined) {
      return declaration === undefined ? undefined : functionNames.get(declaration);
    },
    nameForSourceType(fileName: string, sourceName: string) {
      return sourceTypeNames.get(sourceTypeIdentity(fileName, sourceName));
    },
  });
}

function groupCandidates(
  candidates: readonly RustNameCandidate[],
): Map<Node, Map<string, Map<string, RustNameCandidate[]>>> {
  const scopes = new Map<Node, Map<string, Map<string, RustNameCandidate[]>>>();
  for (const candidate of candidates) {
    const base = rustNameBase(candidate.sourceName, candidate.role);
    const bases = scopes.get(candidate.scope) ?? new Map<string, Map<string, RustNameCandidate[]>>();
    const sourceGroups = bases.get(base) ?? new Map<string, RustNameCandidate[]>();
    const group = sourceGroups.get(candidate.sourceName) ?? [];
    group.push(candidate);
    sourceGroups.set(candidate.sourceName, group);
    bases.set(base, sourceGroups);
    scopes.set(candidate.scope, bases);
  }
  return scopes;
}

function sourceTypeIdentity(fileName: string, sourceName: string): string {
  return `${fileName.length}:${fileName}${sourceName.length}:${sourceName}`;
}

function collectNameCandidates(
  node: Node,
  sourceFile: SourceFile,
  ast: AstReader,
  navigation: SourceProgramNavigation,
  candidates: RustNameCandidate[],
): void {
  const scope = declarationScope(node, sourceFile, ast);
  const declaredRole = scope === undefined
    ? undefined
    : declarationNameRole(node, scope, ast);
  const role = declaredRole === "value" &&
      ast.kindName(node) === "KindParameter" &&
      parameterIsUnused(node, scope, ast, navigation)
    ? "unused-value"
    : declaredRole;
  if (role !== undefined && scope !== undefined) {
    const name = ast.name(node);
    const nameKind = name === undefined ? undefined : ast.kindName(name);
    const sourceName = ast.kindName(node) === "KindExportAssignment" &&
        ast.as.AsExportAssignment(node)?.IsExportEquals !== true
      ? "default"
      : name === undefined ||
          (nameKind !== "KindIdentifier" && nameKind !== "KindPrivateIdentifier")
        ? ""
        : ast.text(name);
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
      collectNameCandidates(child, sourceFile, ast, navigation, candidates);
    }
  });
}

function parameterIsUnused(
  parameter: Node,
  callable: Node | undefined,
  ast: AstReader,
  navigation: SourceProgramNavigation,
): boolean {
  const body = callable === undefined ? undefined : ast.body(callable);
  const name = ast.name(parameter);
  const reference = navigation.sourceReferenceFor(name);
  return body !== undefined &&
    name !== undefined &&
    reference?.declaration === parameter &&
    navigation.referencesWithin(reference.symbol, body).length === 0;
}

function declarationNameRole(
  declaration: Node,
  scope: Node,
  ast: AstReader,
): RustNameRole | undefined {
  switch (ast.kindName(declaration)) {
    case "KindClassDeclaration":
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
  if (ast.kindName(declaration) === "KindFunctionExpression") {
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
  return kind === "KindClassDeclaration" || kind === "KindEnumDeclaration" ||
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

function rustNameBase(sourceName: string, role: RustNameRole): string {
  if (role === "type" || role === "type-parameter" || role === "variant") {
    return rustPascalCaseIdentifier(sourceName);
  }
  if (role === "module-value") {
    return rustScreamingSnakeIdentifier(sourceName);
  }
  if (role === "unused-value") {
    return `_${rustSnakeCaseIdentifier(sourceName)}`;
  }
  return rustSnakeCaseIdentifier(sourceName);
}

function compareSourceNames(left: string, right: string, base: string): number {
  if (left === base) {
    return right === base ? 0 : -1;
  }
  if (right === base) {
    return 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}
