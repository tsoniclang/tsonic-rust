import type { AstReader, Node } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustSourceParameterAbiFactKey } from "./callables-and-resources.js";
import { rustLifetimesEqual, type RustSourceGenericParameterContract } from "../../target-model/lifetimes/index.js";
import { rustCallableInputProtocol } from "../../target-model/types/carriers/callables.js";

export function rustCallableInputLifetimeParameters(
  declaration: Node,
  ast: AstReader,
  facts: RustPlanQueries,
): readonly RustSourceGenericParameterContract[] {
  return Object.freeze(ast.parameters(declaration).flatMap(parameter => {
    const abi = parameter === undefined ? undefined : facts.getFact(parameter, rustSourceParameterAbiFactKey);
    const lifetime = abi?.inputLifetime;
    if (parameter === undefined || lifetime === undefined || abi?.parameterCarrier.kind !== "reference" ||
      !rustLifetimesEqual(lifetime, abi.parameterCarrier.lifetime) || rustCallableInputProtocol(abi.parameterCarrier) === undefined) return [];
    return [Object.freeze({ kind: "lifetime" as const, declaration: parameter, sourceName: lifetime.name,
      lifetime, outlives: Object.freeze([]) })];
  }));
}
