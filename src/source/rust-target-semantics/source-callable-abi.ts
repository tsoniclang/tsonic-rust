import type { Node, Symbol } from "@tsonic/tsts";
import {
  isRustStringCarrier,
  rustOptionElementCarrier,
  rustOptionTargetType,
} from "../rust-target-types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { RustArgumentMode } from "../rust-facts/keys.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  resolveRustTargetTypeRef,
  rustParameterLaneTargetType,
} from "./target-type-resolution.js";
import type {
  RustTargetTypeResolutionContext,
  RustTargetTypeResolutionOptions,
} from "./target-type-resolution.js";
import { Node_Initializer, Node_Type } from "../../common/source-ast.js";

export interface RustSourceCallableAbiResolver {
  resolveParameterAbi(
    parameter: Node,
    context: RustTargetTypeResolutionContext,
    options: RustTargetTypeResolutionOptions,
  ): RustSourceParameterAbi | undefined;
}

export interface RustSourceParameterAbi {
  readonly form: "required" | "optional" | "default" | "rest";
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
      const typeNode = Node_Type(context.ast, parameter);
      const base = typeNode === undefined
        ? undefined
        : resolveRustTargetTypeRef(typeNode, context, options);
      if (base === undefined) {
        cache.set(parameter, null);
        return undefined;
      }
      const declaration = context.ast.as.AsParameterDeclaration(parameter);
      if (declaration === undefined) {
        cache.set(parameter, null);
        return undefined;
      }
      const form = declaration.DotDotDotToken !== undefined
        ? "rest" as const
        : Node_Initializer(context.ast, parameter) !== undefined
          ? "default" as const
          : context.ast.questionToken(parameter) !== undefined
            ? "optional" as const
            : "required" as const;
      const requiredParameterCarrier = form === "required" && typeNode !== undefined
        ? rustParameterLaneTargetType(base, typeNode, context, options)
        : undefined;
      const abi = form === "optional"
        ? {
            form,
            valueCarrier: rustOptionTargetType(base),
            parameterCarrier: rustOptionTargetType(base),
            mode: "value" as const,
          }
        : form === "default"
          ? {
              form,
              valueCarrier: base,
              parameterCarrier: rustOptionTargetType(base),
              mode: "value" as const,
            }
          : form === "rest"
            ? {
                form,
                valueCarrier: base,
                parameterCarrier: base,
                mode: "value" as const,
              }
            : requiredParameterCarrier?.kind === "pointer"
              ? {
                  form,
                  valueCarrier: base,
                  parameterCarrier: requiredParameterCarrier,
                  mode: requiredParameterCarrier.mutability === "mut"
                    ? "mut-ref" as const
                    : "ref" as const,
                }
            : !isRustStringCarrier(base)
        ? {
            form,
            valueCarrier: base,
            parameterCarrier: base,
            mode: base.kind === "pointer"
              ? base.mutability === "mut" ? "mut-ref" as const : "ref" as const
              : "value" as const,
          }
        : parameterOnlyReadsThroughReceiver(parameter, context)
          ? {
              form,
              valueCarrier: base,
              parameterCarrier: {
                kind: "pointer" as const,
                pointee: base,
                mutability: "const" as const,
              },
              mode: "ref" as const,
            }
          : { form, valueCarrier: base, parameterCarrier: base, mode: "value" as const };
      cache.set(parameter, abi);
      return abi;
    },
  };
}

export function resolveRustContextualParameterAbi(
  parameter: Node,
  selectedParameterCarrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): RustSourceParameterAbi | undefined {
  const declaration = context.ast.as.AsParameterDeclaration(parameter);
  if (declaration === undefined) {
    return undefined;
  }
  const form = declaration.DotDotDotToken !== undefined
    ? "rest" as const
    : Node_Initializer(context.ast, parameter) !== undefined
      ? "default" as const
      : context.ast.questionToken(parameter) !== undefined
        ? "optional" as const
        : "required" as const;
  const selectedValueCarrier = form === "optional"
    ? selectedParameterCarrier
    : form === "default"
      ? rustOptionElementCarrier(selectedParameterCarrier)
      : selectedParameterCarrier.kind === "pointer"
        ? selectedParameterCarrier.pointee
        : selectedParameterCarrier;
  if (selectedValueCarrier === undefined) {
    return undefined;
  }
  const authoredType = Node_Type(context.ast, parameter);
  const authoredCarrier = authoredType === undefined
    ? undefined
    : resolveRustTargetTypeRef(authoredType, context, options);
  const authoredExpectation = form === "optional"
    ? rustOptionElementCarrier(selectedParameterCarrier)
    : selectedValueCarrier;
  if (authoredType !== undefined &&
    (authoredCarrier === undefined || authoredExpectation === undefined ||
      !rustTargetTypeRefEquals(authoredCarrier, authoredExpectation))) {
    return undefined;
  }
  return {
    form,
    valueCarrier: selectedValueCarrier,
    parameterCarrier: selectedParameterCarrier,
    mode: selectedParameterCarrier.kind === "pointer"
      ? selectedParameterCarrier.mutability === "mut" ? "mut-ref" : "ref"
      : "value",
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
