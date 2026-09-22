import type { Node } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustAsyncFunctionFactKey, rustGeneratorFactKey, rustSourceCallableReturnFactKey } from "./callables-and-resources.js";

export function rustCallableInvocationResult(
  facts: RustPlanQueries, declaration: Node,
): TargetTypeRef | undefined {
  return facts.getFact(declaration, rustGeneratorFactKey)?.resultCarrier ??
    facts.getFact(declaration, rustAsyncFunctionFactKey)?.futureCarrier ??
    facts.getFact(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
}
