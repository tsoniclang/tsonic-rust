import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustTypedLocationPlanKey } from "../../../analysis/facts/keys.js";
import { rustNativeBackingKey } from "../../../target-model/operations/native-memory.js";
import { rustProgramErrorTargetType } from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { requireRustCarrierRequirements, requireRustLocationValueCarrier } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustLocationCallback } from "./location-callbacks.js";
import { locationMethodReceiver, optionReference, typedLocationFactMatchesPlan } from "./location-expressions.js";
import { planRustNativeAllocation } from "./native-memory.js";
import { rustExpressionHasReferenceObjectField } from "./object-field-locations.js";
import {
  fallibleLocationAccess,
  planRustLocationStorage,
  planRustNonConsumingValue,
  planRustSourceLocationStorage,
  rustExpressionHasBoundRecordField,
} from "./typed-locations.js";
import type { RustExpressionPlanner } from "./typed-locations.js";

export function planRustTypedLocationCall(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "typed-location" }>,
  context: RustPlanContext,
  planExpression: RustExpressionPlanner,
): RustExpr | undefined {
  const plan = context.input.program.facts.getFact(node, rustTypedLocationPlanKey);
  if (plan === undefined || !typedLocationFactMatchesPlan(fact, plan)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.typed-location-plan",
      "Typed-location operation has no matching exact Rust-owned lowering plan.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  switch (plan.operation) {
    case "hash-pointer": {
      const pointer = planExpression(plan.pointerExpression, context);
      const owner = rustTypeFromCarrierInContext(fact.locationCarrier, context);
      return pointer === undefined || owner === undefined ? undefined : {
        kind: "associated-call", owner, method: "hash",
        args: [optionReference(planRustNonConsumingValue(plan.pointerExpression, pointer, context))],
      };
    }
    case "bind-pointer": {
      const identity = planExpression(plan.identityExpression, context);
      const readValue = planExpression(plan.readExpression, context);
      const writeValue = planExpression(plan.writeExpression, context);
      const read = readValue === undefined ? undefined : planRustLocationCallback(node, 1, readValue, context);
      const write = writeValue === undefined ? undefined : planRustLocationCallback(node, 2, writeValue, context);
      if (identity === undefined || read === undefined || write === undefined ||
        !requireRustCarrierRequirements(fact.pointeeCarrier, ["static"], node, context)) return undefined;
      return { kind: "call", path: "rt::Location::try_bind", args: [identity, read, write] };
    }
    case "view-pointer": {
      const pointer = planExpression(plan.pointerExpression, context);
      const readValue = planExpression(plan.readExpression, context);
      const writeValue = planExpression(plan.writeExpression, context);
      const read = readValue === undefined ? undefined : planRustLocationCallback(node, 1, readValue, context);
      const write = writeValue === undefined ? undefined : planRustLocationCallback(node, 2, writeValue, context);
      if (pointer === undefined || read === undefined || write === undefined ||
        !requireRustCarrierRequirements(plan.pointeeCarrier, ["static"], node, context) ||
        !requireRustCarrierRequirements(plan.sourcePointeeCarrier, ["static"], node, context)) return undefined;
      const source = planRustNonConsumingValue(plan.pointerExpression, pointer, context);
      return plan.optional
        ? { kind: "call", path: "rt::Location::try_view_optional", args: [{ kind: "reference", expr: source }, read, write] }
        : { kind: "method-call", receiver: source, method: "try_view", args: [read, write] };
    }
    case "project-pointer": {
      const pointer = planExpression(plan.pointerExpression, context);
      const readValue = planExpression(plan.fromSourceExpression, context);
      const writeValue = planExpression(plan.toSourceExpression, context);
      const read = readValue === undefined ? undefined : planRustLocationCallback(node, 1, readValue, context);
      const write = writeValue === undefined ? undefined : planRustLocationCallback(node, 2, writeValue, context);
      if (pointer === undefined || read === undefined || write === undefined ||
        !requireRustCarrierRequirements(plan.pointeeCarrier, ["static"], node, context) ||
        !requireRustCarrierRequirements(plan.sourcePointeeCarrier, ["static"], node, context)) return undefined;
      const source = planRustNonConsumingValue(plan.pointerExpression, pointer, context);
      return plan.optional
        ? { kind: "call", path: "rt::Location::try_map_optional", args: [optionReference(source), read, write] }
        : { kind: "method-call", receiver: source, method: "try_map", args: [read, write] };
    }
    case "address-of": {
      if (rustExpressionHasBoundRecordField(plan.storageExpression, context) ||
        rustExpressionHasReferenceObjectField(plan.storageExpression, context)) {
        return planRustSourceLocationStorage(plan.storageExpression, plan.rootExpression, context, planExpression);
      }
      const location = planRustLocationStorage(
        plan.storageExpression,
        plan.rootExpression,
        plan.storageExpression === plan.rootExpression,
        context,
        planExpression,
      );
      const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
      return location === undefined || error === undefined ? undefined : {
        kind: "method-call", receiver: location, method: "into_fallible",
        genericArguments: [{ kind: "type", type: error }], args: [],
      };
    }
    case "allocate": {
      const initial = planExpression(plan.initialExpression, context);
      if (context.input.program.facts.getFact(node, rustNativeBackingKey) !== undefined) {
        return initial === undefined ? undefined : planRustNativeAllocation(node, initial, context, rustProgramErrorTargetType());
      }
      const owner = rustTypeFromCarrierInContext(fact.locationCarrier, context);
      return initial === undefined || owner === undefined || !requireRustLocationValueCarrier(
        fact.pointeeCarrier,
        node,
        context,
      )
        ? undefined
        : { kind: "associated-call", owner, method: "allocate", args: [initial] };
    }
    case "load": {
      const pointer = locationMethodReceiver(
        planExpression(plan.pointerExpression, context),
      );
      return pointer === undefined
        ? undefined
        : fallibleLocationAccess(node, { kind: "method-call", receiver: pointer, method: "try_load", args: [] }, context);
    }
    case "store": {
      const pointer = locationMethodReceiver(
        planExpression(plan.pointerExpression, context),
      );
      const value = planExpression(plan.valueExpression, context);
      return pointer === undefined || value === undefined
        ? undefined
        : fallibleLocationAccess(node, { kind: "method-call", receiver: pointer, method: "try_store", args: [value] }, context);
    }
    case "equal-pointer": {
      const left = planExpression(plan.leftExpression, context);
      const right = planExpression(plan.rightExpression, context);
      const locationType = rustTypeFromCarrierInContext(fact.locationCarrier, context);
      if (left === undefined || right === undefined || locationType === undefined) {
        return undefined;
      }
      return {
        kind: "associated-call",
        owner: locationType,
        method: "same",
        args: [
          optionReference(planRustNonConsumingValue(plan.leftExpression, left, context)),
          optionReference(planRustNonConsumingValue(plan.rightExpression, right, context)),
        ],
      };
    }
  }
}
