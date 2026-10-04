import type { ExtensionFactSubject, Node } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "../operations/provider/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
import { asNode } from "../../policy/evidence/selected-source.js";
import { isRustNumericCarrier } from "../../target-model/types/index.js";
import { selectedSourceLiteralIsRepresentable, selectedSourceNumericLiteralOperationId } from "../../policy/types/selected-numeric-literal.js";
import { rustTargetOperationFactKey, rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId } from "../facts/keys.js";
import { rustRuntimeCarrierKey, rustSelectedOperationKey } from "../../target-model/facts/selections.js";
import { rustTargetOperationText } from "../facts/target-operation.js";

export function sourceLiteralIsRepresentableAsPrimitive(
  node: Node,
  primitive: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>["name"],
  context: RustOperationPolicyContext,
): boolean {
  return selectedSourceLiteralIsRepresentable(node, primitive, context.ast);
}

export function normalizeSelectedLiteralCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
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
      context.facts.set(node, rustTargetOperationFactKey, fact, [
        { message: "rust selected source enum literal" },
      ]);
      context.facts.set(node, rustRuntimeCarrierKey, { carrier: expected }, [
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
  context.facts.set(node, rustRuntimeCarrierKey, { carrier: expected }, [
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
    context.facts.set(node, rustTargetOperationFactKey, fact, [
      { message: "rust finalized selected unary-minus literal carrier" },
    ]);
    context.facts.set(node, rustSelectedOperationKey, {
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
    context.facts.set(node, rustTargetOperationFactKey, fact, [
      { message: "rust finalized selected unary-plus literal carrier" },
    ]);
    context.facts.set(node, rustSelectedOperationKey, {
      operationId: fact.operationId,
      operationKind: "operator",
      targetOperation: rustTargetOperationText(fact),
      resultType: expected,
      provenance: { sourceExpression: node },
    });
  }
  return expected;
}
