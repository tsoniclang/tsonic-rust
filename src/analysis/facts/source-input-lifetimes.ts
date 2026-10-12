import type { AstReader, Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustSourceParameterAbiFactKey } from "./callables-and-resources.js";
import { rustLifetimeKey, rustLifetimesEqual, type RustSourceGenericParameterContract } from "../../target-model/lifetimes/index.js";
import { rustRetainedEnvironmentFactKey } from "./retained-environments.js";

export function rustCallableImplicitLifetimeParameters(
  declaration: Node,
  ast: AstReader,
  facts: RustPlanQueries,
): readonly RustSourceGenericParameterContract[] {
  if (sourceEnclosingCallable(declaration, ast) !== declaration) return Object.freeze([]);
  const parameters = rustCallableInputLifetimeParameters(declaration, ast, facts);
  const environment = facts.getFact(declaration, rustRetainedEnvironmentFactKey);
  return environment === undefined ? parameters : Object.freeze([...parameters, Object.freeze({
    kind: "lifetime" as const, declaration, sourceName: environment.lifetime.name,
    lifetime: environment.lifetime, outlives: Object.freeze([]),
  })]);
}

export function rustCallableInputLifetimeParameters(
  declaration: Node,
  ast: AstReader,
  facts: RustPlanQueries,
): readonly RustSourceGenericParameterContract[] {
  const retained = new Set<string>();
  return Object.freeze(ast.parameters(declaration).flatMap(parameter => {
    const abi = parameter === undefined ? undefined : facts.getFact(parameter, rustSourceParameterAbiFactKey);
    const lifetime = abi?.inputLifetime;
    if (parameter === undefined || lifetime === undefined || abi?.parameterCarrier.kind !== "reference" ||
      !rustLifetimesEqual(lifetime, abi.parameterCarrier.lifetime)) return [];
    const identity = rustLifetimeKey(lifetime);
    if (retained.has(identity)) return [];
    retained.add(identity);
    return [Object.freeze({ kind: "lifetime" as const, declaration: parameter, sourceName: lifetime.name,
      lifetime, outlives: Object.freeze([]) })];
  }));
}
