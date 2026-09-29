import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import { rustProgramErrorConversionMatches, type RustProgramErrorConversion } from "../../../target-model/conversions/program-error.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { diagnosticInput, registerAliasFromPath, rustCurrentErrorBoundary, type RustPlanContext } from "../program/plan-context.js";
import { resolveRustProgramErrorRoute, type RustSourcePackageErrorBoundary } from "../program/source-package-errors.js";
import { missingFactDiagnostic } from "../diagnostics.js";

export function planRustProgramErrorConstruction(
  conversion: RustProgramErrorConversion,
  value: RustExpr,
  node: Node,
  context: RustPlanContext,
  boundary: RustSourcePackageErrorBoundary | undefined = rustCurrentErrorBoundary(context),
): RustExpr | undefined {
  if (boundary === undefined || !rustProgramErrorConversionMatches(conversion, conversion.source, conversion.target)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.program-error-construction", "Program error construction requires an exact carrier and error domain."));
    return undefined;
  }
  registerAliasFromPath(context, boundary.errorTypePath);
  if (conversion.variant === undefined) return { kind: "call", path: `${boundary.errorTypePath}::from`, args: [value] };
  const definition = context.input.program.projectTypes.definitionForCarrier(conversion.source);
  const route = definition === undefined ||
    context.input.program.projectTypes.programErrorVariant(definition) !== conversion.variant ||
    !rustTargetTypeRefEquals(context.input.program.projectTypes.openCarrier(definition), conversion.source)
    ? undefined : resolveRustProgramErrorRoute(context.sourcePackageErrors, boundary.componentId, definition, conversion.variant);
  if (route === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.throw-project-error-route", "Project error construction has no exact route through the selected source-package error domain."));
    return undefined;
  }
  return route.kind === "local"
    ? { kind: "call", path: `${boundary.errorTypePath}::${route.variant}`, args: [value] }
    : { kind: "call", path: `${boundary.errorTypePath}::${route.consumerVariant}`, args: [
      { kind: "call", path: `${route.ownerTypePath}::${route.ownerVariant}`, args: [value] },
    ] };
}
