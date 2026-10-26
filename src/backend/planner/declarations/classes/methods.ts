import { rustPackageFallibleBoundary } from "../../program/fallible-boundaries.js";
import { applyRustTailShape } from "../../../target-ast/normalization/block-flow.js";

import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import { isRustNeverCarrier, isRustUnitCarrier } from "../../../../target-model/types/index.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { planBlockLike } from "../../statements/index.js";
import { planExpression } from "../../expressions/index.js";
import { planRustCallableGenerics, rustCallableSpecialization } from "../callables/generics.js";
import { planRustCallableParameterPrelude, planRustCallableParameters } from "../callables/parameters.js";
import { rustSelfParameter } from "../callables/self-parameter.js";
import { readRustProjectMethodOverride } from "../../objects/project-objects.js";
import { resolveRustCallableBodyReturnType, resolveRustCallableOutwardReturnType, resolveRustGeneratorBodyError, resolveRustJsPromiseReturnType } from "../callables/return-types.js";
import { rustDeclarationRequiresUnsafe, rustSafetyAttributesForDeclaration } from "../../safety/explicit-safety.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import { planRustErrorRegion } from "../../program/error-regions.js";
import type { Node } from "@tsonic/tsts";
import { planRustAbsentValue } from "../../expressions/optional-storage.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { RustExpr, RustImplFunction, RustStmt } from "../../../target-ast/syntax/nodes.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { wrapRustJsPromiseBody } from "../callables/async-promise.js";
import { planRustReturnExit } from "../../statements/completion-exits.js";
import { rustClassMemberEnvironmentContext } from "../../objects/class-environments.js";
import { rustProjectGenerics } from "../../objects/polymorphism/names.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import { planRustGeneratorBody } from "../callables/generator-body.js";
import { rustClassEnvironmentType } from "../../objects/class-environment-types.js";
import type { RustMethodEmissionVariant } from "../../../../target-model/records/method-emission.js";
import { planRustSuspendedReceiver } from "../callables/suspended-receiver.js";
import { planRustPromiseBodyObjectAdapter, rustPromiseBodyGenericArguments } from "../callables/promise-body-adapters.js";
import type { RustSourceCallableSpecializationVariant } from "../../../../target-model/records/callable-emission.js";
import { planRustNativeTaskOwner } from "../../program/native-tasks.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";

