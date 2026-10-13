import type { AstReader, Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import { rustLifetimeKey, rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import type { RustSourceGenericParameterContract } from "../../target-model/lifetimes/index.js";

export function rustCallableImplicitLifetimeParameters(
  declaration: Node,
  ast: AstReader,
  records: RustProgramRecords,
): readonly RustSourceGenericParameterContract[] {
  if (sourceEnclosingCallable(declaration, ast) !== declaration) return Object.freeze([]);
  const parameters = rustCallableInputLifetimeParameters(declaration, ast, records);
  const environment = records.retainedEnvironment.get(declaration);
  return environment === undefined ? parameters : Object.freeze([...parameters, Object.freeze({
    kind: "lifetime" as const, declaration, sourceName: environment.lifetime.name,
    lifetime: environment.lifetime, outlives: Object.freeze([]),
  })]);
}

export function rustCallableInputLifetimeParameters(
  declaration: Node,
  ast: AstReader,
  records: RustProgramRecords,
): readonly RustSourceGenericParameterContract[] {
  const retained = new Set<string>();
  return Object.freeze(ast.parameters(declaration).flatMap(parameter => {
    const abi = parameter === undefined ? undefined : records.sourceParameterAbi.get(parameter);
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
