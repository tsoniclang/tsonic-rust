import type { SourceStorageProjection } from "@tsonic/target-api/analysis";
import type { RustTargetTypeResolutionContext } from "./model.js";
import type { Node } from "@tsonic/tsts";

export function rustSourceStorageContext(
  context: RustTargetTypeResolutionContext, node?: Node,
): RustTargetTypeResolutionContext {
  const selection = context.sourceStorageSubject !== undefined || node === undefined ? undefined
    : context.sourceStorage.storageSubjectFor(node);
  const subject = context.sourceStorageSubject ?? (selection?.kind === "resolved" ? selection.subject : undefined);
  const declaration = subject?.node;
  const typeOnly = declaration !== undefined && (context.ast.is.IsTypeAliasDeclaration(declaration) ||
    context.ast.is.IsInterfaceDeclaration(declaration) || context.ast.is.IsTypeParameterDeclaration(declaration));
  return { ...context, sourceStorageSubject: typeOnly ? undefined : subject };
}

export function rustSourceStorageComponentContext(
  context: RustTargetTypeResolutionContext,
  component: SourceStorageProjection,
): RustTargetTypeResolutionContext {
  const subject = context.sourceStorageSubject;
  const selection = subject === undefined ? undefined : context.sourceStorage.subject(
    subject.node, subject.kind, [...subject.projection, component]);
  return { ...context, sourceStorageSubject: selection?.kind === "resolved" ? selection.subject : undefined };
}
