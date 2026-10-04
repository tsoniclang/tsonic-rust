import type { Node } from "@tsonic/tsts";
import type { RustClosureCaptureFact } from "../../../analysis/facts/operations/keys.js";
import { rustSourceBindingFactKey } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustCapturedBinding, RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, isValidRustIdentifier, rustSourceBindingPath } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustCaptureValue } from "./typed-locations.js";

export function planRustCapturedEnvironment(
  owner: Node, captures: RustClosureCaptureFact["captures"], context: RustPlanContext,
  options: { readonly staticStorage: boolean; readonly mutableValueCapture: boolean; readonly sharedStateName?: string },
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly capturedBindings: readonly RustCapturedBinding[] } | undefined {
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const capturedBindings = [...(context.capturedBindings ?? [])];
  for (const [index, capture] of captures.entries()) {
    const move = capture.storage === "cell" || capture.storage === "borrow-cell" ||
      context.input.program.valueLifetimes.canMoveCapture(owner, capture.declaration);
    if (context.syntheticNames === undefined || !requireRustCarrierRequirements(capture.carrier,
      [...(move ? [] : ["clone" as const]), ...(options.staticStorage ? ["static" as const] : [])],
      capture.reference, context)) return undefined;
    const binding = context.input.program.facts.getFact(capture.reference, rustSourceBindingFactKey);
    if (binding === undefined) return undefined;
    const functionValue = context.input.program.source.ast.is.IsFunctionDeclaration(binding.sourceDeclaration) &&
      context.input.program.lexicalFunctions.forDeclaration(binding.sourceDeclaration) !== undefined;
    const sourceName = (functionValue
      ? context.input.program.names.callableValueNameForDeclaration(binding.sourceDeclaration)
      : context.input.program.names.nameForDeclaration(binding.sourceDeclaration)) ?? "";
    const sourcePath = functionValue ? sourceName : rustSourceBindingPath(context, binding);
    if (!isValidRustIdentifier(sourceName) || sourcePath === undefined) return undefined;
    if (capture.mutable === true) {
      if (capture.storage !== "value" || !options.mutableValueCapture) {
        context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, owner),
          "rust.backend.native-mutable-capture", "A mutable value capture requires its exact owning native callable contract."));
        return undefined;
      }
      capturedBindings.push({ declaration: capture.declaration, expression: { kind: "path", path: sourcePath },
        storage: "value", valueCarrier: capture.carrier });
      continue;
    }
    const name = allocateRustSyntheticName(context.syntheticNames, `capture_${sourceName}`);
    bindings.push({ name, value: planRustCaptureValue(capture.reference, sourcePath, capture.storage, move, context) });
    capturedBindings.push({ declaration: capture.declaration,
      expression: options.sharedStateName === undefined ? { kind: "path", path: name } : {
        kind: "reference", expr: { kind: "field", receiver: {
          kind: "field", receiver: { kind: "path", path: options.sharedStateName }, name: "state",
        }, name: String(index) },
      }, storage: capture.storage, valueCarrier: capture.carrier,
      ...(options.sharedStateName === undefined ? {} : { borrowed: "shared" as const }) });
  }
  return { bindings, capturedBindings };
}
