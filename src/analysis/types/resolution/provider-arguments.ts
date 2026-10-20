import { Node_Operand } from "@tsonic/target-api/source";

import { resolveRustAuthoredTargetType } from "./tuples.js";

import type { Node } from "@tsonic/tsts";

import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { RustTargetConstArgument, RustTargetGenericArgument } from "../../../target-model/types/model.js";

import { parseSourceIntegerLiteral } from "../../../target-model/syntax/literals.js";

export function resolveRustProviderGenericArguments(
  nodes: readonly Node[],
  parameters: readonly import("../../../target-model/operations/model.js").RustProviderGenericParameter[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): readonly RustTargetGenericArgument[] | undefined {
  if (nodes.length > parameters.length) return undefined;
  const values: RustTargetGenericArgument[] = [];
  for (const [index, node] of nodes.entries()) {
    const parameter = parameters[index];
    if (parameter === undefined) return undefined;
    const value = resolveRustProviderGenericArgument(
      node,
      parameter,
      context,
      options,
      resolving,
    );
    if (value === undefined) return undefined;
    values.push(value);
  }
  return Object.freeze(values);
}

export function resolveRustProviderGenericArgument(
  node: Node,
  parameter: import("../../../target-model/operations/model.js").RustProviderGenericParameter,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object> = new Set<object>(),
): RustTargetGenericArgument | undefined {
  if (parameter.kind === "type") {
    const type = resolveRustAuthoredTargetType(node, context, options, resolving);
    return type === undefined
      ? undefined
      : Object.freeze({ kind: "type", type });
  }
  if (parameter.kind === "lifetime") {
    const lifetime = context.sourceLifetimes.resolve(node);
    return lifetime === undefined
      ? undefined
      : Object.freeze({ kind: "lifetime", lifetime });
  }
  const value = resolveRustConstGenericArgument(node, context);
  return value === undefined
    ? undefined
    : Object.freeze({ kind: "const", value });
}

export function resolveRustConstGenericArgument(
  node: Node,
  context: RustTargetTypeResolutionContext,
): RustTargetConstArgument | undefined {
  const literal = context.ast.kindName(node) === "KindLiteralType"
    ? context.ast.as.AsLiteralTypeNode(node)?.Literal
    : node;
  if (literal === undefined) return undefined;
  const kind = context.ast.kindName(literal);
  if (kind === "KindTrueKeyword" || kind === "KindFalseKeyword") {
    return Object.freeze({ kind: "boolean", value: kind === "KindTrueKeyword" });
  }
  if (kind === "KindStringLiteral") {
    const value = context.ast.text(literal);
    return [...value].length === 1
      ? Object.freeze({ kind: "char", value })
      : undefined;
  }
  const integer = constIntegerText(literal, context);
  return integer === undefined
    ? undefined
    : Object.freeze({ kind: "integer", value: integer });
}

function constIntegerText(
  node: Node,
  context: RustTargetTypeResolutionContext,
): string | undefined {
  if (context.ast.kindName(node) === "KindNumericLiteral" ||
    context.ast.kindName(node) === "KindBigIntLiteral") {
    return parseSourceIntegerLiteral(context.ast.text(node).replace(/n$/, ""))?.toString(10);
  }
  if (context.ast.kindName(node) !== "KindPrefixUnaryExpression") {
    return undefined;
  }
  const operand = Node_Operand(context.ast, node);
  if (operand === undefined || (context.ast.kindName(operand) !== "KindNumericLiteral" &&
    context.ast.kindName(operand) !== "KindBigIntLiteral")) {
    return undefined;
  }
  const value = parseSourceIntegerLiteral(context.ast.text(operand).replace(/n$/, ""));
  if (value === undefined) return undefined;
  const operator = context.ast.operatorKindName(node);
  return operator === "KindMinusToken"
    ? (-value).toString(10)
    : operator === "KindPlusToken"
      ? value.toString(10)
      : undefined;
}
