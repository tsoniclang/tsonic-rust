import type {
  Node,
  ProviderVirtualDeclarationFact,
  SourceAnalysisContext,
  SourceFileQueries,
  Symbol,
} from "@tsonic/tsts";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import { rustSourceSemanticsExtensionId } from "../identity.js";

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
  appendSelectedProviderTypeFacts(candidates, typeName, context);
  return oneProviderTypeIdentity(candidates);
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
  const signatureDeclaration = context.checker.getSignatureDeclaration(
    selection.selectedSignature,
  );
  const declaration = signatureDeclaration === undefined
    ? undefined
    : readRustSourceFact(
        context,
        signatureDeclaration,
        providerVirtualDeclarationFactKey,
      );
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
    extensionId: rustSourceSemanticsExtensionId,
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

function appendSelectedProviderTypeFacts(
  candidates: ProviderVirtualDeclarationFact[],
  typeName: Node,
  context: RustSourceFileAnalysisContext,
): void {
  const symbols: Symbol[] = [];
  const seen = new Set<Symbol>();
  const appendSymbol = (symbol: Symbol | undefined): void => {
    if (symbol === undefined || seen.has(symbol)) return;
    seen.add(symbol);
    symbols.push(symbol);
  };
  appendSymbol(context.checker.getSymbolAtLocation(typeName));
  appendSymbol(context.checker.getResolvedSymbolOrNil(typeName));

  for (const symbol of symbols) {
    appendProviderFact(candidates, symbol, context);
    const declarations = context.checker.getSymbolDeclarations(symbol);
    for (const declaration of declarations) {
      appendProviderFact(candidates, declaration, context);
    }
    if (declarations.some((declaration) => isAliasDeclaration(declaration, context))) {
      appendSymbol(context.checker.getAliasedSymbol(symbol));
    }
  }
}

function isAliasDeclaration(
  declaration: Node | undefined,
  context: Pick<RustSourceFileAnalysisContext, "ast">,
): boolean {
  return declaration !== undefined && (
    context.ast.is.IsImportClause(declaration) ||
    context.ast.is.IsImportSpecifier(declaration) ||
    context.ast.is.IsNamespaceImport(declaration) ||
    context.ast.is.IsExportSpecifier(declaration)
  );
}

function oneProviderTypeIdentity(
  candidates: readonly ProviderVirtualDeclarationFact[],
): ProviderVirtualDeclarationFact | undefined {
  const unique = new Map<string, ProviderVirtualDeclarationFact>();
  for (const candidate of candidates) {
    if (candidate.memberId !== undefined || candidate.signatureId !== undefined ||
      candidate.exportId === undefined) {
      continue;
    }
    const key = [
      candidate.providerId,
      candidate.providerVersion,
      candidate.providerModuleId,
      candidate.moduleSpecifier,
      candidate.exportId,
    ].join("\0");
    unique.set(key, candidate);
  }
  return unique.size === 1 ? unique.values().next().value : undefined;
}
