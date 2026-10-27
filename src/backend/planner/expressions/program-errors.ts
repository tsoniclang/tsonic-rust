import type { Node } from "@tsonic/tsts";
import type { RustProgramErrorConversion } from "../../../target-model/conversions/program-error.js";
import type { RustSourcePackageErrorBoundary } from "../../../target-model/records/errors/source-package-errors.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { registerAliasFromPath, rustCurrentErrorBoundary, type RustPlanContext } from "../program/plan-context.js";
import { resolveRustProgramErrorRoute } from "../program/source-package-errors.js";
import { rustTypeEmissionInContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { lowerRustValueConversion } from "./value-conversions.js";
import { planRustUnionFold } from "./union-folds.js";

export function planRustProgramErrorConstruction(conversion: RustProgramErrorConversion, value: RustExpr, node: Node,
  context: RustPlanContext, boundary: RustSourcePackageErrorBoundary | undefined = rustCurrentErrorBoundary(context)): RustExpr | undefined {
  if (boundary === undefined) failRustPlannerInvariant("An admitted program error construction requires its exact native error boundary.", node);
  registerAliasFromPath(context, boundary.errorTypePath);
  const storage = rustTypeEmissionInContext(conversion.target, context).errorStorage;
  const sourceError = storage?.kind === "source";
  const retainedError = storage?.kind === "retained";
  const path = storage?.path ?? boundary.errorTypePath;
  registerAliasFromPath(context, path);
  const route = conversion.route;
  if (route.kind === "closed" || route.kind === "closed-admission") {
    if (boundary.errorDomain !== "project" || boundary.componentId !== context.sourcePackageComponentId)
      failRustPlannerInvariant("An admitted closed thrown value requires its own source-package payload transport.", node);
    const contract = route.kind === "closed-admission" ? context.input.program.records.conversionContract.get(route.admission) : undefined;
    if (route.kind === "closed-admission" && (contract === undefined || contract.fallible))
      failRustPlannerInvariant("An admitted closed thrown value requires its exact infallible payload conversion.", node);
    const payload = contract === undefined ? value : lowerRustValueConversion(contract, value, context, node);
    return payload === undefined ? undefined : { kind: "call", path: `${path}::from`, args: [payload] };
  }
  if (route.kind === "union") return planRustUnionFold(value, route.arms, context, node,
    (arm, payload) => planRustProgramErrorConstruction({ ...conversion, source: arm.carrier, route: arm.route }, payload, node, context, boundary));
  if (route.kind === "runtime") return { kind: "call", path: `${path}::from`, args: [(sourceError || retainedError) && route.boundary === "provider-native"
    ? { kind: "call", path: "tsonic_rust_runtime::TsonicError::from", args: [value] } : value] };
  if (route.kind === "source-error" || route.kind === "source-created" || route.kind === "retained")
    return { kind: "call", path: `${path}::from`, args: [value] };
  const definition = context.input.program.records.projectType.get(conversion.source);
  const project = definition === undefined ? undefined : context.input.program.records.projectError.get(definition);
  if (project === undefined || project.variant !== route.variant || !rustTargetTypeRefEquals(project.carrier, conversion.source) || sourceError && !project.sourceError)
    failRustPlannerInvariant("An admitted project error requires its exact source-package variant identity.", node);
  if (retainedError && project.sourceError) return { kind: "call", path: `${path}::from`, args: [value] };
  const selected = definition === undefined ? undefined : resolveRustProgramErrorRoute(context.input.program.records, boundary.componentId, definition, route.variant);
  if (selected === undefined) failRustPlannerInvariant("An admitted project error requires its exact native package transport route.", node);
  if (sourceError) {
    const payload: RustExpr = selected.kind === "local" ? value : { kind: "call",
      path: `${storage.writable ? selected.writableSourceErrorTypePath : selected.sourceErrorTypePath}::from`, args: [value] };
    return { kind: "call", path: `${path}::from`, args: [payload] };
  }
  return selected.kind === "local" ? { kind: "call", path: `${boundary.errorTypePath}::${selected.variant}`, args: [value] }
    : { kind: "call", path: `${boundary.errorTypePath}::${selected.consumerVariant}`, args: [
      { kind: "call", path: `${selected.ownerTypePath}::${selected.ownerVariant}`, args: [value] },
    ] };
}
