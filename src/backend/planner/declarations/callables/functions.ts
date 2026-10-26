import type { Node } from "@tsonic/tsts";
import { applyRustTailShape } from "../../../target-ast/normalization/block-flow.js";
import { planRustAbsentValue } from "../../expressions/optional-storage.js";
import { isRustNeverCarrier, isRustUnitCarrier } from "../../../../target-model/types/index.js";
import type { RustBlock, RustItem } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { planBlockLike } from "../../statements/index.js";
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
import { resolveRustCallableBodyReturnType, resolveRustCallableOutwardReturnType, resolveRustGeneratorBodyErrorType, resolveRustJsPromiseReturnType } from "./return-types.js";
import { rustDeclarationRequiresUnsafe, rustSafetyAttributesForDeclaration } from "../../safety/explicit-safety.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import { wrapRustJsPromiseBody } from "./async-promise.js";
import { planRustReturnExit } from "../../statements/completion-exits.js";
import { planRustGeneratorBody } from "./generator-body.js";
import { planRustCallableLeadingParameters } from "./leading-parameters.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { planRustLexicalFunctionEnvironment } from "./lexical-functions.js";
import { planRustErrorRegion } from "../../program/error-regions.js";
import { planRustPromiseBodyObjectAdapter, rustPromiseBodyGenericArguments } from "./promise-body-adapters.js";
import { planRustNativeTaskOwner } from "../../program/native-tasks.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

interface RustNativeMethodReceiver {
  readonly name: string;
  readonly carrier: TargetTypeRef;
  readonly boundLifetimes: ReadonlySet<string>;
  readonly factoryReceiver: "value" | "shared";
}

export interface RustFunctionItemPlan {
  readonly item: Extract<RustItem, { readonly kind: "function" }>;
  readonly helper: Extract<RustItem, { readonly kind: "function" }> | undefined;
}

