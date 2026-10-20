import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext, rustTypeEmissionInContext } from "./render.js";

export function rustCallableConstructionType(carrier: TargetTypeRef, context: RustPlanContext): RustType | undefined {
  const type = rustTypeFromCarrierInContext(carrier, context, "return");
  const selected = rustTypeEmissionInContext(carrier, context).constructionArguments;
  return type?.kind !== "named" || type.genericArguments === undefined ? type : { ...type,
    genericArguments: type.genericArguments.map((argument, index) => argument.kind === "type" && selected?.[index] === true
      ? { kind: "type", type: { kind: "infer" } } : argument) };
}
