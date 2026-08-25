import type {
  Node,
  ProviderVirtualDeclarationFact,
  Symbol,
  SourceAnalysisContext,
  SourceFileQueries,
} from "@tsonic/tsts";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";

export interface RustSourceFileAnalysisContext extends SourceFileQueries {
  readonly facts: SourceAnalysisContext["facts"];
  readonly factResolver: SourceAnalysisContext["factResolver"];
  readonly diagnostics: SourceAnalysisContext["diagnostics"];
}

export function forEachRustSourceFile(
  context: SourceAnalysisContext,
  visitor: (context: RustSourceFileAnalysisContext) => void,
): void {
  for (const sourceFile of context.source.getSourceFiles()) {
    if (sourceFile === undefined || context.source.ast.isDeclarationFile(sourceFile)) {
      continue;
    }
    visitor({
      ...context.source.getSourceFileQueries(sourceFile),
      facts: context.facts,
      factResolver: context.factResolver,
      diagnostics: context.diagnostics,
    });
  }
}

export function visitRustSourcePostOrder(
  node: Node | undefined,
  context: Pick<RustSourceFileAnalysisContext, "ast">,
  visitor: (node: Node) => void,
  seen: Set<Node> = new Set(),
): void {
  if (node === undefined || seen.has(node)) return;
  seen.add(node);
  for (const child of context.ast.children(node)) {
    visitRustSourcePostOrder(child ?? undefined, context, visitor, seen);
  }
  visitor(node);
}

export function selectedRustProviderTypeDeclaration(
  typeReference: Node,
  context: RustSourceFileAnalysisContext,
): ProviderVirtualDeclarationFact | undefined {
  if (!context.ast.is.IsTypeReferenceNode(typeReference)) return undefined;
  const typeName = context.ast.as.AsTypeReferenceNode(typeReference)?.TypeName;
  if (typeName === undefined) return undefined;
  const candidates: ProviderVirtualDeclarationFact[] = [];
  appendProviderFact(candidates, typeReference, context);
  appendProviderFact(candidates, typeName, context);

  const symbols = new Set<Symbol>();
  const selectedSymbol = context.checker.getResolvedSymbolOrNil(typeName) ??
    context.checker.getSymbolAtLocation(typeName);
  if (selectedSymbol !== undefined) {
    symbols.add(selectedSymbol);
    const aliased = hasAliasDeclaration(selectedSymbol, context)
      ? context.checker.getAliasedSymbol(selectedSymbol)
      : undefined;
    if (aliased !== undefined) symbols.add(aliased);
    for (const root of context.checker.getRootSymbols(selectedSymbol)) {
      if (root !== undefined) symbols.add(root);
    }
  }
  for (const symbol of symbols) {
    appendProviderFact(candidates, symbol, context);
    for (const declaration of context.checker.getSymbolDeclarations(symbol)) {
      appendProviderFact(candidates, declaration, context);
    }
  }
  return oneProviderTypeIdentity(candidates);
}

function hasAliasDeclaration(
  symbol: Symbol,
  context: RustSourceFileAnalysisContext,
): boolean {
  return context.checker.getSymbolDeclarations(symbol).some((declaration) => {
    let current = declaration;
    for (let depth = 0; current !== undefined && depth < 3; depth += 1) {
      if (context.ast.is.IsImportClause(current) ||
        context.ast.is.IsImportSpecifier(current) ||
        context.ast.is.IsNamespaceImport(current) ||
        context.ast.is.IsExportSpecifier(current)) {
        return true;
      }
      current = context.ast.parent(current);
    }
    return false;
  });
}

export function selectedRustProviderCall(
  call: Node,
  context: RustSourceFileAnalysisContext,
): {
  readonly selection: NonNullable<ReturnType<RustSourceFileAnalysisContext["checker"]["getResolvedCallInfo"]>>;
  readonly declaration: ProviderVirtualDeclarationFact;
} | undefined {
  if (!context.ast.is.IsCallExpression(call) && !context.ast.is.IsNewExpression(call)) {
    return undefined;
  }
  const selection = context.checker.getResolvedCallInfo(call);
  if (selection?.outcome !== "applicable") return undefined;
  const signatureDeclaration = context.checker.getSignatureDeclaration(selection.selectedSignature);
  const declaration = signatureDeclaration === undefined
    ? undefined
    : readRustSourceFact(context, signatureDeclaration, providerVirtualDeclarationFactKey);
  return declaration === undefined ? undefined : { selection, declaration };
}

export function readRustSourceFact<T>(
  context: Pick<RustSourceFileAnalysisContext, "facts" | "factResolver">,
  subject: object | undefined,
  key: import("@tsonic/tsts").ExtensionFactKey<T>,
): T | undefined {
  return subject === undefined
    ? undefined
    : context.facts.get(subject, key) ?? context.factResolver.resolve(subject, key);
}

export function appendRustSourceDiagnostic(
  context: RustSourceFileAnalysisContext,
  node: Node,
  code: string,
  number: number,
  message: string,
  evidence: readonly import("@tsonic/tsts").ExtensionEvidence[] = [],
): void {
  const sourceFile = context.ast.getSourceFile(node);
  context.diagnostics.append({
    extensionId: "tsonic.rust.source-semantics",
    extensionCode: code,
    numericCode: number,
    publicCode: `TSONIC_RUST_${number}`,
    category: "error",
    message,
    nodeOrSpan: node,
    ...(evidence.length === 0 ? {} : { evidence }),
    identity: [
      "rust-source",
      code,
      context.ast.getPath(sourceFile),
      context.ast.pos(node),
      context.ast.end(node),
    ].join(":"),
  });
}

function appendProviderFact(
  candidates: ProviderVirtualDeclarationFact[],
  subject: object | undefined,
  context: RustSourceFileAnalysisContext,
): void {
  const fact = readRustSourceFact(context, subject, providerVirtualDeclarationFactKey);
  if (fact !== undefined) candidates.push(fact);
}

function oneProviderTypeIdentity(
  candidates: readonly ProviderVirtualDeclarationFact[],
): ProviderVirtualDeclarationFact | undefined {
  const typeCandidates = candidates.filter((candidate) =>
    candidate.memberId === undefined && candidate.signatureId === undefined &&
    candidate.exportId !== undefined);
  const first = typeCandidates[0];
  if (first === undefined) return undefined;
  return typeCandidates.every((candidate) =>
    candidate.providerId === first.providerId &&
    candidate.providerVersion === first.providerVersion &&
    candidate.providerModuleId === first.providerModuleId &&
    candidate.moduleSpecifier === first.moduleSpecifier &&
    candidate.exportId === first.exportId)
    ? first
    : undefined;
}
