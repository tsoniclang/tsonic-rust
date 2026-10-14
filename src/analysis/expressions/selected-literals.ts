import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import type { ExtensionFactSubject, Node } from "@tsonic/tsts";

import type { RustOperationsProviderOptions } from "../operations/provider/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { asNode } from "../../policy/identities/selected-source.js";
import { isRustNumericCarrier } from "../../target-model/types/index.js";
import { selectedSourceLiteralIsRepresentable, selectedSourceNumericLiteralOperationId } from "../../policy/types/resolution/selected-numeric-literal.js";

import { rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId } from "../../target-model/operations/model.js";

export function sourceLiteralIsRepresentableAsPrimitive(
  node: Node,
  primitive: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>["name"],
  context: RustOperationAnalysisContext,
): boolean {
  return selectedSourceLiteralIsRepresentable(node, primitive, context.ast);
}

export function normalizeSelectedLiteralCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const node = asNode(subject, context);
  if (node === undefined || expected === undefined) {
    return actual;
  }
  if ((context.ast.kindName(node) === "KindStringLiteral" || context.ast.kindName(node) === "KindNoSubstitutionTemplateLiteral")) {
    const variant = options.sourceTypes.enumVariantForLiteral(expected, context.ast.text(node));
    if (variant !== undefined) {
      context.records.targetOperations.enumLiteral(node, variant.name, expected);
      context.records.runtimeCarriers.selected(node, expected);
      return expected;
    }
  }
  if (expected.kind !== "source-primitive" || !isRustNumericCarrier(expected)) {
    return actual;
  }
  if (!sourceLiteralIsRepresentableAsPrimitive(node, expected.name, context)) {
    return actual;
  }
  context.records.runtimeCarriers.selected(node, expected);
  const numericOperationId = selectedSourceNumericLiteralOperationId(node, context.ast);
  if (numericOperationId === rustPostCheckUnaryMinusOperationId) {
    const fact = context.records.targetOperations.unaryMinusLiteral(node, expected);
    context.records.selectedOperations.operator(node, fact, expected);
  } else if (numericOperationId === rustPostCheckUnaryPlusOperationId) {
    const fact = context.records.targetOperations.unaryPlusLiteral(node, expected);
    context.records.selectedOperations.operator(node, fact, expected);
  }
  return expected;
}