export function planProjectMethod(
  member: Node,
  outerContext: RustPlanContext,
  options?: {
    readonly targetName?: string;
    readonly safetyPlacement?: "getter" | "setter";
    readonly typeArgumentSubstitutions?: ReadonlyMap<string, TargetTypeRef>;
    readonly fallibleBoundary?: import("../../../../target-model/records/source-package-errors.js").RustSourcePackageErrorBoundary;
    readonly promiseBody?: true;
    readonly specialization?: RustSourceCallableSpecializationVariant;
  },
): RustImplFunction {
  const { promiseBody: _enclosingPromiseBody, promiseBodyName: _enclosingPromiseBodyName, ...methodContext } = outerContext;
  let context = rustClassMemberEnvironmentContext(member, methodContext);
  const emission = context.input.program.records.methodDeclaration.get(member);
  const callable = context.input.program.records.callableDeclaration.get(member);
  if (emission?.kind !== "body" || callable === undefined) failRustPlannerInvariant("An admitted native method requires its sealed declaration and callable records.", member);
  if (options?.promiseBody !== true && callable.nativeBody !== undefined)
    return planProjectPromiseObjectMethod(member, context, options);
  if (options?.promiseBody === true) context = { ...context, promiseBody: true,
    promiseBodyName: options.targetName ?? callable.nativeBody?.name };
  const { ast } = context.input.program.source;
  const sourceMethodName = options?.targetName ??
    emission.name;
  const isUnsafe = rustDeclarationRequiresUnsafe(
    member,
    options?.safetyPlacement ?? "declaration",
    context.input,
  );
  const safetyAttributes = rustSafetyAttributesForDeclaration(
    member,
    isUnsafe,
    context.input,
  );
  const methodName = sourceMethodName;
  const bodyNode = ast.body(member);
  if (bodyNode === undefined) {
    failRustPlannerInvariant("An admitted native method requires its exact body, carrier, parameter and error-region records.", member);
  }
  const genericPlan = planRustCallableGenerics(
    member,
    context,
    new Set(emission.owner.genericParameters.flatMap(parameter => parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : [])),
    options?.typeArgumentSubstitutions,
  );
  if (genericPlan === undefined) {
    failRustPlannerInvariant("An admitted native method requires its complete syntax plan.", member);
  }
  context = genericPlan.context;
  const nativeTasks = planRustNativeTaskOwner(member, context);
  context = nativeTasks.context;
  const generatorFact = context.input.program.records.generator.get(member);
  const syntheticNames = context.syntheticNames ?? createRustSyntheticNameState(ast, member, []);
  const asyncFact = context.input.program.records.asyncFunction.get(member);
  const parameterPlan = planRustCallableParameters(callable.contract, context, syntheticNames, "source-body");
  if (parameterPlan === undefined) {
    failRustPlannerInvariant("An admitted native method requires its complete syntax plan.", member);
  }
  const environmentParameter = planMethodEnvironmentParameter(member, context);
  const params = [...(environmentParameter === undefined ? [] : [environmentParameter]), ...parameterPlan.params,
    ...nativeTasks.parameters];
  const returnsJsPromise = asyncFact?.kind === "js-promise" && options?.promiseBody !== true;
  const sourceAsync = ast.hasModifierKind(member, "async");
  if (sourceAsync && generatorFact === undefined && asyncFact === undefined) {
    failRustPlannerInvariant("An admitted native method requires its exact body, carrier, parameter and error-region records.", member);
  }
  const sourceReturn = context.input.program.records.sourceCallableReturn.get(member);
  const returnCarrier = generatorFact?.resultCarrier ?? asyncFact?.outputCarrier ?? sourceReturn?.returnCarrier;
  if (returnCarrier === undefined) {
    failRustPlannerInvariant("An admitted native method requires its exact body, carrier, parameter and error-region records.", member);
  }
  const errorRegion = planRustErrorRegion(member, context);
  const fallible = errorRegion?.boundary !== undefined;
  const callableErrorBoundary = generatorFact === undefined && errorRegion?.boundary?.kind === "source-package" && options?.fallibleBoundary !== undefined
    ? rustPackageFallibleBoundary(options.fallibleBoundary) : errorRegion?.boundary;
  if (errorRegion === undefined) {
    failRustPlannerInvariant("An admitted native method requires its exact body, carrier, parameter and error-region records.", member);
  }
  const generatorError = generatorFact === undefined ? undefined : resolveRustGeneratorBodyError(member, context);
  const bodyErrorType = generatorError === undefined ? callableErrorBoundary?.errorType : generatorError.errorType;
  const isUnit = isRustUnitCarrier(returnCarrier);
  const isNever = isRustNeverCarrier(returnCarrier);
  const returnType = isUnit || fallible && isNever
    ? undefined
    : resolveRustCallableOutwardReturnType(member, returnCarrier, context);
  if (!isUnit && !(fallible && isNever) && returnType === undefined) {
    failRustPlannerInvariant("An admitted native method requires its exact body, carrier, parameter and error-region records.", member);
  }
  const emittedReturnType = returnsJsPromise
    ? resolveRustJsPromiseReturnType(member, context)
    : returnType;
  if (returnsJsPromise && emittedReturnType === undefined) {
    failRustPlannerInvariant("An admitted native method requires its exact body, carrier, parameter and error-region records.", member);
  }
  const isStatic = emission.isStatic;
  const nativeBody = options?.promiseBody === true ? callable.nativeBody : undefined;
  if (options?.promiseBody === true && nativeBody === undefined) failRustPlannerInvariant(
    "A selected native Promise method requires its sealed declaration contract.", member);
  const visibility = nativeBody?.visibility ?? emission.visibility;
  const methodAttributes = [
    ...(isStatic && methodName === "new" ? [rustLintAttributes.newReturningOtherType] : []),
    ...(genericPlan.preservesExplicitLifetimes ? [rustLintAttributes.needlessLifetimes] : []),
    ...safetyAttributes,
  ];
  const deadCode = callable.deadCode;
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
    failRustPlannerInvariant("An admitted native method requires its exact body, carrier, parameter and error-region records.", member);
  }
  const receiverPlan = planRustSuspendedReceiver(
    generatorFact?.ownedReceiver ?? (returnsJsPromise && asyncFact.lowering.kind === "factory"
      ? asyncFact.lowering.ownedReceiver : undefined),
    { ...context, syntheticNames },
  );
  const parameterContext: RustPlanContext = {
    ...receiverPlan.context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: bodyReturnType,
    functionAbsenceReturnCarrier: sourceReturn?.undefinedReturn === true ? returnCarrier : undefined,
    asyncContext: asyncFact?.kind === "native-future" ||
      asyncFact?.kind === "js-promise" && asyncFact.lowering.kind === "factory" || generatorFact?.kind === "async",
    generator: generatorFact === undefined ? undefined : {
      declaration: member,
      controllerName: generatorControllerName!,
      protocol: generatorFact,
      errorUninhabited: generatorError!.uninhabited,
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
    failRustPlannerInvariant("An admitted native method requires its complete syntax plan.", member);
  }
  const bodyContext = parameterPrelude.context;
  const parameterStatements = parameterPrelude.statements;
  const plannedBody = planBlockLike(bodyNode, bodyContext);
  if (plannedBody === undefined) {
    failRustPlannerInvariant("An admitted native method requires its complete syntax plan.", member);
  }
  const body = { statements: [...plannedBody.statements, ...(sourceReturn?.fallthroughUndefined
    ? [planRustReturnExit(planRustAbsentValue(returnCarrier, bodyContext), bodyContext)]
    : callable.canFallThrough ? [planRustReturnExit(undefined, bodyContext)] : [])] };
  const selfMode = isStatic ? undefined : context.input.program.records.selfMode.get(member);
  if (!isStatic && selfMode === undefined) {
    failRustPlannerInvariant("An admitted native method requires its exact body, carrier, parameter and error-region records.", member);
  }
  if (generatorFact !== undefined) {
    context.usedAliases?.add("rt");
    if (returnType === undefined) {
      failRustPlannerInvariant("An admitted native method requires its exact body, carrier, parameter and error-region records.", member);
    }
    const generics = genericPlan.finalizeGenerics();
    return { kind: "function",
      name: methodName,
      ...(deadCode === undefined ? {} : { deadCode }),
      ...(isUnsafe ? { isUnsafe: true } : {}),
      visibility,
      ...(methodAttributes.length === 0 ? {} : { attrs: methodAttributes }),
      ...(isStatic ? {} : { selfParam: rustSelfParameter(selfMode!.mode) }),
      generics,
      params,
      returnType,
      body: {
        statements: [...receiverPlan.prelude, ...parameterStatements, {
          kind: "tail",
          expr: planRustGeneratorBody(body, generatorFact, generatorControllerName!),
        }],
      },
    };
  }
  const generics = genericPlan.finalizeGenerics();
  const finalizedBody = { statements: [...parameterStatements, ...body.statements] };
  const overridePrelude = options?.promiseBody !== true && options?.targetName === undefined && !isStatic
    ? planDirectProjectMethodOverridePrelude(member, params, syntheticNames, context)
    : [];
  if (overridePrelude === undefined) {
    failRustPlannerInvariant("An admitted native method requires its complete syntax plan.", member);
  }
  const shapedBody = applyRustTailShape(
    { statements: [...overridePrelude, ...finalizedBody.statements] },
    returnType !== undefined,
    new Set([...params.map(parameter => parameter.name), ...(isStatic ? [] : ["self"])]),
  );
  return { kind: "function",
    name: methodName,
    ...(deadCode === undefined ? {} : { deadCode }),
    ...(isUnsafe ? { isUnsafe: true } : {}),
    visibility,
    ...(methodAttributes.length === 0 ? {} : { attrs: methodAttributes }),
    ...(callableErrorBoundary === undefined || returnsJsPromise
      ? {}
      : { errorType: callableErrorBoundary.errorType }),
    ...(callable.nativeAsync ? { isAsync: true } : {}),
    ...(isStatic ? {} : { selfParam: rustSelfParameter(selfMode!.mode) }),
    generics,
    params,
    ...(emittedReturnType === undefined ? {} : { returnType: emittedReturnType }),
    body: returnsJsPromise
      ? { statements: [...receiverPlan.prelude, ...wrapRustJsPromiseBody(shapedBody, fallible, asyncFact.lowering,
          context.input.program.records.callableReturn.get(member)?.outward ??
            failRustPlannerInvariant("An admitted Promise method requires its sealed physical native completion.", member)).statements] }
      : shapedBody,
  };
}

