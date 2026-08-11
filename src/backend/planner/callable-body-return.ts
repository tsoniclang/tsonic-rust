import type { RustGeneratorFact } from "../../source/rust-facts/keys.js";
import type { RustType } from "../rust-ast/nodes.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";

export function resolveRustCallableBodyReturnType(
  outwardReturnType: RustType | undefined,
  generator: RustGeneratorFact | undefined,
  context: RustPlanContext,
): RustType | undefined {
  if (generator === undefined) {
    return outwardReturnType ?? { kind: "unit" };
  }
  return rustTypeFromCarrierInContext(generator.returnType, context);
}
