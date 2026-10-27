import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import type { RustCallGenericArgument, RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTargetGenericTypeArguments, substituteRustTargetGenericArgument } from "../../../../target-model/types/index.js";
import { rustMemberAccessReceiver } from "../../../../target-model/syntax/expressions.js";
import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { planExpression } from "../entry.js";
import { planPromotedSourceMethodCall, shapeRustSourceCallParameters, type RustSourceArgumentEvaluation } from "./arguments.js";
import { rustPreparedValueLocation } from "../../objects/value-fields.js";
import { planRustLexicalFunctionArguments } from "../../declarations/callables/lexical-functions.js";
import { rustClassStaticCallGenericArguments, rustClassStaticEnvironmentForCall, rustOwnedClassEnvironmentForCall } from "../../objects/class-environments.js";
import { sourceModuleItemPath, rustActiveErrorType, rustCurrentErrorBoundary, rustErrorBoundaryForProjectMember } from "../../program/plan-context.js";
import { rustErrorType, rustPropagateLocalError } from "../../program/fallible-boundaries.js";
import { invokeRustStructuralObjectMethod } from "../../objects/project-storage.js";
import { planRustExactProjectMethodCall, planRustVirtualProjectMethodCall } from "../../objects/project-method-dispatch.js";
import { rustTargetCallGenericArgumentToAstInContext, rustTypeFromCarrierInContext, rustCallTypeFromCarrierInContext } from "../../types/render.js";
import { rustTypeEquals } from "../../../target-ast/syntax/type-equality.js";
import { rustOptionalStorageCallArguments } from "../../types/type-projections.js";
import { planRustPromotedStorageLocation } from "../typed-locations.js";
import { rustBottomAfterEffect, rustBottomExpression, rustEliminateInfallibleResult } from "../../types/fallible-shape.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { planRustUnionMethodCall } from "./union-methods.js";
import { planRustNativeInputInvocation, planRustNativeInputPropagation } from "./native-input.js";
import { planRustGenericCallableErrorPropagation } from "./generic-errors.js";
import { planRustSourceErrorPropagation, planRustSelectedSourceErrorPropagation } from "./source-errors.js";
import { planRustNativeTaskCallArguments } from "../../program/native-tasks.js";

