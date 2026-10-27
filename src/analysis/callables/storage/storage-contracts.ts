import type { RustSourceGenericContract } from "../../../target-model/lifetimes/index.js";

import type { AstReader, Node } from "@tsonic/tsts";
import type { RustLifetimeIndex, RustSourceGenericParameterContract } from "../../../target-model/lifetimes/index.js";

export function rustEnclosingStorageContract(
  subject: Node, ast: AstReader, lifetimes: RustLifetimeIndex,
): RustSourceGenericContract {
  const parameters = new Map<Node, RustSourceGenericParameterContract>();
  for (let owner: Node | undefined = subject; owner !== undefined; owner = ast.parent(owner)) {
    for (const parameter of lifetimes.contractFor(owner)?.parameters ?? []) {
      parameters.set(parameter.declaration, parameter);
    }
  }
  return { declaration: subject, parameters: [...parameters.values()] };
}
