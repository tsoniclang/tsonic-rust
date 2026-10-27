import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourcePackageErrorPlan, RustSourcePackageErrorBoundary } from "../../target-model/records/errors/source-package-errors.js";
import type { RustClosedErrorValueEmission, RustClosedErrorPayloadEmission, RustClosedErrorValueSelection } from "../../target-model/records/errors/error-transport.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustJsRejectionConversion } from "../../target-model/records/errors/error-regions.js";
import type { RustErrorTransportEmissionProducer } from "../program/records/errors/error-transport.js";
import type { RustConversionEmissionProducer } from "../program/records/operations/conversion-emission.js";
import { admitRustConversionEmission } from "../conversions/emission.js";
import { rustTsValueTargetType, rustJsValueTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustRuntimeErrorTypeIdentity } from "../../target-model/types/carriers/runtime-carriers.js";
import type { RustProgramErrorRoute } from "../../target-model/conversions/program-error.js";
import { isSourceCallableBodyBoundary, TryStatement_CatchClause, TryStatement_TryBlock } from "@tsonic/target-api/source";

export function analyzeRustClosedErrorValues(program: Omit<RustAnalysisProgram, "reachability">, errors: RustSourcePackageErrorPlan,
  nodes: readonly Node[], producer: RustErrorTransportEmissionProducer, conversions: RustConversionEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  for (const component of errors.domainsByComponentId.keys()) {
    const boundary = program.records.sourcePackageErrorBoundary.get(component, component);
    if (boundary === undefined) continue;
    for (const [target, ownerPath] of [[rustTsValueTargetType(), "rt::TsValue"], [rustJsValueTargetType(), "js_abi::JsValue"]] as const) {
      const active = new Set<string>();
      let reservations = 0;
      let reason: string | undefined;
      const reject = (message: string): undefined => { reason ??= message; return undefined; };
      const fold = (boundary: RustSourcePackageErrorBoundary): RustClosedErrorValueEmission | undefined => {
        if (++reservations > 65_536 || active.size >= 256 || active.has(boundary.componentId))
          return reject("Program-error value admission exceeds its bounded acyclic component graph.");
        if (boundary.errorDomain === "runtime") return Object.freeze({ kind: "runtime" });
        const inventory = producer.records.boundaryErrorVariants.get(boundary.componentId, boundary.errorTypeIdentity);
        if (inventory === undefined) return reject("Program-error value admission has no exact sealed transport variant inventory.");
        active.add(boundary.componentId);
        const arms: { readonly name: string; readonly payload: RustClosedErrorPayloadEmission }[] = [
          Object.freeze({ name: "Runtime", payload: Object.freeze({ kind: "error" }) }),
          Object.freeze({ name: "SourceCreated", payload: Object.freeze({ kind: "error" }) }),
        ];
        for (const variant of inventory.variants) {
          if (++reservations > 65_536) { active.delete(boundary.componentId); return reject("Program-error value admission exceeds its bounded acyclic component graph."); }
          let payload: RustClosedErrorPayloadEmission;
          if (variant.kind === "retained") payload = { kind: "error" };
          else if (variant.kind === "external") {
            const external = program.records.sourcePackageErrorBoundary.get(inventory.domain.componentId, variant.external.componentId);
            const value = external === undefined ? undefined : fold({ ...external, errorTypePath: variant.external.typePath });
            if (value === undefined) { active.delete(boundary.componentId); return reject("A sealed external thrown payload has no exact source-package error boundary."); }
            payload = { kind: "external", value };
          } else {
            const admission = variant.admissions.find(admission => rustTargetTypeRefEquals(admission.target, target));
            if (admission === undefined) { active.delete(boundary.componentId); return reject("A sealed thrown payload has no exact infallible conversion to the selected closed destination."); }
            const conversion = admission.conversion === null ? null : admitRustConversionEmission(conversions, admission.conversion, program.typeDefinitions);
            if (conversion !== null && (conversion.fallible || conversion.lowering === "program-error-closed-value" ||
              !rustTargetTypeRefEquals(conversion.source, variant.carrier) || !rustTargetTypeRefEquals(conversion.target, target))) {
              active.delete(boundary.componentId); return reject("A sealed thrown payload has no exact infallible conversion to the selected closed destination.");
            }
            payload = { kind: "value", conversion };
          }
          arms.push(Object.freeze({ name: variant.name, payload: Object.freeze(payload) }));
        }
        arms.push(Object.freeze({ name: "Suppressed", payload: Object.freeze({ kind: "suppressed" }) }));
        active.delete(boundary.componentId);
        return Object.freeze({ kind: "domain", path: boundary.errorTypePath, arms: Object.freeze(arms) });
      };
      const value = fold(boundary);
      const selection: RustClosedErrorValueSelection = value === undefined
        ? Object.freeze({ kind: "rejected", reason: reason ?? "Program-error value admission requires its exact native error domain." })
        : Object.freeze({ kind: "selected", ownerPath, value });
      producer.closedValue(component, boundary.errorTypeIdentity, target, selection);
      if (boundary.errorTypeIdentity !== rustRuntimeErrorTypeIdentity) producer.closedValue(component, rustRuntimeErrorTypeIdentity, target,
        Object.freeze({ kind: "selected", ownerPath, value: Object.freeze({ kind: "runtime" }) }));
    }
  }
  const required = (node: Node, target: TargetTypeRef, boundary: RustSourcePackageErrorBoundary | undefined): void => {
    const selected = boundary === undefined ? undefined : producer.records.programErrorClosedValue.get(boundary.componentId, boundary.errorTypeIdentity, target);
    if (selected?.kind === "selected") return;
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${selected?.reason ?? "Program-error value admission requires an exact native error domain and closed destination."} Node kind: ${program.source.ast.kindName(node)}.`,
      evidence: ["target.capability=rust.backend.program-error-closed-value"] });
  };
  const rejection = (node: Node, component: string, conversion: RustJsRejectionConversion): void => {
    if (conversion.kind === "native-join") { for (const arm of conversion.arms) rejection(node, component, arm); return; }
    if (conversion.kind === "program-error") required(node, rustJsValueTargetType(), program.records.physicalProgramErrorBoundary.get(component, conversion.owner));
  };
  // A closed thrown value is transported only by the project error domain of its own source package; a runtime domain
  // or a forwarded boundary cannot carry it, so the program is refused here instead of reaching planning.
  const closedRoute = (route: RustProgramErrorRoute): boolean => route.kind === "closed" || route.kind === "closed-admission" ||
    route.kind === "union" && route.arms.some(arm => closedRoute(arm.route));
  // The error boundary the planner constructs a throw against: the package boundary in the body of a try with a catch
  // clause, otherwise the physical owner of the enclosing callable's error region, and the package boundary outside
  // every callable.
  const throwOwner = (node: Node, component: string): RustSourcePackageErrorBoundary | undefined => {
    const { ast } = program.source;
    let child = node;
    for (let current = ast.parent(node); current !== undefined; child = current, current = ast.parent(current)) {
      if (ast.is.IsTryStatement(current) && TryStatement_TryBlock(ast, current) === child && TryStatement_CatchClause(ast, current) !== undefined)
        return program.records.sourcePackageErrorBoundary.get(component, component);
      if (isSourceCallableBodyBoundary(ast, current)) {
        const owner = program.records.nativeErrorRegion.get(current)?.localOwner;
        return owner === undefined ? undefined : program.records.physicalProgramErrorBoundary.get(component, owner);
      }
    }
    return program.records.sourcePackageErrorBoundary.get(component, component);
  };
  const closedThrow = (node: Node, component: string): void => {
    const operation = program.records.targetOperation.get(node);
    const thrown = operation?.kind === "throw-op" && operation.error.kind === "conversion" ? operation.error.conversion : undefined;
    const contextual = program.records.contextualValueConversion.get(node)?.conversion;
    const conversion = thrown ?? (contextual?.kind === "program-error" ? contextual : undefined);
    if (conversion === undefined || !closedRoute(conversion.route)) return;
    const boundary = thrown === undefined ? program.records.sourcePackageErrorBoundary.get(component, component)
      : throwOwner(node, component);
    if (boundary !== undefined && boundary.errorDomain === "project" && boundary.componentId === component) return;
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `Closed thrown values require their own sealed source-package payload transport. Node kind: ${program.source.ast.kindName(node)}.`,
      evidence: ["target.capability=rust.backend.closed-throw-domain"] });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const file = program.source.ast.getSourceFile(node);
    const component = file === undefined ? undefined : program.sourcePackageComponents.componentForFile(program.source.ast.getFileName(file));
    if (component === undefined) continue;
    closedThrow(node, component.componentId);
    const region = program.records.nativeErrorRegion.get(node);
    if (region?.jsRejection !== undefined) {
      if (region.jsRejection.local !== undefined) rejection(node, component.componentId, region.jsRejection.local);
      for (const source of region.jsRejection.sources) rejection(node, component.componentId, source.conversion);
    }
  }
  return Object.freeze(issues);
}
