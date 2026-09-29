import type { Node } from "@tsonic/tsts";
import { rustCallableAbsenceCompletionMatches, type RustCallableAbsenceCompletion } from "../../../target-model/conversions/callable-completion.js";
import { rustCallableProtocol } from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustCallableConstructionType } from "./fundamentals.js";
import { planRustAbsentValue } from "./optional-storage.js";

export function planRustCallableAbsenceCompletion(
  conversion: RustCallableAbsenceCompletion,
  expression: RustExpr,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!rustCallableAbsenceCompletionMatches(conversion.source, conversion.target)) return undefined;
  const source = rustCallableProtocol(conversion.source)!;
  const target = rustCallableProtocol(conversion.target)!;
  const type = rustCallableConstructionType(conversion.target, context);
  if (type === undefined) return undefined;
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const callable = allocateRustSyntheticName(names, "callable");
  const argumentsName = allocateRustSyntheticName(names, source.parameters.length === 0 ? "_arguments" : "arguments");
  const invocation: RustExpr = {
    kind: "method-call", receiver: { kind: "path", path: callable }, method: "call",
    args: [{ kind: "tuple-literal", elements: source.parameters.map((_parameter, index) => ({
      kind: "field", receiver: { kind: "path", path: argumentsName }, name: String(index),
    })) }],
  };
  return { kind: "block", bindings: [{ name: callable, value: expression }], value: {
    kind: "associated-call", owner: type, method: "new", args: [{
      kind: "closure", move: true, params: [{ name: argumentsName, byRefCopy: false }], body: {
        kind: "method-call", receiver: invocation, method: "map", args: [{
          kind: "closure", params: [{ name: "_", byRefCopy: false }],
          body: planRustAbsentValue(target.result, context),
        }],
      },
    }],
  } };
}
