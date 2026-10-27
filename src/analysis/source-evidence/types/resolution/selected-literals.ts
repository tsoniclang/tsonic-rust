import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import { requireRustRecord } from "../../../program/records/objects/required-records.js";
import type { ExtensionFactSubject, Node } from "@tsonic/tsts";

import type { RustOperationsProviderOptions } from "../../../operations/members/model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { asNode } from "../../../../policy/identities/selected-source.js";
import { isRustNumericLiteralCarrier, selectedSourceLiteralIsRepresentable, selectedSourceNumericLiteralOperationId } from "../../../../policy/conversions/literals.js";

import { rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId } from "../../../../target-model/operations/model.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustEnumLiteralFact, rustUnaryMinusLiteralFact, rustUnaryPlusLiteralFact } from "../../../program/records/operations/target-operation-literals.js";
import { rustSelectedOperatorOperation } from "../../../program/records/operations/selected-operation-values.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import { rustTargetOperationFactEquals } from "../../../../target-model/records/operations/operation-equality.js";
import { rustSelectedTargetOperationEquals } from "../../../../target-model/records/operations/operation-equality.js";
import { rustEffectiveValueCarrier } from "../../../conversions/value-carrier-queries.js";

export function sourceLiteralIsRepresentableAsPrimitive(
  node: Node,
  primitive: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>["name"],
  context: RustOperationAnalysisContext,
): boolean {
  return selectedSourceLiteralIsRepresentable(context.literalValues.literalValue.get(node), primitive);
}

export function normalizeSelectedLiteralCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  context.records.assertOpen();
  const node = asNode(subject, context);
  if (node === undefined || expected === undefined) {
    return actual;
  }
  if ((context.ast.kindName(node) === "KindStringLiteral" || context.ast.kindName(node) === "KindNoSubstitutionTemplateLiteral")) {
    const variant = options.sourceTypes.enumVariantForLiteral(expected, context.ast.text(node));
    if (variant !== undefined) {
      recordSelectedLiteralOperation(node, rustEnumLiteralFact(variant.name, expected), context);
      return selectedLiteralCarrier(node, expected, context);
    }
  }
  if (!isRustNumericLiteralCarrier(expected)) {
    return actual;
  }
  if (context.literalValues.literalValue.get(node)?.numeric?.kind === "checked-float64") {
    return rustEffectiveValueCarrier(context.records, node) ?? actual;
  }
  if (!sourceLiteralIsRepresentableAsPrimitive(node, expected.name, context)) {
    return actual;
  }
  const carrier = selectedLiteralCarrier(node, expected, context);
  const numericOperationId = selectedSourceNumericLiteralOperationId(node, context.ast);
  if (numericOperationId === rustPostCheckUnaryMinusOperationId) {
    const fact = recordSelectedLiteralOperation(node, rustUnaryMinusLiteralFact(carrier), context);
    recordSelectedLiteralOperator(node, fact, carrier, context);
  } else if (numericOperationId === rustPostCheckUnaryPlusOperationId) {
    const fact = recordSelectedLiteralOperation(node, rustUnaryPlusLiteralFact(carrier), context);
    recordSelectedLiteralOperator(node, fact, carrier, context);
  }
  return carrier;
}

function selectedLiteralCarrier(node: Node, expected: TargetTypeRef, context: RustOperationAnalysisContext): TargetTypeRef {
  context.records.assertOpen();
  requireRustRecord(context.requiredRecords, "runtimeCarrier", node, "selected literal", "selectedLiteralCarrier");
  if (context.records.runtimeCarriers.source(node, expected) !== undefined) failTargetAnalysisInvariant("tsonic-rust",
    "Conflicting Rust semantic plan 'tsonic.rust.runtimeCarrier' for one exact source subject.");
  const selected = context.records.runtimeCarrier.get(node);
  if (selected === undefined) return failTargetAnalysisInvariant("tsonic-rust", "Selected literal requires its admitted native carrier.");
  return selected.carrier;
}

function recordSelectedLiteralOperation(
  node: Node, fact: RustTargetOperationFact, context: RustOperationAnalysisContext,
): RustTargetOperationFact {
  context.records.assertOpen();
  requireRustRecord(context.requiredRecords, "targetOperation", node, fact.kind, "recordSelectedLiteralOperation");
  const existing = context.records.targetOperation.get(node);
  if (existing !== undefined) {
    if (!rustTargetOperationFactEquals(existing, fact)) failTargetAnalysisInvariant("tsonic-rust",
      "Conflicting Rust semantic plan 'tsonic.rust.targetOperation' for one exact source subject.");
    return existing;
  }
  context.records.targetOperations.source(node, fact);
  return fact;
}

function recordSelectedLiteralOperator(
  node: Node, fact: RustTargetOperationFact, carrier: TargetTypeRef, context: RustOperationAnalysisContext,
): void {
  context.records.assertOpen();
  requireRustRecord(context.requiredRecords, "selectedOperation", node, fact.kind, "recordSelectedLiteralOperator");
  const existing = context.records.selectedOperation.get(node);
  if (existing === undefined) context.records.selectedOperations.operator(node, fact, carrier);
  else if (!rustSelectedTargetOperationEquals(existing, rustSelectedOperatorOperation(node, fact, carrier))) {
    failTargetAnalysisInvariant("tsonic-rust", "Conflicting Rust semantic plan 'selectedOperation' for one exact source subject.");
  }
}
