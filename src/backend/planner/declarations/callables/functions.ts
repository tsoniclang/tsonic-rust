import type { Node } from "@tsonic/tsts";
import { planRustAbsentValue } from "../../expressions/optional-storage.js";
import { isRustNeverCarrier, isRustUnitCarrier } from "../../../../target-model/types/index.js";
import type { RustBlock, RustItem } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../../invariants.js";
import { planBlockLike } from "../../statements/index.js";
import {
  rustCurrentErrorBoundary,
} from "../../program/plan-context.js";
import type { RustPlanContext } from "../../program/plan-context.js";

import {
  planRustCallableGenerics,
  rustCallableSpecialization,
} from "./generics.js";
import type {
  RustSourceCallableSpecializationVariant,
} from "../../../../target-model/records/callable-emission.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../../names/synthetic.js";
import { planExpression } from "../../expressions/index.js";
import {
  planRustCallableParameterPrelude,
  planRustCallableParameters,
} from "./parameters.js";
import { resolveRustCallableBodyReturnType, resolveRustCallableOutwardReturnType, resolveRustJsPromiseReturnType } from "./return-types.js";
import { rustDeclarationRequiresUnsafe } from "../../safety/explicit-safety.js";
import { rustSafetyAttributesForDeclaration } from "../../safety/explicit-safety.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import { wrapRustJsPromiseBody } from "./async-promise.js";
import { planRustReturnExit } from "../../statements/completion-exits.js";
import { planRustGeneratorBody } from "./generator-body.js";
import { planRustCallableLeadingParameters } from "./leading-parameters.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { planRustLexicalFunctionEnvironment } from "./lexical-functions.js";
import { rustPackageFallibleBoundary } from "../../program/fallible-boundaries.js";
import { planRustErrorRegion } from "../../program/error-regions.js";
import { planRustPromiseBodyObjectAdapter, rustPromiseBodyGenericArguments } from "./promise-body-adapters.js";

interface RustFunctionItemPlan {
  readonly item: Extract<RustItem, { readonly kind: "function" }>;
  readonly helper: Extract<RustItem, { readonly kind: "function" }> | undefined;
}

