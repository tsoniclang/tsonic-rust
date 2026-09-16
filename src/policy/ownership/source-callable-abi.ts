import { flowStateFactKey } from "@tsonic/tsts";
import type { Node } from "@tsonic/tsts";
import {
  inferRustTargetGenericBindings,
  rustTargetGenericReferences,
  substituteRustTargetGenerics,
  isRustVecCarrier,
  isRustStringCarrier,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustSliceElementCarrier,
  isRustJsValueCarrier,
  rustProgramErrorTargetType,
  rustTsValueTargetType,
  rustEmptyObjectTargetType,
  rustObjectIdentityTargetType,
} from "../../target-model/types/index.js";
import {
  rustTargetTypeRefEquals,
  rustTargetTypeRefEqualsWithinLifetimeBinders,
} from "../../target-model/types/equality.js";
import type { RustArgumentMode } from "../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetGenericBindings } from "../../target-model/types/index.js";
import type { RustLifetimeBinder } from "../../target-model/lifetimes/index.js";
import {
  resolveRustTargetTypeRef,
  rustParameterLaneTargetType,
} from "../types/resolution.js";
import type {
  RustTargetTypeResolutionContext,
  RustTargetTypeResolutionOptions,
} from "../types/resolution.js";
import {
  Node_Initializer,
  Node_Expression,
  Node_Type,
} from "@tsonic/target-api/source";

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

export function rustSourceParameterContractCarrier(
  abi: RustSourceParameterAbi,
): TargetTypeRef {
  return abi.parameterCarrier.kind === "reference"
    ? abi.parameterCarrier.referent
    : abi.parameterCarrier;
}

export function instantiateRustSourceParameterValueCarrier(
  abi: RustSourceParameterAbi,
  selectedParameterCarrier: TargetTypeRef,
  selectedBindings: RustTargetGenericBindings,
  normalize: (carrier: TargetTypeRef) => TargetTypeRef,
): TargetTypeRef | undefined {
  const references = rustTargetGenericReferences(abi.parameterCarrier);
  const substituteSelected = (carrier: TargetTypeRef): TargetTypeRef =>
    substituteRustTargetGenerics(
      carrier,
      selectedBindings.types,
      selectedBindings.lifetimes,
      selectedBindings.consts,
      normalize,
    );
  const bindings = inferRustTargetGenericBindings(
    substituteSelected(abi.parameterCarrier),
    selectedParameterCarrier,
    {
      typeNames: new Set(references.typeNames.filter((name) => !selectedBindings.types.has(name))),
      lifetimeIdentities: new Set(references.lifetimeIdentities.filter((identity) => !selectedBindings.lifetimes.has(identity))),
      constIdentities: new Set(references.constIdentities.filter((identity) => !selectedBindings.consts.has(identity))),
    },
  );
  return bindings === undefined
    ? undefined
    : substituteRustTargetGenerics(
        substituteSelected(abi.valueCarrier),
        bindings.types,
        bindings.lifetimes,
        bindings.consts,
        normalize,
      );
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
      let base = typeNode === undefined
        ? resolveRustTargetTypeRef(parameter, context, options)
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
      if (form === "required" &&
        (isRustJsValueCarrier(base) || rustTargetTypeRefEquals(base, rustTsValueTargetType()) ||
          rustTargetTypeRefEquals(base, rustEmptyObjectTargetType()) ||
          rustTargetTypeRefEquals(base, rustObjectIdentityTargetType())) &&
        parameterOnlyForwardsThrownValue(parameter, context)) {
        base = rustProgramErrorTargetType();
      }
      const requiresOwnedValue = parameterUsesFlowState(
        parameter,
        "moved",
        context,
      );
      const parameterLaneCarrier = form === "required" && typeNode !== undefined
        ? requiresOwnedValue
          ? base
          : rustParameterLaneTargetType(base, typeNode, context, options)
        : undefined;
      const requiredParameterCarrier = parameterLaneCarrier !== undefined &&
          rustTargetTypeRefEquals(parameterLaneCarrier, base) &&
          isRustStringCarrier(base) &&
          !requiresOwnedValue &&
          parameterCanUseSharedBorrow(parameter, context)
        ? {
            kind: "reference" as const,
            referent: base,
            mutable: false,
          }
        : parameterLaneCarrier;
      const requiredMode = requiredParameterCarrier === undefined
        ? undefined
        : rustParameterModeForCarriers(base, requiredParameterCarrier);
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
          : requiredParameterCarrier !== undefined && requiredMode !== undefined
              ? {
                  form,
                  valueCarrier: base,
                  parameterCarrier: requiredParameterCarrier,
                  mode: requiredMode,
                }
              : undefined;
      if (abi === undefined) {
        cache.set(parameter, null);
        return undefined;
      }
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
  lifetimeBinders?: {
    readonly authored: RustLifetimeBinder;
    readonly selected: RustLifetimeBinder;
  },
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
  const authoredType = Node_Type(context.ast, parameter);
  const authoredCarrier = authoredType === undefined
    ? resolveRustTargetTypeRef(parameter, context, options)
    : resolveRustTargetTypeRef(authoredType, context, options);
  const authoredSemanticType = authoredType === undefined
    ? undefined
    : context.currentSemantics.types.authoredType(authoredType);
  const authoredTypeAcceptsContextualCarrier = authoredSemanticType !== undefined &&
    (context.currentSemantics.types.isAny(authoredSemanticType) ||
      context.currentSemantics.types.isUnknown(authoredSemanticType));
  const selectedValueCarrier = form === "optional"
    ? selectedParameterCarrier
    : form === "default"
      ? rustOptionElementCarrier(selectedParameterCarrier)
      : selectedParameterCarrier.kind === "reference"
        ? authoredCarrier
        : selectedParameterCarrier;
  if (selectedValueCarrier === undefined) {
    return undefined;
  }
  const authoredExpectation = form === "optional"
    ? rustOptionElementCarrier(selectedParameterCarrier)
    : selectedValueCarrier;
  const carriersEqual = lifetimeBinders === undefined
    ? rustTargetTypeRefEquals
    : (left: TargetTypeRef | undefined, right: TargetTypeRef | undefined): boolean =>
        rustTargetTypeRefEqualsWithinLifetimeBinders(
          left,
          right,
          lifetimeBinders.authored,
          lifetimeBinders.selected,
        );
  if (authoredType !== undefined && !authoredTypeAcceptsContextualCarrier &&
    (authoredCarrier === undefined || authoredExpectation === undefined ||
      !carriersEqual(authoredCarrier, authoredExpectation))) {
    return undefined;
  }
  const mode = form === "required"
    ? rustParameterModeForCarriers(
        selectedValueCarrier,
        selectedParameterCarrier,
        carriersEqual,
      )
    : "value" as const;
  if (mode === undefined) {
    return undefined;
  }
  return {
    form,
    valueCarrier: selectedValueCarrier,
    parameterCarrier: selectedParameterCarrier,
    mode,
  };
}