function planProjectPromiseObjectMethod(
  member: Node,
  outerContext: RustPlanContext,
  options: Parameters<typeof planProjectMethod>[2],
): RustImplFunction {
  const { ast } = outerContext.input.program.source;
  const callable = outerContext.input.program.records.callableDeclaration.get(member);
  const emission = outerContext.input.program.records.methodDeclaration.get(member);
  if (callable === undefined || emission === undefined) failRustPlannerInvariant("An admitted Promise method requires its sealed declaration records.", member);
  const body = callable.nativeBody;
  const asynchronous = outerContext.input.program.records.asyncFunction.get(member);
  if (body === undefined || asynchronous?.kind !== "js-promise") failRustPlannerInvariant("An admitted native method requires its complete syntax plan.", member);
  const nativeName = options?.specialization === undefined ? body.name : options.specialization.nativeBodyName;
  if (nativeName === undefined) failRustPlannerInvariant(
    "A specialized Promise method adapter requires its exact native-body name.", member);
  const ownerLifetimes = new Set(emission.owner.genericParameters.flatMap(parameter => parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
  const genericPlan = planRustCallableGenerics(member, outerContext, ownerLifetimes, options?.typeArgumentSubstitutions);
  const nativeGenerics = planRustCallableGenerics(member, { ...outerContext, promiseBody: true }, ownerLifetimes, options?.typeArgumentSubstitutions);
  if (genericPlan === undefined || nativeGenerics === undefined) failRustPlannerInvariant("An admitted native method requires its complete syntax plan.", member);
  const syntheticNames = createRustSyntheticNameState(ast, member, []);
  const nativeTasks = planRustNativeTaskOwner(member, { ...genericPlan.context, syntheticNames });
  const context = nativeTasks.context;
  const parameterPlan = planRustCallableParameters(callable.contract, context, syntheticNames, "signature");
  if (parameterPlan === undefined) failRustPlannerInvariant("An admitted Promise method requires its native parameter plan.", member);
  const isStatic = emission.isStatic;
  const selfMode = isStatic ? undefined : context.input.program.records.selfMode.get(member);
  if (!isStatic && selfMode === undefined) failRustPlannerInvariant("An admitted native method requires its complete syntax plan.", member);
  const environment = planMethodEnvironmentParameter(member, context);
  const params = [...(environment === undefined ? [] : [environment]), ...parameterPlan.params, ...nativeTasks.parameters];
  const arguments_: RustExpr[] = params.map(parameter => ({ kind: "path", path: parameter.name }));
  const receiverPlan = planRustSuspendedReceiver(asynchronous.lowering.kind === "factory"
    ? asynchronous.lowering.ownedReceiver : undefined, context);
  const receiver: RustExpr = asynchronous.lowering.kind === "factory" && asynchronous.lowering.ownedReceiver !== undefined
    ? receiverPlan.context.expressionOverrides?.get(asynchronous.lowering.ownedReceiver.occurrences[0]!)?.expression ??
      failRustPlannerInvariant("An admitted suspended method requires its exact owned receiver binding.", member)
    : { kind: "path", path: "self" };
  const genericArguments = rustPromiseBodyGenericArguments(nativeGenerics.finalizeGenerics());
  const moduleSlot = emission.staticSlot;
  const call: RustExpr = isStatic ? { kind: "call", path: moduleSlot === undefined ? `Self::${nativeName}` : nativeName,
      args: arguments_, genericArguments }
    : { kind: "method-call", receiver, method: nativeName, args: arguments_, genericArguments };
  const nativeRegion = planRustErrorRegion(member, nativeGenerics.context);
  const returnType = resolveRustJsPromiseReturnType(member, context);
  const adapter = nativeRegion === undefined ? undefined
    : planRustPromiseBodyObjectAdapter(member, call, nativeRegion.boundary, context);
  const overrides = options?.targetName === undefined && !isStatic
    ? planDirectProjectMethodOverridePrelude(member, params, syntheticNames, context) : [];
  if (returnType === undefined || adapter === undefined || overrides === undefined) failRustPlannerInvariant("An admitted native method requires its complete syntax plan.", member);
  const isUnsafe = rustDeclarationRequiresUnsafe(member, options?.safetyPlacement ?? "declaration", context.input);
  const attrs = [...rustSafetyAttributesForDeclaration(member, isUnsafe, context.input),
    ...(genericPlan.preservesExplicitLifetimes ? [rustLintAttributes.needlessLifetimes] : [])];
  const name = options?.targetName ?? emission.name;
  if (name === undefined) failRustPlannerInvariant("An admitted native method requires its complete syntax plan.", member);
  return { kind: "function", name, visibility: emission.visibility,
    ...(callable.promiseObjectDeadCode === undefined ? {} : { deadCode: callable.promiseObjectDeadCode }),
    ...(isUnsafe ? { isUnsafe: true } : {}), ...(attrs.length === 0 ? {} : { attrs }),
    ...(isStatic ? {} : { selfParam: rustSelfParameter(selfMode!.mode) }),
    generics: genericPlan.finalizeGenerics(), params, returnType,
    body: { statements: [...overrides, ...receiverPlan.prelude, ...adapter.statements] } };
}

function planDirectProjectMethodOverridePrelude(
  member: Node,
  params: readonly import("../../../target-ast/syntax/nodes.js").RustFunctionParam[],
  syntheticNames: import("../../names/synthetic.js").RustSyntheticNameState,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const selected = context.input.program.records.methodDeclaration.get(member);
  if (selected === undefined) failRustPlannerInvariant("An admitted method requires its selected native override storage.", member);
  if (selected.override === undefined) return [];
  const { name: targetName, representation } = selected.override;
  const overrideName = allocateRustSyntheticName(
    syntheticNames,
    "method_override",
  );
  return [{ kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: overrideName }] }, expression: readRustProjectMethodOverride(
      { kind: "path", path: "self" },
      targetName,
      representation,
    ), whenTrue: { kind: "block", body: {
      statements: [{
        kind: "return",
        expr: {
          kind: "method-call",
          receiver: { kind: "path", path: overrideName },
          method: "call",
          args: [{
            kind: "tuple-literal",
            elements: params.map((parameter) => ({
              kind: "path" as const,
              path: parameter.name,
            })),
          }],
        },
      }],
    } } } }];
}

