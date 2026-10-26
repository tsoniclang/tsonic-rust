import type { SourceStorageProjection, SourceStorageSubjectSelection } from "@tsonic/target-api/analysis";
import type { RustSourceStorageResolution, RustTargetTypeResolutionContext } from "./model.js";
import type { Node } from "@tsonic/tsts";

export function rustSourceStorageScope(
  context: Pick<RustTargetTypeResolutionContext, "sourceStorage">,
  node: Node,
  declaration?: Node,
): RustSourceStorageResolution {
  const selected = context.sourceStorage.bindingsForLexicalOwner(declaration ?? node);
  return selected.kind === "unresolved" ? selected
    : { kind: "resolved", subject: undefined, bindings: selected.bindings };
}

export function rustSourceStorageSubjectContext<Context extends RustTargetTypeResolutionContext>(
  context: Context,
  selection: SourceStorageSubjectSelection | undefined,
): Context {
  const current = context.sourceStorageResolution;
  if (selection === undefined) return { ...context, callableRepresentation: "signature", sourceStorageResolution: current?.kind === "resolved"
    ? { ...current, subject: undefined } : current };
  if (selection.kind === "unresolved") return { ...context, sourceStorageResolution: selection };
  const scope = current ?? rustSourceStorageScope(context, selection.subject.node);
  if (scope.kind === "unresolved") return { ...context, sourceStorageResolution: scope };
  return { ...context, sourceStorageResolution:
    { kind: "resolved", subject: selection.subject, bindings: scope.bindings } };
}

export function rustSourceStorageContext(
  context: RustTargetTypeResolutionContext, node?: Node,
): RustTargetTypeResolutionContext {
  const current = context.sourceStorageResolution;
  if (current?.kind === "unresolved") return context;
  const selection = current?.subject !== undefined || node === undefined ? undefined
    : context.sourceStorage.storageSubjectFor(node);
  const subject = current?.subject ?? (selection?.kind === "resolved" ? selection.subject : undefined);
  const declaration = subject?.node;
  const typeOnly = declaration !== undefined && (context.ast.is.IsTypeAliasDeclaration(declaration) ||
    context.ast.is.IsInterfaceDeclaration(declaration) || context.ast.is.IsTypeParameterDeclaration(declaration));
  return rustSourceStorageSubjectContext(context, typeOnly ? undefined : subject === undefined ? selection
    : { kind: "resolved", subject });
}

export function rustSourceStorageComponentContext(
  context: RustTargetTypeResolutionContext,
  component: SourceStorageProjection,
): RustTargetTypeResolutionContext {
  const current = context.sourceStorageResolution;
  const subject = current?.kind === "resolved" ? current.subject : undefined;
  const selection = subject === undefined ? undefined : context.sourceStorage.subject(
    subject.node, subject.kind, [...subject.projection, component]);
  return rustSourceStorageSubjectContext(context, selection);
}
