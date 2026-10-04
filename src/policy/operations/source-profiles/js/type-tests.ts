import type { SourceNativeGuard } from "@tsonic/target-api/source";
import type { Node, ResolvedSourceCallInfo } from "@tsonic/tsts";
import { selectSourceNativeValueGuard } from "@tsonic/target-api/source";
import type { RustClosedTypePredicate } from "../../../../target-model/operations/type-tests.js";
import type { RustSourcePolicyContext } from "../../../model/context.js";
import type { RustSourceProfileRegistry } from "../../../types/source-profile.js";
import { asNode, resolveSelectedJsSourceExportName, resolveSelectedJsSourceMember, type RustSelectedSourceMemberIdentity } from "../../../evidence/selected-source.js";
import { rustSourceErrorConstructors } from "../../../../target-model/identities/source-errors.js";

export function selectRustErrorTypePredicate(
  context: RustSourcePolicyContext,
  declaration: Node | undefined,
  profiles: RustSourceProfileRegistry,
): Extract<RustClosedTypePredicate, { readonly kind: "error" }> | undefined {
  const selectedDeclaration = asNode(declaration, context);
  const profile = selectedDeclaration === undefined ? undefined : profiles.profileForNode(selectedDeclaration, context.ast);
  const name = resolveSelectedJsSourceExportName(context, declaration, profiles) ??
    (profile === "native" ? context.ast.text(context.ast.name(selectedDeclaration)) : undefined);
  const selected = rustSourceErrorConstructors.find(entry => entry.sourceName === name &&
    (entry.sourceName === "Error" || profile === "js"));
  return selected === undefined ? undefined : Object.freeze({ kind: "error", errorKind: selected.errorKind });
}

export function selectRustSourceTypeGuard(
  context: RustSourcePolicyContext,
  expression: Node,
  profiles: RustSourceProfileRegistry,
): SourceNativeGuard<RustClosedTypePredicate> | undefined {
  const native = selectSourceNativeValueGuard({ ...context, navigation: context.source.navigation }, expression);
  if (native?.kind === "nominal") {
    const predicate = selectRustErrorTypePredicate(context, native.declaration, profiles);
    if (predicate !== undefined) return Object.freeze({ sourceOperand: native.sourceOperand, predicate });
  }
  return selectRustArrayTypeGuard(context, context.semanticsFor(expression).operations.call(expression), profiles);
}

export function isRustArrayTypeTestMember(member: RustSelectedSourceMemberIdentity | undefined): boolean {
  return member?.profile === "js" && member.ownerName === "ArrayConstructor" && member.memberName === "isArray";
}

export function selectRustArrayTypeGuard(
  context: RustSourcePolicyContext,
  source: ResolvedSourceCallInfo | undefined,
  profiles: RustSourceProfileRegistry,
): SourceNativeGuard<RustClosedTypePredicate> | undefined {
  if (source === undefined) return undefined;
  const declaration = context.semanticsFor(source.call).declarations.signatureDeclaration(source.selectedSignature);
  if (!isRustArrayTypeTestMember(resolveSelectedJsSourceMember(context, declaration, profiles))) return undefined;
  const argument = source.sourceArguments[0];
  if (source.sourceArguments.length !== 1 || argument === undefined || context.ast.is.IsSpreadElement(argument.expression)) return undefined;
  return Object.freeze({ sourceOperand: argument.expression, predicate: Object.freeze({ kind: "array" as const }) });
}
