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
import { rustTypeFromCarrierInContext } from "../types/render.js";
import {
  missingFactDiagnostic,
} from "../diagnostics.js";
import {
  diagnosticInput,
} from "../program/plan-context.js";
import type {
  RustPlanContext,
} from "../program/plan-context.js";

export type RustNativePointerOperationPlan =
  | { readonly handled: false }
  | { readonly handled: true; readonly expression?: RustExpr };

export function tryPlanRustNativePointerOperation(
  node: Node,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustNativePointerOperationPlan {
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
  if (fact.safety === "requires-unsafe" &&
    (context.explicitUnsafeContextDepth ?? 0) === 0) {
    context.diagnostics.push({
      code: "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED",
      category: "error",
      source: "tsonic-rust",
      message: `Rust native-pointer '${fact.operation}' requires an explicit unsafeContext() source region.`,
      sourceNode: node,
    });
    return { handled: true };
  }
  switch (fact.operation) {
    case "load": {
      const pointer = planExpression(fact.pointerExpression, context);
      if (pointer === undefined) return { handled: true };
      const dereference: RustExpr = { kind: "dereference", pointer };
      return { handled: true, expression: dereference };
    }
    case "store": {
      const pointer = planExpression(fact.pointerExpression, context);
      const value = planExpression(fact.valueExpression, context);
      return {
        handled: true,
        ...(pointer === undefined || value === undefined
          ? {}
          : {
              expression: {
                kind: "assignment",
                operator: "=",
                target: { kind: "dereference", pointer },
                value,
              },
            }),
      };
    }
    case "offset":
    case "offset-bytes": {
      const pointer = planExpression(fact.pointerExpression, context);
      const offset = planExpression(fact.offsetExpression, context);
      return {
        handled: true,
        ...(pointer === undefined || offset === undefined
          ? {}
          : {
              expression: {
                kind: "method-call",
                receiver: pointer,
                method: fact.operation === "offset" ? "offset" : "byte_offset",
                args: [offset],
              },
            }),
      };
    }
    case "expose-address": {
      const pointer = planExpression(fact.pointerExpression, context);
      return {
        handled: true,
        ...(pointer === undefined
          ? {}
          : {
              expression: {
                kind: "method-call",
                receiver: pointer,
                method: "expose_provenance",
                args: [],
              },
            }),
      };
    }
    case "restore-exposed-address": {
      const address = planExpression(fact.addressExpression, context);
      const pointee = rustTypeFromCarrierInContext(fact.pointeeCarrier, context);
      return {
        handled: true,
        ...(address === undefined || pointee === undefined
          ? {}
          : {
              expression: {
                kind: "call",
                path: fact.pointerCarrier.mutable
                  ? "std::ptr::with_exposed_provenance_mut"
                  : "std::ptr::with_exposed_provenance",
                genericArguments: [{ kind: "type", type: pointee }],
                args: [address],
              },
            }),
      };
    }
    case "read-volatile": {
      const pointer = planExpression(fact.pointerExpression, context);
      return {
        handled: true,
        ...(pointer === undefined
          ? {}
          : { expression: { kind: "call", path: "std::ptr::read_volatile", args: [pointer] } }),
      };
    }
    case "write-volatile": {
      const pointer = planExpression(fact.pointerExpression, context);
      const value = planExpression(fact.valueExpression, context);
      return {
        handled: true,
        ...(pointer === undefined || value === undefined
          ? {}
          : {
              expression: {
                kind: "call",
                path: "std::ptr::write_volatile",
                args: [pointer, value],
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
  if (!rustTargetTypeRefEquals(fact.pointerCarrier.target, fact.pointeeCarrier)) {
    return false;
  }
  if (fact.operation === "restore-exposed-address") {
    const addressCarrier = context.input.program.facts.getRuntimeCarrierFact(
      fact.addressExpression,
    )?.carrier;
    return rustTargetTypeRefEquals(addressCarrier, fact.addressCarrier) &&
      fact.addressCarrier.kind === "source-primitive" &&
      fact.addressCarrier.name === "native-uint" &&
      rustTargetTypeRefEquals(fact.resultCarrier, fact.pointerCarrier);
  }
  const pointerCarrier = context.input.program.facts.getRuntimeCarrierFact(
    fact.pointerExpression,
  )?.carrier;
  if (!rustTargetTypeRefEquals(pointerCarrier, fact.pointerCarrier)) return false;
  if (fact.operation === "load" || fact.operation === "read-volatile") {
    return rustTargetTypeRefEquals(fact.resultCarrier, fact.pointeeCarrier);
  }
  if (fact.operation === "store" || fact.operation === "write-volatile") {
    const valueCarrier = context.input.program.facts.getRuntimeCarrierFact(
      fact.valueExpression,
    )?.carrier;
    return fact.pointerCarrier.mutable &&
      rustTargetTypeRefEquals(fact.valueCarrier, fact.pointeeCarrier) &&
      rustTargetTypeRefEquals(valueCarrier, fact.valueCarrier) &&
      fact.resultCarrier.kind === "unit";
  }
  if (fact.operation === "expose-address") {
    return fact.resultCarrier.kind === "source-primitive" &&
      fact.resultCarrier.name === "native-uint";
  }
  if (fact.operation !== "offset" && fact.operation !== "offset-bytes") return false;
  const offsetCarrier = context.input.program.facts.getRuntimeCarrierFact(
    fact.offsetExpression,
  )?.carrier;
  return rustTargetTypeRefEquals(offsetCarrier, fact.offsetCarrier) &&
    fact.offsetCarrier.kind === "source-primitive" &&
    fact.offsetCarrier.name === "native-int" &&
    rustTargetTypeRefEquals(fact.resultCarrier, fact.pointerCarrier);
}
