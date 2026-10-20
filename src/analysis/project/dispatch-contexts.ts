import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { isDenseDataArray, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { RustProviderDispatchContextRow } from "../../target-model/metadata/provider-metadata.js";
import type { RustDispatchContextProjection, RustResolvedDispatchContextInput } from "../../target-model/operations/dispatch-contexts.js";
import { isRustDispatchContextInput } from "../../target-model/operations/dispatch-contexts.js";

export interface RustDispatchContextAccess {
  readonly rootContextId: string;
  readonly projections: readonly RustDispatchContextProjection[];
}

export interface RustDispatchContextComposition {
  readonly rootContextIds: readonly string[];
  access(contextId: string): RustDispatchContextAccess | undefined;
}

export interface RustDispatchContextCompositionRequests {
  readonly demandedContextIds: readonly string[];
  readonly accessContextIds: readonly string[];
}

export interface RustDispatchContextDeclarations {
  readonly contexts: readonly RustProviderDispatchContextRow[];
  declaration(contextId: string): RustProviderDispatchContextRow | undefined;
}

export interface RustDispatchContextCatalog extends RustDispatchContextDeclarations {
  readonly declarations: RustDispatchContextDeclarations;
  resolveInput(input: unknown): RustResolvedDispatchContextInput | undefined;
  compose(requests: RustDispatchContextCompositionRequests): AnalyzeRustDispatchContextResult<RustDispatchContextComposition>;
}

export type AnalyzeRustDispatchContextResult<Plan> =
  | { readonly kind: "resolved"; readonly plan: Plan }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

type ContextAccessNode =
  | { readonly kind: "root"; readonly contextId: string }
  | { readonly kind: "projection"; readonly parent: ContextAccessNode; readonly project: RustDispatchContextProjection };

export function analyzeRustDispatchContextCatalog(
  rows: readonly RustProviderDispatchContextRow[],
  activeCrateNames: readonly string[],
): AnalyzeRustDispatchContextResult<RustDispatchContextCatalog> {
  const activeCrates = new Set(activeCrateNames);
  const contexts = snapshotClosedMetadata(rows.filter(row => activeCrates.has(row.requiredCrate))
    .sort((left, right) => left.id.localeCompare(right.id, "en")));
  const byId = new Map<string, RustProviderDispatchContextRow>();
  for (const row of contexts) {
    if (byId.has(row.id)) return rejected(`Dispatch context '${row.id}' has more than one declaration owner.`);
    byId.set(row.id, row);
  }
  const parents = new Map<string, { readonly contextId: string; readonly project: RustDispatchContextProjection }[]>();
  const remainingParents = new Map(contexts.map(context => [context.id, 0]));
  for (const context of contexts) {
    for (const child of context.composedContexts) {
      if (!byId.has(child.contextId)) {
        return rejected(`Dispatch context '${context.id}' composes unavailable context '${child.contextId}'.`);
      }
      const incoming = parents.get(child.contextId) ?? [];
      incoming.push({ contextId: context.id, project: child.project });
      parents.set(child.contextId, incoming);
      remainingParents.set(child.contextId, (remainingParents.get(child.contextId) ?? 0) + 1);
    }
  }
  const ready = contexts.filter(context => remainingParents.get(context.id) === 0).map(context => context.id);
  const topologicalOrder: string[] = [];
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const contextId = ready[cursor]!;
    topologicalOrder.push(contextId);
    for (const child of byId.get(contextId)!.composedContexts) {
      const remaining = remainingParents.get(child.contextId)! - 1;
      remainingParents.set(child.contextId, remaining);
      if (remaining === 0) ready.push(child.contextId);
    }
  }
  if (topologicalOrder.length !== contexts.length) return rejected("Dispatch context composition contains a cycle.");
  const declarations: RustDispatchContextDeclarations = Object.freeze({ contexts,
    declaration: (contextId: string) => byId.get(contextId) });
  const catalog: RustDispatchContextCatalog = Object.freeze({
    ...declarations, declarations,
    resolveInput(input: unknown): RustResolvedDispatchContextInput | undefined {
      if (!isRustDispatchContextInput(input)) return undefined;
      const context = byId.get(input.contextId);
      const carrier = input.view === "root" ? context?.rootCarrier : context?.handleCarrier;
      return carrier === undefined ? undefined : snapshotClosedMetadata({
        ...input,
        carrier,
      });
    },
    compose: (requests: RustDispatchContextCompositionRequests) =>
      composeContexts(requests, topologicalOrder, parents, byId),
  });
  return { kind: "resolved", plan: catalog };
}

