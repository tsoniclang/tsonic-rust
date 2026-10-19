import type {
  Node,
} from "@tsonic/tsts";
import {
  rustTargetTypeRefEquals,
} from "../../../target-model/types/equality.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";

import type {
  RustExpr,
} from "../../target-ast/syntax/nodes.js";
import {
  missingFactDiagnostic,
} from "../diagnostics.js";
import {
  diagnosticInput,
} from "../program/plan-context.js";
import type {
  RustPlanContext,
} from "../program/plan-context.js";
export function planRustNativePointerOperation(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "native-pointer" }>,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  if (!nativePointerFactIsClosed(fact, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.native-pointer-fact",
      "The finalized Rust native-pointer operation has inconsistent exact carrier evidence.",
    ));
    return undefined;
  }
  if ((context.explicitUnsafeContextDepth ?? 0) === 0) {
    context.diagnostics.push({
      code: "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED",
      category: "error",
      source: "tsonic-rust",
      message: `Rust native-pointer '${fact.operation}' requires an explicit unsafecontext() source region.`,
      sourceNode: node,
    });
    return undefined;
  }
  const pointer = planExpression(fact.pointerExpression, context);
  if (pointer === undefined) {
    return undefined;
  }
  const dereference: RustExpr = { kind: "dereference", pointer };
  switch (fact.operation) {
    case "load":
      return dereference;
    case "store": {
      const value = fact.valueExpression === undefined
        ? undefined
        : planExpression(fact.valueExpression, context);
      return value === undefined ? undefined : {
                kind: "assignment",
                operator: "=",
                target: dereference,
                value,
              };
    }
    case "offset": {
      const offset = fact.offsetExpression === undefined
        ? undefined
        : planExpression(fact.offsetExpression, context);
      return offset === undefined ? undefined : {
                kind: "method-call",
                receiver: pointer,
                method: "offset",
                args: [offset],
              };
    }
  }
}

function nativePointerFactIsClosed(
  fact: Extract<RustTargetOperationFact, { readonly kind: "native-pointer" }>,
  context: RustPlanContext,
): boolean {
  const pointerCarrier = context.input.program.records.runtimeCarrier.get(fact.pointerExpression)?.carrier;
  if (!rustTargetTypeRefEquals(pointerCarrier, fact.pointerCarrier) ||
    !rustTargetTypeRefEquals(fact.pointerCarrier.pointee, fact.pointeeCarrier)) {
    return false;
  }
  if (fact.operation === "load") {
    return rustTargetTypeRefEquals(fact.resultCarrier, fact.pointeeCarrier);
  }
  if (fact.operation === "store") {
    const valueCarrier = fact.valueExpression === undefined
      ? undefined
      : context.input.program.records.runtimeCarrier.get(fact.valueExpression)?.carrier;
    return fact.pointerCarrier.mutability === "mut" &&
      rustTargetTypeRefEquals(fact.valueCarrier, fact.pointeeCarrier) &&
      rustTargetTypeRefEquals(valueCarrier, fact.valueCarrier) &&
      fact.resultCarrier.kind === "tuple" &&
      fact.resultCarrier.elements.length === 0;
  }
  const offsetCarrier = fact.offsetExpression === undefined
    ? undefined
    : context.input.program.records.runtimeCarrier.get(fact.offsetExpression)?.carrier;
  return rustTargetTypeRefEquals(offsetCarrier, fact.offsetCarrier) &&
    fact.offsetCarrier?.kind === "source-primitive" &&
    fact.offsetCarrier.name === "native-int" &&
    rustTargetTypeRefEquals(fact.resultCarrier, fact.pointerCarrier);
}
