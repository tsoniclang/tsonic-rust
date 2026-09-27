import type { ArgumentPassingMode, AstReader, Node } from "@tsonic/tsts";
import type {
  RustArgumentMode,
} from "./keys.js";
import { rustTargetOperationFactKey } from "./operations/keys.js";
import { rustArgumentPassingKey } from "../../target-model/facts/selections.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";

export function rustArgumentPassingMode(mode: RustArgumentMode): ArgumentPassingMode {
  switch (mode) {
    case "ref":
      return "borrow-shared";
    case "mut-ref":
      return "borrow-mut";
    case "value":
      return "by-value";
  }
}

export function rustCallArgumentIsOwned(argument: Node, ast: AstReader, facts: RustPlanQueries): boolean {
  const call = ast.parent(argument);
  if (call === undefined || !(ast.is.IsCallExpression(call) || ast.is.IsNewExpression(call)) ||
    !ast.arguments(call).includes(argument) || facts.get(argument, rustArgumentPassingKey)?.mode !== "by-value") {
    return false;
  }
  const operation = facts.get(call, rustTargetOperationFactKey);
  return operation?.kind === "source-call" || operation?.kind === "provider-operation" &&
    operation.abi.target.form !== "expression-macro";
}