function composeContexts(
  requests: RustDispatchContextCompositionRequests,
  topologicalOrder: readonly string[],
  parents: ReadonlyMap<string, readonly { readonly contextId: string; readonly project: RustDispatchContextProjection }[]>,
  byId: ReadonlyMap<string, RustProviderDispatchContextRow>,
): AnalyzeRustDispatchContextResult<RustDispatchContextComposition> {
  const descriptors = requests === null || typeof requests !== "object" || Array.isArray(requests)
    ? undefined : Object.getOwnPropertyDescriptors(requests);
  const demandedContextIds: unknown = descriptors?.demandedContextIds !== undefined && "value" in descriptors.demandedContextIds
    ? descriptors.demandedContextIds.value : undefined;
  const accessContextIds: unknown = descriptors?.accessContextIds !== undefined && "value" in descriptors.accessContextIds
    ? descriptors.accessContextIds.value : undefined;
  if (!isDenseDataArray(demandedContextIds) || !isDenseDataArray(accessContextIds) ||
    demandedContextIds.some(id => typeof id !== "string" || !byId.has(id)) ||
    accessContextIds.some(id => typeof id !== "string" || !byId.has(id))) {
    return rejected("Dispatch context demand must select exact available context identities.");
  }
  const demanded = new Set(demandedContextIds);
  const access = new Map<string, ContextAccessNode>();
  const published = new Map<string, RustDispatchContextAccess>();
  const ambiguous = new Set<string>();
  const rootContextIds: string[] = [];
  for (const contextId of topologicalOrder) {
    let inherited: ContextAccessNode | undefined;
    for (const parent of parents.get(contextId) ?? []) {
      if (ambiguous.has(parent.contextId)) {
        ambiguous.add(contextId);
        continue;
      }
      const parentAccess = access.get(parent.contextId);
      if (parentAccess === undefined) continue;
      if (inherited !== undefined) {
        ambiguous.add(contextId);
        continue;
      }
      inherited = {
        kind: "projection", parent: parentAccess, project: parent.project,
      };
    }
    if (ambiguous.has(contextId)) {
      return rejected(`Dispatch context '${contextId}' has ambiguous physical root projections.`);
    }
    if (inherited !== undefined) {
      access.set(contextId, inherited);
    } else if (demanded.has(contextId)) {
      rootContextIds.push(contextId);
      access.set(contextId, { kind: "root", contextId });
    }
  }
  for (const contextId of new Set(accessContextIds as readonly string[])) {
    let node = access.get(contextId);
    if (node === undefined) continue;
    const projections: RustDispatchContextProjection[] = [];
    while (node.kind === "projection") {
      projections.push(node.project);
      node = node.parent;
    }
    published.set(contextId, Object.freeze({ rootContextId: node.contextId,
      projections: Object.freeze(projections.reverse()) }));
  }
  return {
    kind: "resolved",
    plan: Object.freeze({
      rootContextIds: Object.freeze(rootContextIds),
      access: (contextId: string) => published.get(contextId),
    }),
  };
}

function rejected(message: string): AnalyzeRustDispatchContextResult<never> {
  return { kind: "rejected", diagnostics: Object.freeze([{
    code: "RUST_DISPATCH_CONTEXT_INVALID", category: "error", source: "tsonic-rust", message,
    evidence: ["rust.runtime.dispatch-context"],
  }]) };
}