function planMethodVariant(
  member: Node, variant: RustMethodEmissionVariant, context: RustPlanContext,
): RustImplFunction {
  const specialization = variant.specialization === undefined ? undefined
    : rustCallableSpecialization(variant.specialization.sourceTypeParameterIdentities, variant.specialization.targetTypeArguments);
  if (variant.specialization !== undefined && specialization === undefined)
    failRustPlannerInvariant("An admitted method variant requires its exact native generic substitutions.", member);
  return planProjectMethod(member, context, {
    targetName: variant.name,
    ...(variant.promiseBody ? { promiseBody: true as const } : {}),
    typeArgumentSubstitutions: specialization,
    specialization: variant.specialization,
  });
}

export function planProjectMethodVariants(
  member: Node, context: RustPlanContext,
): readonly RustImplFunction[] {
  const emission = context.input.program.records.methodDeclaration.get(member);
  if (emission === undefined) failRustPlannerInvariant("An admitted native method requires its sealed emission inventory.", member);
  return Object.freeze(emission.variants.map(variant => planMethodVariant(member, variant, context)));
}

export function planProjectStaticMethods(
  definition: RustProjectTypeDefinition, context: RustPlanContext,
): readonly RustImplFunction[] {
  const members = context.input.program.records.classMethods.get(definition.declaration);
  if (members === undefined) failRustPlannerInvariant("An admitted class requires its sealed native method inventory.", definition.declaration);
  return Object.freeze(members.flatMap(member => {
    const emission = context.input.program.records.methodDeclaration.get(member);
    if (emission === undefined) failRustPlannerInvariant("An admitted class method requires its native declaration.", member);
    return emission.isStatic && emission.staticSlot === undefined ? planProjectMethodVariants(member, context) : [];
  }));
}