function rustParameterModeForCarriers(
  valueCarrier: TargetTypeRef,
  parameterCarrier: TargetTypeRef,
  carriersEqual: (
    left: TargetTypeRef | undefined,
    right: TargetTypeRef | undefined,
  ) => boolean = rustTargetTypeRefEquals,
): RustArgumentMode | undefined {
  if (carriersEqual(valueCarrier, parameterCarrier)) {
    return "value";
  }
  if (parameterCarrier.kind !== "reference" ||
    !carriersEqual(parameterCarrier.referent, valueCarrier) &&
    !(isRustVecCarrier(valueCarrier) &&
      carriersEqual(rustSliceElementCarrier(parameterCarrier), valueCarrier.element))) {
    return undefined;
  }
  return parameterCarrier.mutable ? "mut-ref" : "ref";
}

function parameterUsesFlowState(
  parameter: Node,
  state: "borrowed-shared" | "borrowed-mut" | "moved",
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
  return context.source.navigation.declarationUses(parameter)
    .filter((use) => !use.captured)
    .some(({ reference }) => {
      const flow = context.facts.resolve(reference, flowStateFactKey) ??
        context.facts.get(reference, flowStateFactKey);
      return flow?.state === state;
    });
}

function parameterCanUseSharedBorrow(
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
  const summary = context.source.navigation.parameterUseSummary(parameter);
  if (summary === undefined || summary.uses.length === 0 ||
    summary.bindingWritten || summary.memberWritten || summary.captured ||
    summary.returned || summary.yielded || summary.aliasedOrStored ||
    summary.exported) {
    return false;
  }
  return summary.uses.every(({ reference, role }) => {
    const flow = context.facts.resolve(reference, flowStateFactKey) ??
      context.facts.get(reference, flowStateFactKey);
    return flow?.state === "borrowed-shared" ||
      role === "receiver";
  });
}

function parameterOnlyForwardsThrownValue(
  parameter: Node,
  context: RustTargetTypeResolutionContext,
): boolean {
  const summary = context.source.navigation.parameterUseSummary(parameter);
  if (summary === undefined || summary.uses.length === 0 || summary.bindingWritten ||
    summary.memberWritten || summary.captured || summary.returned || summary.yielded ||
    summary.aliasedOrStored || summary.exported) return false;
  return summary.uses.every(({ reference }) => {
    let operand = reference;
    let parent = context.ast.parent(operand);
    while (parent !== undefined && context.ast.kindName(parent) === "KindParenthesizedExpression" &&
      Node_Expression(context.ast, parent) === operand) {
      operand = parent;
      parent = context.ast.parent(parent);
    }
    return parent !== undefined && context.ast.kindName(parent) === "KindThrowStatement" &&
      Node_Expression(context.ast, parent) === operand;
  });
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
