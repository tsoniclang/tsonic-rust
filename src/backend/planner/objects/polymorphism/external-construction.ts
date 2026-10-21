import type { Node } from "@tsonic/tsts";
import type { RustProjectConstructorSignature } from "../../../../target-model/types/project-types.js";
import type { RustExternalProjectBase } from "../../../../target-model/types/external-project-types.js";

import { planFinalizedSourceInput } from "../../expressions/conversions.js";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { RustPlanContext } from "../../program/plan-context.js";

export function planRustExternalProjectInitialization(
  base: RustExternalProjectBase,
  signature: RustProjectConstructorSignature,
  declaration: Node,
  call: Node | undefined,
  context: RustPlanContext,
): readonly RustExpr[] | undefined {
  const message = call === undefined
    ? inheritedMessage(signature, context)
    : explicitMessage(call, context);
  if (message === undefined) {
    failRustPlannerInvariant("External project initialization requires its admitted native constructor signature and parameter ABI.", call ?? declaration);
  }
  return base.fields.map(field => field.initializer.kind === "none" ? { kind: "none" }
    : field.initializer.kind === "string" ? { kind: "string-literal", value: field.initializer.value } : message);
}

function inheritedMessage(
  signature: RustProjectConstructorSignature,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.inheritedExternalInitialization.get(signature);
  if (selected === undefined) failRustPlannerInvariant("An inherited external constructor requires its admitted native argument.", signature.declaration);
  return { kind: "method-call", receiver: { kind: "path", path: selected.name },
    method: "unwrap_or_default", args: [] };
}

function explicitMessage(
  call: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const initialization = context.input.program.records.externalProjectInitialization.get(call);
  if (initialization === undefined) failRustPlannerInvariant("An external constructor requires its admitted native argument plan.", call);
  if (initialization.kind === "empty") return { kind: "string-literal", value: "" };
  const value = planFinalizedSourceInput(context, initialization.input, undefined,
    context.input.program.source.ast.arguments(call), call);
  if (value === undefined) failRustPlannerInvariant("An external constructor requires its finalized native argument expression.", call);
  return initialization.kind === "value" ? value
    : { kind: "method-call", receiver: value, method: "unwrap_or_default", args: [] };
}
