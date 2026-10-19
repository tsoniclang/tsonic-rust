import type { Node } from "@tsonic/tsts";

import type { RustExpr, RustType } from "../../../target-ast/syntax/nodes.js";
import { rustInlineBindingStorageType } from "../../expressions/binding-storage.js";
import { planExpressionBeforeValueProjections } from "../../expressions/entry.js";
import { planRustCaptureValue } from "../../expressions/typed-locations.js";
import { failRustPlannerInvariant } from "../../../invariants.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { type RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";

export function planRustLexicalFunctionEnvironment(declaration: Node, context: RustPlanContext) {
  const selection = context.input.program.records.lexicalFunction.get(declaration);
  if (selection === undefined) return { parameters: [], context };
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted lexical environment requires its hygienic name allocator.", declaration);
  const parameters: { name: string; type: RustType }[] = [];
  const capturedBindings = [...(context.capturedBindings ?? [])];
  for (const capture of selection.captures) {
    const { carrier, physicalCarrier, storage, owned, borrowedCarrier } = capture;
    const valueType = rustTypeFromCarrierInContext(physicalCarrier, context);
    if (valueType === undefined || carrier === undefined) failRustPlannerInvariant("An admitted lexical function requires its renderable native capture environment.", declaration);
    const physicalType: RustType = storage?.storage === "location"
      ? { kind: "named", path: "rt::Location", genericArguments: [{ kind: "type", type: valueType }] }
      : storage === undefined ? valueType : rustInlineBindingStorageType(storage.storage, valueType);
    const name = allocateRustSyntheticName(context.syntheticNames, "capture");
    const parameterType = borrowedCarrier === undefined ? owned ? physicalType : {
      kind: "reference" as const, referent: physicalType, mutable: false,
    } : rustTypeFromCarrierInContext(borrowedCarrier, context);
    if (parameterType === undefined) failRustPlannerInvariant("An admitted lexical function requires its renderable native capture environment.", declaration);
    parameters.push({ name, type: parameterType });
    capturedBindings.push({ declaration: capture.declaration, expression: { kind: "path", path: name },
      storage: storage?.storage ?? "value", valueCarrier: carrier,
      ...(borrowedCarrier === undefined ? {} : { borrowedCarrier }),
      ...(owned ? {} : { borrowed: storage === undefined && capture.mutable ? "mutable" as const : "shared" as const }) });
    if (storage?.storage === "location") context.usedAliases?.add("rt");
  }
  return { parameters, context: { ...context, capturedBindings } };
}

export function planRustLexicalFunctionArguments(declaration: Node, context: RustPlanContext): readonly RustExpr[] | undefined {
  const selection = context.input.program.records.lexicalFunction.get(declaration);
  if (selection === undefined) return [];
  const arguments_: RustExpr[] = [];
  for (const capture of selection.captures) {
    const captured = [...(context.capturedBindings ?? [])].reverse().find(value => value.declaration === capture.declaration);
    const { storage, owned } = capture;
    const mutable = storage === undefined && capture.mutable;
    if (owned) {
      const name = context.input.program.names.nameForDeclaration(capture.declaration);
      if (name === undefined) failRustPlannerInvariant("An admitted lexical function requires its renderable native capture environment.", declaration);
      arguments_.push(planRustCaptureValue(declaration, capture, name, storage?.storage ?? "value", context, "invocation"));
      continue;
    }
    if (captured?.borrowed !== undefined) {
      if (mutable && captured.borrowed !== "mutable") {
        failRustPlannerInvariant("A mutable lexical call lost its exact mutable environment borrow.", declaration);
      }
      arguments_.push(mutable
        ? { kind: "reference", expr: { kind: "dereference", pointer: captured.expression }, mutable: true }
        : captured.borrowed === "shared" ? captured.expression
        : { kind: "reference", expr: { kind: "dereference", pointer: captured.expression } });
      continue;
    }
    const name = context.input.program.names.nameForDeclaration(capture.declaration);
    if (name === undefined) failRustPlannerInvariant("An admitted lexical function requires its renderable native capture environment.", declaration);
    const raw = captured?.expression ?? { kind: "path" as const, path: name };
    if (storage !== undefined) {
      arguments_.push({ kind: "reference", expr: raw });
      continue;
    }
    const value = planExpressionBeforeValueProjections(capture.reference, context, "value");
    if (value === undefined) failRustPlannerInvariant("An admitted lexical function requires its renderable native capture environment.", declaration);
    arguments_.push({ kind: "reference", expr: value,
      ...(mutable ? { mutable: true } : {}) });
  }
  return arguments_;
}


