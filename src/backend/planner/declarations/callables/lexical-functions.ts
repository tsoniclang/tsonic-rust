import type { Node } from "@tsonic/tsts";
import { rustBindingStorageFactKey } from "../../../../analysis/facts/keys.js";
import type { RustExpr, RustType } from "../../../target-ast/nodes.js";
import { rustInlineBindingStorageType } from "../../expressions/binding-storage.js";
import { planExpression } from "../../expressions/entry.js";
import { planRustNonConsumingValue } from "../../expressions/typed-locations.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { diagnosticInput, type RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustCarrierHasCopyContract } from "../../types/generic-requirements.js";

export function planRustLexicalFunctionEnvironment(declaration: Node, context: RustPlanContext) {
  const selection = context.input.program.lexicalFunctions.forDeclaration(declaration);
  if (selection === undefined) return { parameters: [], context };
  if (selection.kind === "unresolved" || context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
      "rust.backend.lexical-function-environment", selection.kind === "unresolved" ? selection.reason :
        "Lexical function parameters require their exact hygienic-name owner."));
    return undefined;
  }
  const parameters: { name: string; type: RustType }[] = [];
  const capturedBindings = [...(context.capturedBindings ?? [])];
  for (const capture of selection.captures) {
    const carrier = context.input.program.facts.getRuntimeCarrierFact(capture.declaration)?.carrier ??
      context.input.program.facts.getRuntimeCarrierFact(capture.reference)?.carrier;
    const valueType = carrier === undefined ? undefined : rustTypeFromCarrierInContext(carrier, context);
    const storage = context.input.program.facts.getFact(capture.declaration, rustBindingStorageFactKey);
    if (valueType === undefined || carrier === undefined) return undefined;
    const physicalType: RustType = storage?.storage === "location"
      ? { kind: "named", path: "rt::Location", genericArguments: [{ kind: "type", type: valueType }] }
      : storage === undefined ? valueType : rustInlineBindingStorageType(storage.storage, valueType);
    const name = allocateRustSyntheticName(context.syntheticNames, "capture");
    const owned = storage === undefined && !capture.mutable &&
      (rustCarrierHasCopyContract(carrier, context) ||
        !selection.valueObserved && context.input.program.valueLifetimes.canMoveCapture(declaration, capture.declaration));
    parameters.push({ name, type: owned ? physicalType : { kind: "reference", referent: physicalType,
      mutable: storage === undefined && capture.mutable } });
    capturedBindings.push({ declaration: capture.declaration, expression: { kind: "path", path: name },
      storage: storage?.storage ?? "value", valueCarrier: carrier,
      ...(owned ? {} : { borrowed: storage === undefined && capture.mutable ? "mutable" as const : "shared" as const }) });
    if (storage?.storage === "location") context.usedAliases?.add("rt");
  }
  return { parameters, context: { ...context, capturedBindings } };
}

export function planRustLexicalFunctionArguments(declaration: Node, context: RustPlanContext): readonly RustExpr[] | undefined {
  const selection = context.input.program.lexicalFunctions.forDeclaration(declaration);
  if (selection === undefined) return [];
  if (selection.kind === "unresolved") return undefined;
  const arguments_: RustExpr[] = [];
  for (const capture of selection.captures) {
    const captured = [...(context.capturedBindings ?? [])].reverse().find(value => value.declaration === capture.declaration);
    const storage = context.input.program.facts.getFact(capture.declaration, rustBindingStorageFactKey);
    const mutable = storage === undefined && capture.mutable;
    const carrier = context.input.program.facts.getRuntimeCarrierFact(capture.declaration)?.carrier ??
      context.input.program.facts.getRuntimeCarrierFact(capture.reference)?.carrier;
    const owned = storage === undefined && !capture.mutable &&
      (carrier !== undefined && rustCarrierHasCopyContract(carrier, context) ||
        !selection.valueObserved && context.input.program.valueLifetimes.canMoveCapture(declaration, capture.declaration));
    if (owned) {
      const value = planExpression(capture.reference, context);
      if (value === undefined) return undefined;
      arguments_.push(value);
      continue;
    }
    if (captured?.borrowed !== undefined) {
      if (mutable && captured.borrowed !== "mutable") {
        context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
          "rust.backend.lexical-function-borrow", "A mutable lexical call lost its exact mutable environment borrow."));
        return undefined;
      }
      arguments_.push(mutable
        ? { kind: "reference", expr: { kind: "dereference", pointer: captured.expression }, mutable: true }
        : captured.borrowed === "shared" ? captured.expression
        : { kind: "reference", expr: { kind: "dereference", pointer: captured.expression } });
      continue;
    }
    const name = context.input.program.names.nameForDeclaration(capture.declaration);
    if (name === undefined) return undefined;
    const raw = captured?.expression ?? { kind: "path" as const, path: name };
    if (storage !== undefined) {
      arguments_.push({ kind: "reference", expr: raw });
      continue;
    }
    const value = planExpression(capture.reference, context);
    if (value === undefined) return undefined;
    arguments_.push({ kind: "reference", expr: planRustNonConsumingValue(capture.reference, value, context),
      ...(mutable ? { mutable: true } : {}) });
  }
  return arguments_;
}
