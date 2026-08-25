import { printRustGenericArguments } from "../types.js";
import type { RustExpr, RustGenericArgument } from "../../../backend/target-ast/nodes.js";

type RustDirectCall = Extract<RustExpr, { readonly kind: "call" }>;
type RustAssociatedCall = Extract<RustExpr, { readonly kind: "associated-call" }>;
type RustMethodCall = Extract<RustExpr, { readonly kind: "method-call" }>;

export function printRustCallGenericArguments(
  genericArguments: readonly RustGenericArgument[] | undefined,
): string {
  return printRustGenericArguments(genericArguments, true);
}

export function printRustCallMember(
  member: string,
  genericArguments: readonly RustGenericArgument[] | undefined,
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
