import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustJsValueTargetType, rustTsValueTargetType } from "../../../target-model/types/index.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, registerAliasFromPath, rustCurrentErrorBoundary,
  type RustPlanContext } from "../program/plan-context.js";
import { planRustErrorVariants } from "../program/error-variants.js";
import type { RustErrorPayloadVariant } from "../../../analysis/program/error-transport.js";
import { resolveRustSourcePackageErrorBoundary,
  type RustSourcePackageErrorBoundary } from "../program/source-package-errors.js";
import { lowerRustValueConversion } from "./value-conversions.js";

export function planRustProgramErrorClosedValue(
  value: RustExpr,
  target: TargetTypeRef,
  node: Node | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  const ownerPath = rustTargetTypeRefEquals(target, rustTsValueTargetType()) ? "rt::TsValue"
    : rustTargetTypeRefEquals(target, rustJsValueTargetType()) ? "js_abi::JsValue" : undefined;
  const boundary = rustCurrentErrorBoundary(context);
  if (ownerPath === undefined || boundary === undefined) return reject(
    "Program-error value admission requires an exact native error domain and closed destination.");
  registerAliasFromPath(context, ownerPath);
  const names = context.syntheticNames ?? createRustSyntheticNameState(
    context.input.program.source.ast, node ?? context.sourceFile, []);
  const active = new Set<string>();
  let reservations = 0;
  const call = (path: string, input: RustExpr): RustExpr => ({ kind: "call", path, args: [input] });
  const error = (payload: RustExpr): RustExpr => call(`${ownerPath}::from_error`, payload);
  const convert = (variant: Extract<RustErrorPayloadVariant, { readonly kind: "project" | "closed" }>,
    payload: RustExpr): RustExpr | undefined => {
    const admission = variant.admissions.find(candidate => rustTargetTypeRefEquals(candidate.target, target));
    if (admission?.conversion === null && rustTargetTypeRefEquals(variant.carrier, target)) return payload;
    const conversion = admission?.conversion;
    const contract = conversion === undefined ? undefined
      : conversion === null ? undefined : rustValueConversionContract(conversion, context.input.program.typeDefinitions);
    return contract === undefined || contract.fallible || contract.lowering === "program-error-closed-value" ||
      !rustTargetTypeRefEquals(contract.source, variant.carrier) || !rustTargetTypeRefEquals(contract.target, target)
      ? reject("A sealed thrown payload has no exact infallible conversion to the selected closed destination.")
      : lowerRustValueConversion(contract, payload, context, node);
  };
  const fold = (
    expression: RustExpr,
    selected: RustSourcePackageErrorBoundary,
  ): RustExpr | undefined => {
    if (++reservations > 65_536 || active.size >= 256) {
      return reject("Program-error value admission exceeds its bounded acyclic component graph.");
    }
    if (selected.errorDomain === "runtime") return error(expression);
    const selectedDomain = context.sourcePackageErrors.domainsByComponentId.get(selected.componentId);
    const domain = selectedDomain?.forwardModulePath === undefined ? selectedDomain
      : selectedDomain.errorOwnerComponentId === undefined ? undefined
        : context.sourcePackageErrors.domainsByComponentId.get(selectedDomain.errorOwnerComponentId);
    const variants = domain === undefined ? undefined
      : planRustErrorVariants(context.input.program, domain);
    if (domain === undefined || variants === undefined || selectedDomain?.errorTypeIdentity !== selected.errorTypeIdentity ||
      domain.errorTypeIdentity !== selected.errorTypeIdentity) return reject(
      "Program-error value admission has no exact sealed transport variant inventory.");
    if (active.has(domain.componentId)) return reject(
      "Program-error value admission exceeds its bounded acyclic component graph.");
    registerAliasFromPath(context, selected.errorTypePath);
    active.add(domain.componentId);
    try {
      const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
      const add = (name: string, convertPayload: (payload: RustExpr) => RustExpr | undefined): boolean => {
        if (++reservations > 65_536) {
          reject("Program-error value admission exceeds its bounded acyclic component graph.");
          return false;
        }
        const bindingName = allocateRustSyntheticName(names, "thrown_value");
        const payload: RustExpr = { kind: "path", path: bindingName };
        const converted = convertPayload(payload);
        if (converted === undefined) return false;
        arms.push({ pattern: { kind: "tuple-variant", path: `${selected.errorTypePath}::${name}`,
          elements: [{ kind: "binding", name: bindingName }] }, expression: converted });
        return true;
      };
      if (!add("Runtime", error) || !add("SourceCreated", error)) return undefined;
      for (const variant of variants) {
        if (!add(variant.name, payload => {
          if (variant.kind === "retained") return error(payload);
          if (variant.kind === "project" || variant.kind === "closed") return convert(variant, payload);
          const external = resolveRustSourcePackageErrorBoundary(context.sourcePackageErrors,
            domain.componentId, variant.external.componentId);
          return external === undefined ? reject(
            "A sealed external thrown payload has no exact source-package error boundary.")
            : fold(payload, { ...external, errorTypePath: variant.external.typePath });
        })) return undefined;
      }
      if (!add("Suppressed", payload => error(call("tsonic_rust_runtime::RetainedError::Project",
        call("alloc::rc::Rc::new", payload))))) return undefined;
      return { kind: "match", expression, arms };
    } finally {
      active.delete(domain.componentId);
    }
  };
  return fold(value, boundary);

  function reject(message: string): undefined {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.program-error-closed-value", message));
    return undefined;
  }
}
