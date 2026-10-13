import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import type { ExtensionFactSubject, Node } from "@tsonic/tsts";

import type { RustOperationsProviderOptions } from "../operations/provider/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import { asNode } from "../../policy/identities/selected-source.js";
import { isRustNumericCarrier } from "../../target-model/types/index.js";
import { selectedSourceLiteralIsRepresentable, selectedSourceNumericLiteralOperationId } from "../../policy/types/resolution/selected-numeric-literal.js";

import { rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId } from "../../target-model/operations/model.js";

import { rustTargetOperationText } from "../operations/target-operation.js";

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
      const fact: RustTargetOperationFact = {
        kind: "source-enum-member",
        operationId: `tsonic.rust.union.variant:${variant.name}`,
        name: variant.name,
        resultCarrier: expected,
      };
      context.records.targetOperation.set(node, fact, [
        { message: "rust selected source enum literal" },
      ]);
      context.records.runtimeCarrier.set(node, { carrier: expected }, [
        { message: "rust selected source enum literal carrier" },
      ]);
      return expected;
    }
  }
  if (expected.kind !== "source-primitive" || !isRustNumericCarrier(expected)) {
    return actual;
  }
  if (!sourceLiteralIsRepresentableAsPrimitive(node, expected.name, context)) {
    return actual;
  }
  context.records.runtimeCarrier.set(node, { carrier: expected }, [
    { message: "rust selected numeric literal carrier from checked peer/target evidence" },
  ]);
  const numericOperationId = selectedSourceNumericLiteralOperationId(node, context.ast);
  if (numericOperationId === rustPostCheckUnaryMinusOperationId) {
    const fact: RustTargetOperationFact = {
      kind: "operator-token",
      operationId: rustPostCheckUnaryMinusOperationId,
      operator: "-",
      resultCarrier: expected,
    };
    context.records.targetOperation.set(node, fact, [
      { message: "rust finalized selected unary-minus literal carrier" },
    ]);
    context.records.selectedOperation.set(node, {
      operationId: fact.operationId,
      operationKind: "operator",
      targetOperation: rustTargetOperationText(fact),
      resultType: expected,
      provenance: { sourceExpression: node },
    });
  } else if (numericOperationId === rustPostCheckUnaryPlusOperationId) {
    const fact: RustTargetOperationFact = {
      kind: "source-conversion",
      operationId: rustPostCheckUnaryPlusOperationId,
      resultCarrier: expected,
    };
    context.records.targetOperation.set(node, fact, [
      { message: "rust finalized selected unary-plus literal carrier" },
    ]);
    context.records.selectedOperation.set(node, {
      operationId: fact.operationId,
      operationKind: "operator",
      targetOperation: rustTargetOperationText(fact),
      resultType: expected,
      provenance: { sourceExpression: node },
    });
  }
  return expected;
}
