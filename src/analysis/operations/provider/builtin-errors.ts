import {
  asNode,
  resolveSelectedJsSourceExportName,
  type RustSelectedSourceMemberSet,
} from "../../../policy/evidence/selected-source.js";
import { rustSourceErrorConstructors } from "../../../target-model/identities/source-errors.js";
import {
  isRustJsValueCarrier,
  rustJsErrorTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import { rustEffectiveValueCarrier } from "../../facts/value-carrier-queries.js";
import { acceptRustMemberOperation, acceptRustOperation, rejectSelectedOperation } from "./result.js";
import type {
  RustCheckedOperationSelectionResult,
  RustCheckedOperatorSelectionInput,
  RustCheckedPropertySelectionInput,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function selectRustBuiltinErrorTypeTest(
  request: RustCheckedOperatorSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const declaration = asNode(request.sourceRightDeclaration, context);
  const profile = declaration === undefined
    ? undefined
    : options.sourceProfiles.profileForNode(declaration, context.ast);
  const name = resolveSelectedJsSourceExportName(
    context, request.sourceRightDeclaration, options.sourceProfiles,
  ) ?? (profile === "native" ? context.ast.text(context.ast.name(declaration)) : undefined);
  const selected = rustSourceErrorConstructors.find((entry) =>
    entry.sourceName === name && (entry.sourceName === "Error" || options.jsEnabled));
  if (selected === undefined) return undefined;
  const sourceCarrier = rustEffectiveValueCarrier(context.facts, request.left) ??
    resolveRustTargetTypeRef(request.left, context, options);
  const lowering = rustTargetTypeRefEquals(sourceCarrier, rustJsErrorTargetType())
    ? "native-error"
    : isRustJsValueCarrier(sourceCarrier) ? "closed-value" : undefined;
  if (sourceCarrier === undefined || lowering === undefined) {
    return rejectSelectedOperation(
      request.expression, context, "RUST_BUILTIN_ERROR_TYPE_TEST_CARRIER",
      "A builtin Error test requires an exact native Error or closed JavaScript value carrier.",
    );
  }
  const resultCarrier = rustSourcePrimitiveTargetType("bool");
  return acceptRustOperation(request.expression, {
    kind: "builtin-error-type-test",
    operationId: `tsonic.rust.error.instanceof.${selected.sourceName}`,
    sourceCarrier,
    resultCarrier,
    errorKind: selected.errorKind,
    lowering,
  }, context, {
    sourceExpression: request.expression,
    sourceReceiver: request.left,
    sourceSelectedDeclaration: request.sourceRightDeclaration,
  }, resultCarrier);
}

export function selectRustBuiltinErrorProperty(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  sourceMembers: RustSelectedSourceMemberSet | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const member = sourceMembers?.members[0];
  if (member === undefined || !sourceMembers?.members.every((candidate) =>
    candidate.ownerName === "Error" && candidate.memberName === member.memberName) ||
    !rustTargetTypeRefEquals(receiverCarrier, rustJsErrorTargetType())) {
    return undefined;
  }
  if (request.accessMode !== "read") {
    return rejectSelectedOperation(
      request.expression, context, "RUST_BUILTIN_ERROR_MUTATION_UNSUPPORTED",
      "Builtin Error mutation requires shared writable Error storage; native diagnostic fields cannot preserve that aliasing contract.",
    );
  }
  if (member.memberName !== "message" && member.memberName !== "name") {
    return rejectSelectedOperation(
      request.expression, context, "RUST_BUILTIN_ERROR_PROPERTY_UNSUPPORTED",
      "The selected builtin Error member has no exact native runtime property contract.",
    );
  }
  return acceptRustMemberOperation(request, "property", {
    kind: "builtin-error-property",
    operationId: `tsonic.rust.error.property.${member.memberName}`,
    receiverCarrier: rustJsErrorTargetType(),
    resultCarrier: rustStringTargetType(),
    property: member.memberName,
  }, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: request.sourceSelectedDeclaration,
    sourceResultType: request.sourceResultType,
  });
}
