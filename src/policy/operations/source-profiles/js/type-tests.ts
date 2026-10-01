import type { SourceNativeGuard } from "@tsonic/target-api/source";
import type { ResolvedSourceCallInfo } from "@tsonic/tsts";
import type { RustClosedTypePredicate } from "../../../../target-model/operations/type-tests.js";
import type { RustSourcePolicyContext } from "../../../model/context.js";
import type { RustSourceProfileRegistry } from "../../../types/source-profile.js";
import { resolveSelectedJsSourceMember, type RustSelectedSourceMemberIdentity } from "../../../evidence/selected-source.js";

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
