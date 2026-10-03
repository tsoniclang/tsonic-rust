import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import { rustProgramErrorConversionMatches, selectRustRuntimeErrorBoundary, type RustProgramErrorConversion } from "../../../target-model/conversions/program-error.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { diagnosticInput, registerAliasFromPath, rustCurrentErrorBoundary, type RustPlanContext } from "../program/plan-context.js";
import { resolveRustProgramErrorRoute, type RustSourcePackageErrorBoundary } from "../program/source-package-errors.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { planRustUnionFold } from "./union-folds.js";
import { isRustSourceErrorCarrier, isRustWritableSourceErrorCarrier } from "../../../target-model/types/carriers/source-error.js";

export function planRustProgramErrorConstruction(
  conversion: RustProgramErrorConversion,
  value: RustExpr,
  node: Node,
  context: RustPlanContext,
  boundary: RustSourcePackageErrorBoundary | undefined = rustCurrentErrorBoundary(context),
): RustExpr | undefined {
  if (boundary === undefined || !rustProgramErrorConversionMatches(conversion, conversion.source, conversion.target,
    context.input.program.typeDefinitions)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.program-error-construction", "Program error construction requires an exact carrier and error domain."));
    return undefined;
  }
  registerAliasFromPath(context, boundary.errorTypePath);
  const sourceError = isRustSourceErrorCarrier(conversion.target);
  const targetPath = sourceError ? isRustWritableSourceErrorCarrier(conversion.target) ? "rt::WritableSourceError" : "rt::SourceError" : boundary.errorTypePath;
  if (conversion.route.kind === "union") {
    return planRustUnionFold(value, conversion.route.arms, context, node,
      (arm, payload) => planRustProgramErrorConstruction({ ...conversion, source: arm.carrier, route: arm.route },
        payload, node, context, boundary));
  }
  if (conversion.route.kind === "runtime") {
    if (selectRustRuntimeErrorBoundary(conversion.source, context.input.program.providerErrorCarriers) !== conversion.route.boundary) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.throw-runtime-error-route", "Runtime error construction has no exact registered native error carrier."));
      return undefined;
    }
    return { kind: "call", path: `${targetPath}::from`, args: [sourceError && conversion.route.boundary === "provider-native"
      ? { kind: "call", path: "tsonic_rust_runtime::TsonicError::from", args: [value] } : value] };
  }
  if (conversion.route.kind === "source-error" || conversion.route.kind === "source-created") {
    return { kind: "call", path: `${targetPath}::from`, args: [value] };
  }
  const variant = conversion.route.variant;
  const definition = context.input.program.projectTypes.definitionForCarrier(conversion.source);
  const route = definition === undefined ||
    sourceError && !context.input.program.projectTypes.sourceErrorDefinitions.includes(definition) ||
    context.input.program.projectTypes.programErrorVariant(definition) !== variant ||
    !rustTargetTypeRefEquals(context.input.program.projectTypes.openCarrier(definition), conversion.source)
    ? undefined : resolveRustProgramErrorRoute(context.sourcePackageErrors, boundary.componentId, definition, variant);
  if (route === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.throw-project-error-route", "Project error construction has no exact route through the selected source-package error domain."));
    return undefined;
  }
  if (sourceError) {
    const admitted: RustExpr = route.kind === "local" ? value : {
      kind: "call", path: `${route.ownerTypePath.slice(0, -"TsonicError".length)}${isRustWritableSourceErrorCarrier(conversion.target) ? "WritableSourceError" : "SourceError"}::from`, args: [value],
    };
    return { kind: "call", path: `${targetPath}::from`, args: [admitted] };
  }
  return route.kind === "local"
    ? { kind: "call", path: `${boundary.errorTypePath}::${route.variant}`, args: [value] }
    : { kind: "call", path: `${boundary.errorTypePath}::${route.consumerVariant}`, args: [
      { kind: "call", path: `${route.ownerTypePath}::${route.ownerVariant}`, args: [value] },
    ] };
}
