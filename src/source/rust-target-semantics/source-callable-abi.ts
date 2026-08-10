import type { Node, Symbol } from "@tsonic/tsts";
import { isRustStringCarrier } from "../rust-target-types.js";
import type { RustArgumentMode } from "../rust-facts/keys.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  resolveRustTargetTypeRef,
} from "./target-type-resolution.js";
import type {
  RustTargetTypeResolutionContext,
  RustTargetTypeResolutionOptions,
} from "./target-type-resolution.js";

export interface RustSourceCallableAbiResolver {
  resolveParameterAbi(
    parameter: Node,
    context: RustTargetTypeResolutionContext,
    options: RustTargetTypeResolutionOptions,
  ): RustSourceParameterAbi | undefined;
}

export interface RustSourceParameterAbi {
  readonly valueCarrier: TargetTypeRef;
  readonly parameterCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
}

export function createRustSourceCallableAbiResolver(): RustSourceCallableAbiResolver {
  const cache = new WeakMap<object, RustSourceParameterAbi | null>();

  return {
    resolveParameterAbi(parameter, context, options) {
      const cached = cache.get(parameter);
      if (cached !== undefined) {
        return cached ?? undefined;
      }
      const base = resolveRustTargetTypeRef(parameter, context, options);
      if (base === undefined) {
        cache.set(parameter, null);
        return undefined;
      }
      const abi = !isRustStringCarrier(base)
        ? {
            valueCarrier: base,
            parameterCarrier: base,
            mode: base.kind === "pointer"
              ? base.mutability === "mut" ? "mut-ref" as const : "ref" as const
              : "value" as const,
          }
        : parameterOnlyReadsThroughReceiver(parameter, context)
          ? {
              valueCarrier: base,
              parameterCarrier: {
                kind: "pointer" as const,
                pointee: base,
                mutability: "const" as const,
              },
              mode: "ref" as const,
            }
          : { valueCarrier: base, parameterCarrier: base, mode: "value" as const };
      cache.set(parameter, abi);
      return abi;
    },
  };
}

function parameterOnlyReadsThroughReceiver(
  parameter: Node,
  context: RustTargetTypeResolutionContext,
): boolean {
  const { ast } = context;
  const name = ast.name(parameter);
  const declarationReference = context.source.navigation.sourceReferenceFor(name);
  if (name === undefined || declarationReference?.declaration !== parameter) {
    return false;
  }
  const callable = enclosingCallable(ast.parent(parameter), context);
  const body = ast.body(callable);
  if (body === undefined) {
    return false;
  }
  let found = false;
  let valid = true;
  const visit = (node: Node | undefined): void => {
    if (node === undefined || !valid) {
      return;
    }
    if (node !== name && referenceMatches(node, declarationReference.symbol, context)) {
      found = true;
      valid = referenceOnlyReadsThroughReceiver(node, context);
      if (!valid) {
        return;
      }
    }
    ast.forEachChild(node, visit);
  };
  visit(body);
  return found && valid;
}

function enclosingCallable(
  node: Node | undefined,
  context: RustTargetTypeResolutionContext,
): Node | undefined {
  const { ast } = context;
  let current = node;
  while (current !== undefined) {
    if (
      ast.is.IsFunctionDeclaration(current) ||
      ast.is.IsMethodDeclaration(current) ||
      ast.is.IsConstructorDeclaration(current) ||
      ast.is.IsGetAccessorDeclaration(current) ||
      ast.is.IsSetAccessorDeclaration(current) ||
      ast.is.IsFunctionExpression(current) ||
      ast.is.IsArrowFunction(current)
    ) {
      return current;
    }
    current = ast.parent(current);
  }
  return undefined;
}

function referenceMatches(
  node: Node,
  symbol: Symbol,
  context: RustTargetTypeResolutionContext,
): boolean {
  return context.source.navigation.sourceReferenceFor(node)?.symbol === symbol;
}

function referenceOnlyReadsThroughReceiver(
  reference: Node,
  context: RustTargetTypeResolutionContext,
): boolean {
  const { ast } = context;
  let current = reference;
  for (;;) {
    const parent = ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (ast.is.IsParenthesizedExpression(parent)) {
      const expression = ast.as.AsParenthesizedExpression(parent)?.Expression;
      if (expression !== current) {
        return false;
      }
      current = parent;
      continue;
    }
    if (ast.is.IsPropertyAccessExpression(parent)) {
      return ast.as.AsPropertyAccessExpression(parent)?.Expression === current;
    }
    if (ast.is.IsElementAccessExpression(parent)) {
      return ast.as.AsElementAccessExpression(parent)?.Expression === current;
    }
    return false;
  }
}