function planRustFunctionParameters(
  node: Node,
  inputContext: RustPlanContext,
  nativeReceiver: RustNativeMethodReceiver | undefined,
  facet: "body" | "object",
  use: Parameters<typeof planRustCallableParameters>[3],
) {
  const { ast } = inputContext.input.program.source;
  const syntheticNames = createRustSyntheticNameState(ast, node, nativeReceiver === undefined ? [] : [nativeReceiver.name]);
  const environment = planRustLexicalFunctionEnvironment(node, { ...inputContext, syntheticNames });
  if (environment === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const declaration = inputContext.input.program.records.callableDeclaration.get(node);
  if (declaration === undefined) failRustPlannerInvariant("An admitted callable requires its sealed checked value parameters.", node);
  const parameterPlan = planRustCallableParameters(declaration.contract, environment.context, syntheticNames, use);
  if (parameterPlan === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const receiverMode = nativeReceiver === undefined || facet === "body" ? "shared" : nativeReceiver.factoryReceiver;
  const leading = planRustCallableLeadingParameters(node, environment.context,
    nativeReceiver === undefined ? undefined : { ...nativeReceiver, mode: receiverMode });
  if (leading === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const leadingParams = leading.parameters.map(parameter => {
    const type = rustTypeFromCarrierInContext(parameter.carrier, environment.context);
    return type === undefined ? undefined : { name: parameter.name, type };
  });
  if (leadingParams.some(parameter => parameter === undefined)) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const receiverType = nativeReceiver === undefined ? undefined : rustTypeFromCarrierInContext(nativeReceiver.carrier, environment.context);
  if (nativeReceiver !== undefined && receiverType === undefined)
    failRustPlannerInvariant("An admitted native method requires its completed physical receiver type.", node);
  const tasks = planRustNativeTaskOwner(node, leading.context);
  return {
    params: [...(nativeReceiver === undefined || receiverType === undefined ? [] : [{ name: nativeReceiver.name,
      type: receiverMode === "value" ? receiverType : { kind: "reference" as const, mutable: false, referent: receiverType } }]), ...leadingParams as NonNullable<typeof leadingParams[number]>[],
      ...parameterPlan.params, ...environment.parameters, ...tasks.parameters],
    parameterPlan,
    syntheticNames,
    context: tasks.context,
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
  outerContext: RustPlanContext,
  nativeReceiver: RustNativeMethodReceiver | undefined,
): RustFunctionItemPlan {
  return planRustFunctionItem({
    callableDeclaration,
    nameDeclaration: declaration,
    name,
    ...(nativeReceiver === undefined ? {} : { nativeReceiver }),
  }, outerContext);
}

function planRustFunctionItem(
  source: {
    readonly callableDeclaration: Node;
    readonly nameDeclaration: Node;
    readonly name?: string;
    readonly specialization?: RustSourceCallableSpecializationVariant;
    readonly nativeReceiver?: RustNativeMethodReceiver;
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
  const name = source.name ?? emission.name;
  if (name === undefined) failRustPlannerInvariant("An admitted callable requires its exact native declaration name.", node);
  const lexical = outerContext.input.program.records.lexicalFunction.get(node);
  const visibility = emission.visibility;
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
  const ownerLifetimes = source.nativeReceiver === undefined ? new Set<string>() : source.nativeReceiver.boundLifetimes;
  const genericPlan = planRustCallableGenerics(node, context, ownerLifetimes, specialization, lexical?.genericParameters);
  if (genericPlan === undefined) {
    failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  }
  context = genericPlan.context;
  if (genericPlan.preservesExplicitLifetimes) {
    declarationAttributes.push(rustLintAttributes.needlessLifetimes);
  }
  const parameters = planRustFunctionParameters(node, context, source.nativeReceiver,
    returnsJsPromise && nativeBody === undefined ? "object" : "body", "source-body");
  if (parameters === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const { params, parameterPlan, syntheticNames } = parameters;
  context = parameters.context;
  const sourceReturn = context.input.program.records.sourceCallableReturn.get(node);
  const returnCarrier = generatorFact?.resultCarrier ?? asyncFact?.outputCarrier ??
    sourceReturn?.returnCarrier;
  const errorRegion = planRustErrorRegion(node, context);
  const fallible = errorRegion?.boundary !== undefined;
  const callableErrorBoundary = errorRegion?.boundary;
  if (errorRegion === undefined) {
    failRustPlannerInvariant("An admitted callable requires its exact native declaration, return, error and body contracts.", node);
  }
  const bodyErrorType = generatorFact === undefined ? callableErrorBoundary?.errorType
    : resolveRustGeneratorBodyErrorType(node, context);
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
  // A function body is its own completion and control-flow region: a local function item planned inside an enclosing
  // try/finally or loop must not inherit that region (closures reset it the same way).
  const parameterContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    controlTargets: undefined,
    completionBoundary: undefined,
    functionReturnType: bodyReturnType,
    functionAbsenceReturnCarrier: sourceReturn?.undefinedReturn === true ? returnCarrier : undefined,
    asyncContext: asyncFact?.kind === "native-future" ||
      asyncFact?.kind === "js-promise" && asyncFact.lowering.kind === "factory" || generatorFact?.kind === "async",
    generator: generatorFact === undefined ? undefined : {
      declaration: node,
      controllerName: generatorControllerName!,
      protocol: generatorFact,
    },
    fallibleBoundary: callableErrorBoundary,
    returnResult: bodyErrorType === undefined ? undefined : { errorType: bodyErrorType },
  };
  const parameterPrelude = planRustCallableParameterPrelude(
    parameterPlan,
    parameterContext,
    planExpression,
  );
  if (parameterPrelude === undefined) {
    failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  }
  const bodyContext = parameterPrelude.context;
  const parameterStatements = parameterPrelude.statements;
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
          expr: planRustGeneratorBody(body, generatorFact, generatorControllerName!),
        }],
      },
    };
    return Object.freeze({ item, helper: undefined });
  }
  const generics = genericPlan.finalizeGenerics();
  const finalizedBody: RustBlock = applyRustTailShape({ statements: [...parameterStatements, ...body.statements] }, returnType !== undefined,
    new Set(params.map(parameter => parameter.name)));
  const item: Extract<RustItem, { readonly kind: "function" }> = {
    kind: "function",
    name: nativeBody === undefined ? name : nativeBodyName!,
    visibility: nativeBody === undefined ? visibility : nativeBody.visibility,
    ...(deadCode === undefined ? {} : { deadCode }),
    ...(declarationAttributes.length === 0
      ? {}
      : { attrs: declarationAttributes }),
    ...(emission.nativeAsync ? { isAsync: true } : {}),
    ...(isUnsafe ? { isUnsafe: true } : {}),
    ...(callableErrorBoundary === undefined || returnsJsPromise && nativeBody === undefined
      ? {}
      : { errorType: callableErrorBoundary.errorType }),
    generics,
    params,
    ...(emittedReturnType === undefined ? {} : { returnType: emittedReturnType }),
    body: returnsJsPromise && nativeBody === undefined
      ? wrapRustJsPromiseBody(finalizedBody, fallible, asyncFact.lowering,
          context.input.program.records.callableReturn.get(node)?.outward ??
            failRustPlannerInvariant("An admitted Promise body requires its sealed physical native completion.", node))
      : finalizedBody,
  };
  if (nativeBody === undefined || !emission.promiseObject)
    return Object.freeze({ item, helper: undefined });
  const adapterGenerics = planRustCallableGenerics(node, functionContext, ownerLifetimes, specialization, lexical?.genericParameters);
  if (adapterGenerics === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const adapterParameters = planRustFunctionParameters(node, adapterGenerics.context, source.nativeReceiver, "object", "signature");
  if (adapterParameters === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const adapterContext = adapterParameters.context;
  if (asyncFact?.kind !== "js-promise") failRustPlannerInvariant("An admitted Promise object adapter requires its selected async contract.", node);
  const adapterReturn = resolveRustJsPromiseReturnType(node, adapterContext);
  const adapterBody = planRustPromiseBodyObjectAdapter(node, { kind: "call", path: source.nativeReceiver === undefined ? nativeBodyName! : `Self::${nativeBodyName!}`,
    genericArguments: rustPromiseBodyGenericArguments(generics),
    args: adapterParameters.params.map(parameter => parameter.name === source.nativeReceiver?.name &&
      source.nativeReceiver.factoryReceiver === "value" ? { kind: "reference", expr: { kind: "path", path: parameter.name } }
      : { kind: "path", path: parameter.name }),
  }, callableErrorBoundary, adapterContext);
  if (adapterReturn === undefined || adapterBody === undefined) failRustPlannerInvariant("An admitted callable requires its complete native function plan.", node);
  const helper: Extract<RustItem, { readonly kind: "function" }> = { kind: "function", name, visibility,
    ...(emission.promiseObjectDeadCode === undefined ? {} : { deadCode: emission.promiseObjectDeadCode }),
    ...(declarationAttributes.length === 0 ? {} : { attrs: declarationAttributes }),
    ...(isUnsafe ? { isUnsafe: true } : {}),
    generics: adapterGenerics.finalizeGenerics(), params: adapterParameters.params,
    returnType: adapterReturn, body: adapterBody };
  return Object.freeze({ item, helper });
}
import { planRustReturnValueExpression } from "../../expressions/value-destinations.js";