function planRustFunctionParameters(
  node: Node,
  inputContext: RustPlanContext,
) {
  const { ast } = inputContext.input.program.source;
  const syntheticNames = createRustSyntheticNameState(ast, node, []);
  const environment = planRustLexicalFunctionEnvironment(node, { ...inputContext, syntheticNames });
  if (environment === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const parameterPlan = planRustCallableParameters(node, environment.context, syntheticNames);
  if (parameterPlan === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const leading = planRustCallableLeadingParameters(node, environment.context);
  if (leading === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const leadingParams = leading.parameters.map(parameter => {
    const type = rustTypeFromCarrierInContext(parameter.carrier, environment.context);
    return type === undefined ? undefined : { name: parameter.name, type };
  });
  if (leadingParams.some(parameter => parameter === undefined)) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  return {
    params: [...leadingParams as NonNullable<typeof leadingParams[number]>[],
      ...parameterPlan.params, ...environment.parameters],
    parameterPlan,
    syntheticNames,
    context: leading.context,
  };
}

export function planFunctionDeclarations(
  node: Node,
  outerContext: RustPlanContext,
): readonly RustItem[] | undefined {
  const emission = outerContext.input.program.records.callableDeclaration.get(node);
  if (emission === undefined) failRustPlannerInvariant("An admitted function requires its sealed declaration emission.", node);
  if (!emission.requiresSpecialization) {
    const item = planRustFunctionItem({
      callableDeclaration: node,
      nameDeclaration: node,
      name: emission.name,
      exported: emission.exported,
    }, outerContext);
    return Object.freeze(item.helper === undefined ? [item.item] : [item.item, item.helper]);
  }
  const variants = emission.specializations;
  if (variants.length === 0) {
    failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  }
  const items: RustItem[] = [];
  for (const variant of variants) {
    const item = planRustFunctionItem({
      callableDeclaration: node,
      nameDeclaration: node,
      name: variant.targetName,
      exported: false,
      specialization: variant,
    }, outerContext);
    if (item === undefined) {
      failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
    }
    items.push(item.item);
    if (item.helper !== undefined) items.push(item.helper);
  }
  return Object.freeze(items);
}

export function planNativeModuleFunction(
  declaration: Node,
  callableDeclaration: Node,
  name: string,
  exported: boolean,
  outerContext: RustPlanContext,
): Extract<RustItem, { readonly kind: "function" }> {
  return planRustFunctionItem({
    callableDeclaration,
    nameDeclaration: declaration,
    name,
    exported,
  }, outerContext).item;
}

function planRustFunctionItem(
  source: {
    readonly callableDeclaration: Node;
    readonly nameDeclaration: Node;
    readonly name?: string;
    readonly exported: boolean;
    readonly specialization?: RustSourceCallableSpecializationVariant;
  },
  outerContext: RustPlanContext,
): RustFunctionItemPlan {
  const node = source.callableDeclaration;
  const emission = outerContext.input.program.records.callableDeclaration.get(node);
  if (emission === undefined) failRustPlannerInvariant("An admitted callable requires its sealed declaration emission.", node);
  const { promiseBody: _enclosingPromiseBody, promiseBodyName: _enclosingPromiseBodyName, ...functionContext } = outerContext;
  const { ast } = outerContext.input.program.source;
  const isAsync = ast.hasModifierKind(node, "async");
  const generatorFact = outerContext.input.program.records.generator.get(node);
  const isUnsafe = rustDeclarationRequiresUnsafe(
    node,
    "declaration",
    outerContext.input,
  );
  const safetyAttributes = rustSafetyAttributesForDeclaration(
    node,
    isUnsafe,
    outerContext.input,
  );
  const asyncFact = outerContext.input.program.records.asyncFunction.get(node);
  const returnsJsPromise = asyncFact?.kind === "js-promise";
  const nativeBody = emission.nativeBody;
  const nativeBodyName = nativeBody === undefined ? undefined
    : source.specialization === undefined ? nativeBody.name : source.specialization.nativeBodyName;
  if (nativeBody !== undefined && nativeBodyName === undefined) failRustPlannerInvariant(
    "A specialized native Promise body requires its selected physical name.", node);
  if (isAsync && generatorFact === undefined && asyncFact === undefined) {
    failRustPlannerInvariant("An admitted callable requires its exact native declaration, return, error and body contracts.", node);
  }
  const isExported = source.exported;
  const name = source.name ?? emission.name;
  if (name === undefined) failRustPlannerInvariant("An admitted callable requires its exact native declaration name.", node);
  const lexical = outerContext.input.program.records.lexicalFunction.get(node);
  const visibility = lexical !== undefined ? "private" as const : isExported ? "public" as const : emission.visibility;
  const deadCode = emission.deadCode;
  const declarationAttributes = [...safetyAttributes];
  let context: RustPlanContext = nativeBody === undefined ? functionContext
    : { ...functionContext, promiseBody: true, promiseBodyName: nativeBodyName! };
  const specialization = source.specialization === undefined
    ? undefined
    : rustCallableSpecialization(
        source.specialization.sourceTypeParameterIdentities,
        source.specialization.targetTypeArguments,
      );
  if (source.specialization !== undefined && specialization === undefined) {
    failRustPlannerInvariant("An admitted callable requires its exact native declaration, return, error and body contracts.", node);
  }
  const genericPlan = planRustCallableGenerics(node, context, specialization, lexical?.genericParameters);
  if (genericPlan === undefined) {
    failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  }
  context = genericPlan.context;
  if (genericPlan.preservesExplicitLifetimes) {
    declarationAttributes.push(rustLintAttributes.needlessLifetimes);
  }
  const parameters = planRustFunctionParameters(node, context);
  if (parameters === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const { params, parameterPlan, syntheticNames } = parameters;
  context = parameters.context;
  const sourceReturn = context.input.program.records.sourceCallableReturn.get(node);
  const returnCarrier = generatorFact?.resultCarrier ?? asyncFact?.outputCarrier ??
    sourceReturn?.returnCarrier;
  const errorRegion = planRustErrorRegion(node, context);
  const fallible = errorRegion?.boundary !== undefined;
  const callableErrorBoundary = errorRegion?.boundary;
  const generatorErrorOwner = generatorFact === undefined ? undefined : rustCurrentErrorBoundary(context);
  const bodyErrorBoundary = callableErrorBoundary ?? (generatorErrorOwner === undefined
    ? undefined : rustPackageFallibleBoundary(generatorErrorOwner));
  if (errorRegion === undefined || generatorFact !== undefined && bodyErrorBoundary === undefined) {
    failRustPlannerInvariant("An admitted callable requires its exact native declaration, return, error and body contracts.", node);
  }
  const isUnit = isRustUnitCarrier(returnCarrier);
  const isNever = isRustNeverCarrier(returnCarrier);
  const returnType = isUnit || fallible && isNever
    ? undefined
    : resolveRustCallableOutwardReturnType(node, returnCarrier, context);
  if (!isUnit && !(fallible && isNever) && returnType === undefined) {
    failRustPlannerInvariant("An admitted callable requires its exact native declaration, return, error and body contracts.", node);
  }
  const emittedReturnType = returnsJsPromise && nativeBody === undefined
    ? resolveRustJsPromiseReturnType(node, context)
    : returnType;
  if (returnsJsPromise && nativeBody === undefined && emittedReturnType === undefined) {
    failRustPlannerInvariant("An admitted callable requires its exact native declaration, return, error and body contracts.", node);
  }
  const bodyNode = ast.body(node);
  if (bodyNode === undefined) {
    failRustPlannerInvariant("An admitted callable requires its exact native declaration, return, error and body contracts.", node);
  }
  if (fallible) {
    context.usedAliases?.add("rt");
  }
  const generatorControllerName = generatorFact === undefined
    ? undefined
    : allocateRustSyntheticName(syntheticNames, "generator");
  const bodyReturnType = resolveRustCallableBodyReturnType(
    returnType,
    generatorFact,
    context,
  );
  if (bodyReturnType === undefined) {
    failRustPlannerInvariant("An admitted callable requires its exact native declaration, return, error and body contracts.", node);
  }
  const bodyContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: bodyReturnType,
    functionAbsenceReturnCarrier: sourceReturn?.undefinedReturn === true ? returnCarrier : undefined,
    ...(isAsync ? { asyncContext: true } : {}),
    ...(generatorFact === undefined
      ? {}
      : {
          generator: {
            declaration: node,
            controllerName: generatorControllerName!,
            protocol: generatorFact,
          },
        }),
    fallibleBoundary: bodyErrorBoundary,
    returnResult: bodyErrorBoundary === undefined ? undefined : { errorType: bodyErrorBoundary.errorType },
  };
  const parameterStatements = planRustCallableParameterPrelude(
    parameterPlan,
    bodyContext,
    planExpression,
  );
  if (parameterStatements === undefined) {
    failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  }
  const plannedBody = ast.kindName(bodyNode) === "KindBlock"
    ? planBlockLike(bodyNode, bodyContext)
    : (() => {
        const expression = planRustReturnValueExpression(bodyNode, bodyContext, planExpression);
        return expression === undefined
          ? undefined
          : { statements: [planRustReturnExit(expression, bodyContext)] };
      })();
  if (plannedBody === undefined) {
    failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  }
  const body: RustBlock = {
    statements: [...plannedBody.statements, ...(sourceReturn?.fallthroughUndefined
      ? [planRustReturnExit(planRustAbsentValue(returnCarrier!, bodyContext), bodyContext)]
      : emission.canFallThrough ? [planRustReturnExit(undefined, bodyContext)] : [])],
  };
  if (generatorFact !== undefined) {
    context.usedAliases?.add("rt");
    if (returnType === undefined) {
      failRustPlannerInvariant("An admitted callable requires its exact native declaration, return, error and body contracts.", node);
      failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
    }
    const generics = genericPlan.finalizeGenerics();
    const item: Extract<RustItem, { readonly kind: "function" }> = {
      kind: "function",
      name,
      visibility,
      ...(deadCode === undefined ? {} : { deadCode }),
      ...(declarationAttributes.length === 0
        ? {}
        : { attrs: declarationAttributes }),
      ...(isUnsafe ? { isUnsafe: true } : {}),
      generics,
      params,
      returnType,
      body: {
        statements: [...parameterStatements, {
          kind: "tail",
          expr: planRustGeneratorBody(body, generatorFact, generatorControllerName!,
            bodyErrorBoundary!.errorType),
        }],
      },
    };
    return Object.freeze({ item, helper: undefined });
  }
  const generics = genericPlan.finalizeGenerics();
  const finalizedBody: RustBlock = { statements: [...parameterStatements, ...body.statements] };
  const item: Extract<RustItem, { readonly kind: "function" }> = {
    kind: "function",
    name: nativeBody === undefined ? name : nativeBodyName!,
    visibility: nativeBody === undefined ? visibility : nativeBody.visibility,
    ...(deadCode === undefined ? {} : { deadCode }),
    ...(declarationAttributes.length === 0
      ? {}
      : { attrs: declarationAttributes }),
    ...(isAsync && (!returnsJsPromise || nativeBody !== undefined && asyncFact.lowering.kind === "factory") ? { isAsync: true } : {}),
    ...(isUnsafe ? { isUnsafe: true } : {}),
    ...(callableErrorBoundary === undefined || returnsJsPromise && nativeBody === undefined
      ? {}
      : { errorType: callableErrorBoundary.errorType }),
    generics,
    params,
    ...(emittedReturnType === undefined ? {} : { returnType: emittedReturnType }),
    body: returnsJsPromise && nativeBody === undefined
      ? wrapRustJsPromiseBody(finalizedBody, fallible, asyncFact.lowering)
      : finalizedBody,
  };
  if (nativeBody === undefined || !emission.promiseObject)
    return Object.freeze({ item, helper: undefined });
  const adapterGenerics = planRustCallableGenerics(node, functionContext, specialization, lexical?.genericParameters);
  if (adapterGenerics === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const adapterParameters = planRustFunctionParameters(node, adapterGenerics.context);
  if (adapterParameters === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const adapterContext = adapterParameters.context;
  if (asyncFact?.kind !== "js-promise") failRustPlannerInvariant("An admitted Promise object adapter requires its selected async contract.", node);
  const adapterReturn = resolveRustJsPromiseReturnType(node, adapterContext);
  const adapterBody = planRustPromiseBodyObjectAdapter(node, { kind: "call", path: nativeBodyName!,
    genericArguments: rustPromiseBodyGenericArguments(generics),
    args: adapterParameters.params.map(parameter => ({ kind: "path", path: parameter.name })),
  }, callableErrorBoundary, adapterContext);
  if (adapterReturn === undefined || adapterBody === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const helper: Extract<RustItem, { readonly kind: "function" }> = { kind: "function", name, visibility,
    ...(deadCode === undefined ? {} : { deadCode }),
    ...(declarationAttributes.length === 0 ? {} : { attrs: declarationAttributes }),
    ...(isUnsafe ? { isUnsafe: true } : {}),
    generics: adapterGenerics.finalizeGenerics(), params: adapterParameters.params,
    returnType: adapterReturn, body: adapterBody };
  return Object.freeze({ item, helper });
}
import { planRustReturnValueExpression } from "../../expressions/value-destinations.js";
