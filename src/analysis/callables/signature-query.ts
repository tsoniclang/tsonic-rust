import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableTargetType } from "../../target-model/types/carriers/callables.js";
import { rustCallableInvocationResult } from "./results.js";
import { recordFunctionSignatureFacts } from "./signatures.js";

export function resolveRustCallableSignatureCarrier(
  walk: RustFactWalk,
  declaration: Node,
): TargetTypeRef | undefined {
  const { ast, records } = walk.context;
  if (walk.resolvingCallableSignatures.has(declaration) || ast.body(declaration) === undefined ||
    !ast.is.IsFunctionDeclaration(declaration) && !ast.is.IsArrowFunction(declaration) && !ast.is.IsFunctionExpression(declaration) ||
    ast.typeParameters(declaration).length !== 0) return undefined;
  walk.resolvingCallableSignatures.add(declaration);
  try {
    recordFunctionSignatureFacts(walk, declaration);
    const parameters = ast.parameters(declaration).map(parameter => parameter === undefined ? undefined
      : records.sourceParameterAbi.get(parameter)?.parameterCarrier);
    const result = rustCallableInvocationResult(records, declaration);
    return result === undefined || parameters.some(parameter => parameter === undefined) ? undefined
      : rustCallableTargetType(parameters as readonly TargetTypeRef[], result);
  } finally {
    walk.resolvingCallableSignatures.delete(declaration);
  }
}
