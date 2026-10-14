import { Node_Initializer } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import { recordParameterAbiFacts } from "../declarations/types-and-bindings.js";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCallableProtocol, rustClosureProtocol, rustSourceOptionalTargetType } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { selectRustClosedCallableContext } from "./contextual-inputs.js";

export function recordCallableParameterSignatureFacts(walk: RustFactWalk, declaration: Node): TargetTypeRef | undefined {
  const parameters = requireDenseSourceNodes(walk, walk.context.ast.parameters(declaration), "Function declaration contains an undefined or non-data parameter slot.");
  if (parameters === undefined) return undefined;
  const signature = walk.context.ast.is.IsArrowFunction(declaration) || walk.context.ast.is.IsFunctionExpression(declaration)
    ? resolveRustTargetTypeRef(declaration,
        { ...rustResolutionContext(walk, declaration), callableRepresentation: "signature" }, walk.operationOptions)
    : undefined;
  const contextual = selectRustClosedCallableContext(walk, declaration, signature);
  const logical = rustCallableProtocol(signature) ?? rustClosureProtocol(signature);
  const protocol = rustCallableProtocol(contextual) ?? rustClosureProtocol(contextual);
  for (const [index, parameter] of parameters.entries()) {
    const input = protocol?.parameters[index];
    const selected = rustTargetTypeRefEquals(input, logical?.parameters[index]) ? undefined : input;
    recordParameterAbiFacts(walk, parameter, selected === undefined || Node_Initializer(walk.context.ast, parameter) === undefined
      ? selected : rustSourceOptionalTargetType(selected));
  }
  return contextual;
}
