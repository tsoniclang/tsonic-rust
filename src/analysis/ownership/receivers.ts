import type { Node } from "@tsonic/tsts";
import { failTargetPlannerInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { createSourceStorageBudget, defaultSourceStorageLimits,
  type SourceStorageLimits, type SourceStorageQueries } from "@tsonic/target-api/analysis";
import { forEachSourceImmediateEvaluationChild } from "@tsonic/target-api/source";

interface ReceiverScope {
  readonly declaration: Node;
  readonly outer: ReceiverScope | undefined;
}

export function analyzeRustReceiverOccurrences(storage: SourceStorageQueries,
  limits?: Partial<SourceStorageLimits>):
  | { readonly kind: "resolved"; readonly occurrences: ReadonlyMap<Node, readonly Node[]> }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const { ast } = storage.source;
  const budget = createSourceStorageBudget({ ...defaultSourceStorageLimits, ...limits });
  const states = new Map<Node, { readonly scope: ReceiverScope | undefined; readonly ambient: boolean }>();
  const bodies = new Map<Node, ReceiverScope>();
  const evaluated = new Set<Node>(storage.sourceFiles);
  const occurrences = new Map<Node, Node[]>();
  const rejected = (): { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } => ({
    kind: "rejected", diagnostics: [{ code: "RUST_RECEIVER_OCCURRENCES_UNRESOLVED", category: "error",
      source: "tsonic-rust", message: budget.failure() ?? storage.failureReason() ??
        "Receiver ownership requires a complete checked source-node inventory.",
      evidence: ["target.capability=rust.analysis.ownership"] }],
  });
  if (storage.failureReason() !== undefined) return rejected();
  for (const node of storage.nodes) {
    if (!budget.node() || !budget.step()) return rejected();
    const parent = ast.parent(node);
    const inherited = parent === undefined ? undefined : states.get(parent);
    if (states.has(node) || !ast.is.IsSourceFile(node) && inherited === undefined) {
      return failTargetPlannerInvariant("tsonic-rust",
        "Receiver ownership requires unique checked nodes after their exact source parents.", node);
    }
    const ambient = inherited?.ambient === true || ast.modifiers(node).some(modifier =>
      modifier !== undefined && ast.kindName(modifier) === "KindDeclareKeyword") ||
      ast.is.IsSourceFile(node) && ast.isDeclarationFile(ast.getSourceFile(node));
    const scope = bodies.get(node) ?? inherited?.scope;
    const arrow = ast.is.IsArrowFunction(node);
    const callable = arrow || ast.is.IsFunctionDeclaration(node) || ast.is.IsFunctionExpression(node) ||
      ast.is.IsMethodDeclaration(node) || ast.is.IsGetAccessorDeclaration(node) ||
      ast.is.IsSetAccessorDeclaration(node) || ast.is.IsConstructorDeclaration(node);
    const classDeclaration = ast.is.IsClassDeclaration(node) || ast.is.IsClassExpression(node);
    states.set(node, { scope: callable && !arrow || classDeclaration ? undefined : scope, ambient });
    const body = callable ? ast.body(node) : undefined;
    if (body !== undefined && !ambient) {
      if (!budget.row()) return rejected();
      const selected = { declaration: node, outer: arrow ? scope : undefined };
      bodies.set(body, selected);
      occurrences.set(node, []);
      evaluated.add(body);
    }
    if (ambient || !evaluated.has(node)) continue;
    const kind = ast.kindName(node);
    if (kind === "KindThisKeyword" || kind === "KindThisExpression") {
      for (let selected = scope; selected !== undefined; selected = selected.outer) {
        if (!budget.step() || !budget.row()) return rejected();
        occurrences.get(selected.declaration)!.push(node);
      }
    }
    forEachSourceImmediateEvaluationChild(ast, node, child => {
      if (budget.step()) evaluated.add(child);
    });
    if (budget.failure() !== undefined) return rejected();
  }
  return { kind: "resolved", occurrences: new Map([...occurrences].map(([declaration, references]) =>
    [declaration, Object.freeze(references)])) };
}
