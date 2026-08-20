import { printRustType } from "../types.js";
import type { RustExpr, RustType } from "../../../backend/rust-ast/nodes.js";

type RustDirectCall = Extract<RustExpr, { readonly kind: "call" }>;
type RustAssociatedCall = Extract<RustExpr, { readonly kind: "associated-call" }>;
type RustMethodCall = Extract<RustExpr, { readonly kind: "method-call" }>;

export function printRustCallTypeArguments(
  typeArguments: readonly RustType[] | undefined,
): string {
  return typeArguments === undefined || typeArguments.length === 0
    ? ""
    : `::<${typeArguments.map(printRustType).join(", ")}>`;
}

export function printRustCallMember(
  member: string,
  typeArguments: readonly RustType[] | undefined,
): string {
  return `${member}${printRustCallTypeArguments(typeArguments)}`;
}

export function printRustDirectCallTarget(expression: RustDirectCall): string {
  return printRustCallMember(expression.path, expression.typeArguments);
}

export function printRustAssociatedCallTarget(
  expression: RustAssociatedCall,
  owner: string,
): string {
  return `${owner}::${printRustCallMember(expression.method, expression.typeArguments)}`;
}

export function printRustMethodCallTarget(
  expression: RustMethodCall,
  receiver: string,
): string {
  return `${receiver}.${printRustCallMember(expression.method, expression.typeArguments)}`;
}
