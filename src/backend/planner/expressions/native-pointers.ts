import type {
  Node,
} from "@tsonic/tsts";
import {
  rustTargetTypeRefEquals,
} from "../../../target-model/types/equality.js";
import type {
  RustTargetOperationFact,
} from "../../../analysis/facts/keys.js";
import {
  rustTargetOperationFactKey,
} from "../../../analysis/facts/keys.js";
import type {
  RustExpr,
} from "../../target-ast/nodes.js";
import {
  missingFactDiagnostic,
} from "../diagnostics.js";
import {
  diagnosticInput,
} from "../program/plan-context.js";
import type {
  RustPlanContext,
} from "../program/plan-context.js";
import { tryPlanRustRawAddress } from "./raw-addresses.js";
import { rustMemoryLayoutObservationKey } from "../../../target-model/operations/memory-layout.js";

export type RustNativePointerOperationPlan =
  | { readonly handled: false }
  | { readonly handled: true; readonly expression?: RustExpr };

export function tryPlanRustNativePointerOperation(
  node: Node,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustNativePointerOperationPlan {
  const layout = context.input.program.facts.getFact(node, rustMemoryLayoutObservationKey);
  if (layout !== undefined) return { handled: true, expression: { kind: "int-literal", text: `${layout.value}usize` } };
  const rawAddress = tryPlanRustRawAddress(node, context, planExpression);
  if (rawAddress.handled) return { handled: true, expression: rawAddress.expression };
  const fact = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  if (fact?.kind !== "native-pointer") {
    return { handled: false };
  }
  if (!nativePointerFactIsClosed(fact, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.native-pointer-fact",
      "The finalized Rust native-pointer operation has inconsistent exact carrier evidence.",
    ));
    return { handled: true };
  }
  if ((context.explicitUnsafeContextDepth ?? 0) === 0) {
    context.diagnostics.push({
      code: "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED",
      category: "error",
      source: "tsonic-rust",
      message: `Rust native-pointer '${fact.operation}' requires an explicit unsafeContext() source region.`,
      sourceNode: node,
    });
    return { handled: true };
  }
  const pointer = planExpression(fact.pointerExpression, context);
  if (pointer === undefined) {
    return { handled: true };
  }
  const dereference: RustExpr = { kind: "dereference", pointer };
  switch (fact.operation) {
    case "load":
      return { handled: true, expression: dereference };
    case "store": {
      const value = fact.valueExpression === undefined
        ? undefined
        : planExpression(fact.valueExpression, context);
      return {
        handled: true,
        ...(value === undefined
          ? {}
          : {
              expression: {
                kind: "assignment",
                operator: "=",
                target: dereference,
                value,
              },
            }),
      };
    }
    case "offset": {
      const offset = fact.offsetExpression === undefined
        ? undefined
        : planExpression(fact.offsetExpression, context);
      return {
        handled: true,
        ...(offset === undefined
          ? {}
          : {
              expression: {
                kind: "method-call",
                receiver: pointer,
                method: "offset",
                args: [offset],
              },
            }),
      };
    }
  }
}

function nativePointerFactIsClosed(
  fact: Extract<RustTargetOperationFact, { readonly kind: "native-pointer" }>,
  context: RustPlanContext,
): boolean {
  const pointerCarrier = context.input.program.facts.getRuntimeCarrierFact(
    fact.pointerExpression,
  )?.carrier;
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
      : context.input.program.facts.getRuntimeCarrierFact(fact.valueExpression)?.carrier;
    return fact.pointerCarrier.mutability === "mut" &&
      rustTargetTypeRefEquals(fact.valueCarrier, fact.pointeeCarrier) &&
      rustTargetTypeRefEquals(valueCarrier, fact.valueCarrier) &&
      fact.resultCarrier.kind === "tuple" &&
      fact.resultCarrier.elements.length === 0;
  }
  const offsetCarrier = fact.offsetExpression === undefined
    ? undefined
    : context.input.program.facts.getRuntimeCarrierFact(fact.offsetExpression)?.carrier;
  return rustTargetTypeRefEquals(offsetCarrier, fact.offsetCarrier) &&
    fact.offsetCarrier?.kind === "source-primitive" &&
    fact.offsetCarrier.name === "native-int" &&
    rustTargetTypeRefEquals(fact.resultCarrier, fact.pointerCarrier);
}