export function planSelectedSourceCall(node: Node, callee: Node | undefined, argumentPlan: RustSourceArgumentEvaluation,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>, context: RustPlanContext): RustExpr | undefined {
  const selection = context.input.program.records.sourceCall.get(node)
    ?? failRustPlannerInvariant("An admitted source call requires its exact native target, parameters and invocation effects.", node);
  const shaped = shapeRustSourceCallParameters(argumentPlan, fact, context);
  if (shaped === undefined) failRustPlannerInvariant("An admitted source call requires its native argument evaluation plan.", node);
  const targetArguments = (fact.targetGenericArguments ?? []).map(argument => substituteRustTargetGenericArgument(argument,
    context.typeParameterSubstitutions ?? new Map(), context.lifetimeSubstitutions ?? new Map()));
  const typeArguments = rustTargetGenericTypeArguments(targetArguments);
  const specialization = selection.specialized ? context.input.program.records.sourceCallSpecialization.get(node, typeArguments) : undefined;
  if (selection.specialized && specialization === undefined) failRustPlannerInvariant("An admitted source call requires its exact finite native specialization.", node);
  const generics: RustCallGenericArgument[] = [];
  for (const argument of targetArguments) {
    if (argument.kind === "lifetime") continue;
    const rendered = rustTargetCallGenericArgumentToAstInContext(argument, context);
    if (rendered === undefined) failRustPlannerInvariant("An admitted source call requires its native generic argument syntax.", node);
    generics.push(rendered);
  }
  if (specialization === undefined) {
    for (const parameter of selection.lexicalParameters) {
      if (context.typeParameterSubstitutions?.has(parameter.identity) === true) continue;
      const type = rustTypeFromCarrierInContext(parameter, context);
      if (type === undefined) failRustPlannerInvariant("An admitted lexical call requires its native type argument.", node);
      generics.push({ kind: "type", type });
    }
    if (selection.optionalStorage) generics.push(...rustOptionalStorageCallArguments(node, context));
    if (generics.length !== 0 || selection.witnesses.some(witness => witness !== undefined)) for (const witness of selection.witnesses) {
      const type = witness === undefined ? { kind: "infer" as const } : rustTypeFromCarrierInContext(witness, context);
      if (type === undefined) failRustPlannerInvariant("An admitted source call requires its native invocation witness.", node);
      generics.push({ kind: "type", type });
    }
  }
  const callGenerics = generics.length === 0 || specialization !== undefined ? undefined : generics;
  const bodyName = fact.asyncBody === undefined ? undefined : specialization === undefined ? fact.asyncBody.targetName : specialization.nativeBodyName;
  if (fact.asyncBody !== undefined && bodyName === undefined) failRustPlannerInvariant("An admitted native Promise call requires its exact selected body name.", node);
  const declaration = selection.declaration;
  const classSource = "classReceiver" in fact.target ? fact.target.classReceiver : undefined;
  const bindings: { name: string; value: RustExpr }[] = [];
  let retained: RustExpr | undefined;
  if (classSource !== undefined) {
    const value = planExpression(classSource, context);
    const names = context.syntheticNames;
    if (value === undefined || names === undefined) failRustPlannerInvariant("An admitted class call requires its native receiver evaluation.", node);
    const name = allocateRustSyntheticName(names, "_class_receiver");
    bindings.push({ name, value });
    retained = { kind: "path", path: name };
  }
  const native = context.input.program.records.nativeInputInvocation.get(node)?.call;
  const taskArguments = planRustNativeTaskCallArguments(node, context);
  let planned: RustExpr | undefined;
  switch (fact.target.form) {
    case "constructor-value": {
      const receiver = callee === undefined ? undefined : planExpression(callee, context);
      if (receiver === undefined || selection.constructor === undefined) failRustPlannerInvariant("An admitted constructor value requires its native receiver and dispatch slot.", node);
      planned = { kind: "method-call", receiver: { kind: "method-call", receiver: { kind: "field", receiver, name: "dispatch" }, method: "clone", args: [] },
        method: selection.constructor.name, args: shaped };
      break;
    }
    case "union-method": planned = planRustUnionMethodCall(node, shaped, callGenerics, typeArguments, context); break;
    case "function": {
      const name = bodyName ?? specialization?.targetName ?? fact.target.name;
      const path = selection.lexical ? name : sourceModuleItemPath(context, fact.target.fileName, name);
      const captures = declaration === undefined ? [] : planRustLexicalFunctionArguments(declaration, context);
      if (path === undefined || captures === undefined) failRustPlannerInvariant("An admitted function call requires its native source path and capture arguments.", node);
      const environment = rustClassStaticEnvironmentForCall(declaration, context, retained);
      planned = { kind: "call", path, args: [...(environment === undefined ? [] : [{ kind: "reference" as const, expr: environment }]), ...shaped, ...captures, ...taskArguments],
        genericArguments: rustClassStaticCallGenericArguments(declaration, callGenerics, context) };
      break;
    }
    case "method": {
      const argumentsWithScope = [...shaped, ...taskArguments];
      const name = bodyName ?? (fact.target.dispatch === undefined ? specialization?.targetName ?? fact.target.name : fact.target.name);
      const receiverNode = rustMemberAccessReceiver(context.input.program.source.ast, callee);
      if (fact.target.dispatch !== undefined) {
        if (taskArguments.length !== 0)
          failRustPlannerInvariant("An admitted task-scoped method requires its selected non-virtual call ABI.", node);
        // Inside a specialized callable the variant is the one sealed for the active specialization's substitutions.
        const substitutions = context.typeParameterSubstitutions;
        const variant = selection.dispatch ?? selection.specializedDispatch.find(entry => substitutions !== undefined &&
          [...entry.substitutions].every(([identity, carrier]) => rustTargetTypeRefEquals(substitutions.get(identity), carrier)))?.variant
          ?? failRustPlannerInvariant("An admitted method requires its native dispatch specialization.", node);
        // An exact call (super.method()) dispatches through the active project root; only a virtual call evaluates its
        // receiver expression (`super` has no value of its own).
        if (fact.target.dispatch.selected === "exact") {
          planned = planRustExactProjectMethodCall(node, context.projectDispatchRoot, fact.target.dispatch.ownerCarrier, variant.exactSlot, shaped, context);
          break;
        }
        const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
        planned = receiver === undefined ? undefined
          : planRustVirtualProjectMethodCall(node, receiver, fact.target.dispatch.ownerCarrier, variant.virtualSlot, shaped, context);
        break;
      }
      const promoted = receiverNode === undefined || !fact.target.mutatesSelf ? { kind: "not-promoted" as const }
        : planRustPromotedStorageLocation(receiverNode, context, planExpression, shaped.length > 0);
      if (promoted.kind === "promoted") {
        if (promoted.expression === undefined) failRustPlannerInvariant("An admitted method requires its selected native storage place.", node);
        planned = planPromotedSourceMethodCall(node, promoted.expression, name, argumentsWithScope, context);
        break;
      }
      const override = receiverNode === undefined ? undefined : context.expressionOverrides?.get(receiverNode);
      const receiver = override?.valueForm === "storage" ? override.expression : receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      if (receiver !== undefined) planned = { kind: "method-call", receiver, method: name, args: argumentsWithScope, genericArguments: callGenerics,
        receiverMode: fact.target.mutatesSelf ? "mut-ref" : "ref" };
      break;
    }
    case "static-method": {
      const owner = rustCallTypeFromCarrierInContext(fact.target.typeCarrier, context);
      const environment = rustClassStaticEnvironmentForCall(declaration, context, retained);
      if (owner !== undefined) planned = { kind: "associated-call", owner, method: bodyName ?? specialization?.targetName ?? fact.target.name,
        args: [...(environment === undefined ? [] : [{ kind: "reference" as const, expr: environment }]), ...shaped, ...taskArguments], genericArguments: callGenerics };
      break;
    }
    case "constructor": {
      const owner = rustTypeFromCarrierInContext(fact.target.typeCarrier, context);
      const environment = selection.constructorOwner === undefined ? undefined : rustOwnedClassEnvironmentForCall(selection.constructorOwner, context, retained);
      if (owner !== undefined) planned = { kind: "associated-call", owner, method: fact.target.name, args: [...(environment === undefined ? [] : [environment]), ...shaped] };
      break;
    }
    case "callable": {
      const location = callee === undefined ? undefined : rustPreparedValueLocation(callee, context);
      if (location?.invoke !== undefined) { planned = location.invoke(shaped, context); break; }
      const callable = callee === undefined ? undefined : planExpression(callee, context);
      if (callable === undefined) failRustPlannerInvariant("An admitted callable requires its native callee value.", node);
      planned = native !== undefined ? planRustNativeInputInvocation(native, callable, shaped, callGenerics, context)
        : selection.callable === "direct" ? { kind: "invoke", callee: callable, args: shaped }
        : { kind: "method-call", receiver: callable, method: selection.callable === "input" ? "invoke" : "call",
          args: selection.callable === "generic" ? shaped : [{ kind: "tuple-literal", elements: shaped }],
          genericArguments: selection.callable === "generic" ? callGenerics : undefined };
      break;
    }
    case "structural-method": {
      const source = rustMemberAccessReceiver(context.input.program.source.ast, callee);
      const receiver = source === undefined ? undefined : planExpression(source, context);
      const override = callee === undefined ? undefined : context.expressionOverrides?.get(callee);
      if (receiver !== undefined) planned = invokeRustStructuralObjectMethod(fact.target.receiverCarrier, receiver, fact.target.storageIndex, shaped,
        fact.resultCarrier, context, bodyName, override === undefined ? undefined : { expression: override.expression, carrier: override.carrier }, typeArguments, callGenerics);
      break;
    }
  }
  if (planned === undefined) failRustPlannerInvariant("An admitted source call requires its exact native target syntax.", node);
  if (bindings.length !== 0) planned = rustValueBlock(bindings, planned);
  if (context.promiseBodyName !== undefined && selection.pinnedBodies.has(context.promiseBodyName))
    planned = { kind: "call", path: "std::boxed::Box::pin", args: [planned] };
  if (fact.target.form === "union-method") return planned;
  if (native !== undefined) {
    const result = planRustNativeInputPropagation(node, native, planned, context);
    return result === undefined ? undefined : selection.never ? rustBottomAfterEffect(result, "fallible never call returned") : result;
  }
  if (selection.eliminateInfallible) {
    const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted native callable result requires its hygienic names.", node);
    return rustEliminateInfallibleResult(planned, allocateRustSyntheticName(names, "call_value"), allocateRustSyntheticName(names, "call_error"));
  }
  const effects = context.input.program.records.sourceCallEffects.get(node)
    ?? failRustPlannerInvariant("An admitted source call requires its exact sealed invocation effects.", node);
  if (effects.invocation === "infallible") return selection.never ? rustBottomExpression(planned) : planned;
  const generic = context.input.program.records.genericCallableInvocation.get(node);
  let result: RustExpr | undefined;
  if (generic !== undefined) result = planRustGenericCallableErrorPropagation(node, generic, "invocation", planned, context);
  else if (selection.frameError !== undefined) result = planRustSelectedSourceErrorPropagation(node, selection.frameError, planned, context);
  else if (selection.errorEdge !== undefined) result = planRustSourceErrorPropagation(node, selection.errorEdge, planned, context);
  else if (selection.physicalCallableError !== undefined && rustActiveErrorType(context) !== undefined &&
    rustTypeEquals(rustTypeFromCarrierInContext(selection.physicalCallableError, context) ?? { kind: "infer" }, rustActiveErrorType(context)!)) {
    // A concrete callable whose physical error is already the active boundary's error propagates it unchanged.
    const errorType = rustActiveErrorType(context)!;
    result = { kind: "try", expr: planned, operandErrorType: errorType, resultErrorType: errorType };
  } else {
    const operand = selection.callable !== undefined ? rustCurrentErrorBoundary(context)
      : declaration === undefined ? undefined : rustErrorBoundaryForProjectMember(declaration, context);
    if (rustActiveErrorType(context) === undefined || context.fallibleBoundary === undefined || operand === undefined)
      failRustPlannerInvariant("An admitted fallible source call requires its exact active native error boundary.", node);
    result = rustPropagateLocalError(context.fallibleBoundary, rustErrorType(operand), planned);
  }
  if (result === undefined) failRustPlannerInvariant("An admitted source call requires its exact native error propagation.", node);
  return selection.never ? rustBottomAfterEffect(result, "fallible never call returned") : result;
}
