import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSourcePackageErrorBoundary } from "../../../target-model/records/errors/source-package-errors.js";
import type { RustClosedErrorPayloadEmission, RustClosedErrorValueEmission } from "../../../target-model/records/errors/error-transport.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { lowerRustValueConversion } from "./value-conversions.js";

export function planRustProgramErrorClosedValue(value: RustExpr, target: TargetTypeRef, node: Node | undefined,
  context: RustPlanContext, boundary: RustSourcePackageErrorBoundary | undefined): RustExpr {
  if (boundary === undefined) failRustPlannerInvariant("An admitted closed error value requires its exact native boundary.", node ?? context.sourceFile);
  const selected = context.input.program.records.programErrorClosedValue.get(boundary.componentId, boundary.errorTypeIdentity, target);
  if (selected?.kind !== "selected") failRustPlannerInvariant("An admitted closed error value requires its sealed native payload conversion tree.", node ?? context.sourceFile);
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node ?? context.sourceFile, []);
  registerAliasFromPath(context, selected.ownerPath);
  const call = (path: string, value: RustExpr): RustExpr => ({ kind: "call", path, args: [value] });
  const error = (value: RustExpr): RustExpr => call(`${selected.ownerPath}::from_error`, value);
  const payload = (emission: RustClosedErrorPayloadEmission, value: RustExpr): RustExpr => {
    switch (emission.kind) {
      case "error": return error(value);
      case "suppressed": return error(call("tsonic_rust_runtime::RetainedError::Project", call("alloc::rc::Rc::new", value)));
      case "external": return render(emission.value, value);
      case "value": return emission.conversion === null ? value : lowerRustValueConversion(emission.conversion, value, context, node)
        ?? failRustPlannerInvariant("An admitted closed thrown payload requires its exact native value conversion.", node ?? context.sourceFile);
    }
  };
  const render = (emission: RustClosedErrorValueEmission, value: RustExpr, rootPath?: string): RustExpr => {
    if (emission.kind === "runtime") return error(value);
    const path = rootPath ?? emission.path;
    registerAliasFromPath(context, path);
    return { kind: "match", expression: value, arms: emission.arms.map(arm => {
      const name = allocateRustSyntheticName(names, "thrown_value");
      return { pattern: { kind: "tuple-variant", path: `${path}::${arm.name}`, elements: [{ kind: "binding", name }] },
        expression: payload(arm.payload, { kind: "path", path: name }) };
    }) };
  };
  return render(selected.value, value, boundary.errorTypePath);
}