export function planProjectStaticFunctionItems(
  definition: RustProjectTypeDefinition, context: RustPlanContext,
): readonly import("../../../target-ast/syntax/nodes.js").RustItem[] {
  const members = context.input.program.records.classMethods.get(definition.declaration);
  if (members === undefined) failRustPlannerInvariant("An admitted class requires its sealed native method inventory.", definition.declaration);
  return Object.freeze(members.flatMap(member => {
    const emission = context.input.program.records.methodDeclaration.get(member);
    if (emission === undefined) failRustPlannerInvariant("An admitted class method requires its native declaration.", member);
    if (emission.staticSlot === undefined) return [];
    const captured = emission.environment === undefined ? emptyRustGenerics
      : rustProjectGenerics(emission.owner, context, emission.environment.genericParameterIndexes);
    return emission.variants.map(variant => {
      const method = planMethodVariant(member, variant, context);
      return { ...method, kind: "function" as const, name: variant.moduleName,
        visibility: variant.moduleVisibility, generics: {
          parameters: [...method.generics.parameters, ...captured.parameters],
          wherePredicates: [...method.generics.wherePredicates, ...captured.wherePredicates],
        } };
    });
  }));
}

function planMethodEnvironmentParameter(member: Node, context: RustPlanContext) {
  const selected = context.input.program.records.methodDeclaration.get(member);
  if (selected === undefined) failRustPlannerInvariant("An admitted method requires its sealed environment parameter.", member);
  const environment = selected.environment;
  if (environment === undefined) return undefined;
  const type = rustClassEnvironmentType(environment.carrier, context);
  if (type === undefined) failRustPlannerInvariant("An admitted method environment requires its renderable native carrier.", member);
  return { name: environment.name, type: { kind: "reference" as const, referent: type, mutable: false } };
}
