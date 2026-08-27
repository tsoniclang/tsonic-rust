import { printRustGenericArgument } from "../types.js";
import type { RustCallGenericArgument, RustExpr } from "../../../backend/target-ast/nodes.js";

type RustDirectCall = Extract<RustExpr, { readonly kind: "call" }>;
type RustAssociatedCall = Extract<RustExpr, { readonly kind: "associated-call" }>;
type RustMethodCall = Extract<RustExpr, { readonly kind: "method-call" }>;

export function printRustCallGenericArguments(
  genericArguments: readonly RustCallGenericArgument[] | undefined,
): string {
  return genericArguments === undefined || genericArguments.length === 0
    ? ""
    : `::<${genericArguments.map(printRustGenericArgument).join(", ")}>`;
}

export function printRustCallMember(
  member: string,
  genericArguments: readonly RustCallGenericArgument[] | undefined,
): string {
  return `${member}${printRustCallGenericArguments(genericArguments)}`;
}

export function printRustDirectCallTarget(expression: RustDirectCall): string {
  return printRustCallMember(expression.path, expression.genericArguments);
}

export function printRustAssociatedCallTarget(
  expression: RustAssociatedCall,
  owner: string,
): string {
  return `${owner}::${printRustCallMember(expression.method, expression.genericArguments)}`;
}

export function printRustMethodCallTarget(
  expression: RustMethodCall,
  receiver: string,
): string {
  return `${receiver}.${printRustCallMember(expression.method, expression.genericArguments)}`;
}
