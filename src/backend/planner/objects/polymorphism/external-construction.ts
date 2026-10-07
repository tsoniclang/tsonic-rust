import type { Node } from "@tsonic/tsts";
import type { RustProjectConstructorSignature } from "../../../../target-model/types/project-types.js";
import type { RustExternalProjectBase } from "../../../../target-model/types/external-project-types.js";
import { rustSourceParameterAbiFactKey } from "../../../../analysis/facts/keys.js";
import { rustSourceOptionalTargetType, rustStringTargetType } from "../../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustTargetIdentifier } from "../../../../target-model/names/identifiers.js";
import { planFinalizedSourceInput } from "../../expressions/conversions.js";
import type { RustExpr } from "../../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { diagnosticInput, type RustPlanContext } from "../../program/plan-context.js";

export function planRustExternalProjectInitialization(
  base: RustExternalProjectBase,
  signature: RustProjectConstructorSignature,
  declaration: Node,
  call: Node | undefined,
  context: RustPlanContext,
): readonly RustExpr[] | undefined {
  const message = call === undefined
    ? inheritedMessage(base, signature, context)
    : explicitMessage(call, context);
  if (message === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, call ?? declaration),
      "rust.backend.external-project-constructor",
      "External project initialization requires the exact selected native constructor signature and parameter ABI."));
    return undefined;
  }
  return base.fields.map(field => field.initializer.kind === "none" ? { kind: "none" }
    : field.initializer.kind === "string" ? { kind: "string-literal", value: field.initializer.value } : message);
}

function inheritedMessage(
  base: RustExternalProjectBase,
  signature: RustProjectConstructorSignature,
  context: RustPlanContext,
): RustExpr | undefined {
  const parameter = signature.parameters[0];
  const abi = parameter === undefined ? undefined
    : context.input.program.facts.getFact(parameter.parameterDeclaration, rustSourceParameterAbiFactKey);
  if (!signature.implicit || signature.declaration === undefined ||
    !base.constructorDeclarations.includes(signature.declaration) || signature.parameters.length !== 1 ||
    parameter === undefined || !parameter.acceptsOmission || parameter.rest || abi?.form !== "optional" ||
    abi.mode !== "value" || !rustTargetTypeRefEquals(abi.parameterCarrier, rustSourceOptionalTargetType(rustStringTargetType())) ||
    !rustTargetTypeRefEquals(abi.valueCarrier, abi.parameterCarrier) ||
    base.fields.some(field => field.initializer.kind === "message" && field.initializer.parameterIndex !== 0)) return undefined;
  return { kind: "method-call", receiver: { kind: "path", path: rustTargetIdentifier(parameter.parameterName) },
    method: "unwrap_or_default", args: [] };
}

function explicitMessage(
  call: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const initialization = context.input.program.projectConstructions.externalInitializationForCall(call);
  if (initialization === undefined) return undefined;
  if (initialization.kind === "empty") return { kind: "string-literal", value: "" };
  const value = planFinalizedSourceInput(context, initialization.input, undefined,
    context.input.program.source.ast.arguments(call), call);
  if (value === undefined) return undefined;
  return initialization.kind === "value" ? value
    : { kind: "method-call", receiver: value, method: "unwrap_or_default", args: [] };
}
