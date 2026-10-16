import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import { rustPreparedValueLocation } from "../../objects/value-fields.js";
import { planRustLexicalFunctionArguments } from "../../declarations/callables/lexical-functions.js";
import {
  isRustNeverCarrier,
  isRustUnitCarrier,
  rustCallableProtocol,
  rustCallableInputProtocol,
  rustSourceTypeCarrierValue,
  rustTargetGenericTypeArguments,
  substituteRustTargetGenericArgument,
  substituteRustTargetGenerics,
} from "../../../../target-model/types/index.js";
import { rustClassStaticCallGenericArguments, rustClassStaticEnvironmentForCall, rustOwnedClassEnvironmentForCall } from "../../objects/class-environments.js";
import { rustSourceCallArgumentCarriers } from "../../../../analysis/callables/source-call-lifetimes.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustActiveErrorType,
  rustCurrentErrorBoundary,
  rustErrorBoundaryForProjectMember,
  rustErrorType,
  sourceModuleItemPath,
  sourceTypePath,
} from "../../program/plan-context.js";
import { invokeRustStructuralObjectMethod } from "../../objects/project-storage.js";
import { isDenseDataArray } from "../../../../target-model/metadata/closed-data.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import { planExpression } from "../entry.js";
import {
  planPromotedSourceMethodCall,
  shapeRustSourceCallParameters,
  sourceCallSelectedMemberMatches,
} from "./arguments.js";
import { planRustPromotedStorageLocation } from "../typed-locations.js";
import { rustBottomAfterEffect, rustBottomExpression, rustEliminateInfallibleResult } from "../../types/fallible-shape.js";
import { rustNativeCallableOperand } from "../../../../analysis/callables/native-conversions.js";
import {
  planRustExactProjectMethodCall,
  planRustVirtualProjectMethodCall,
} from "../../objects/project-method-dispatch.js";

import {
  rustTargetCallGenericArgumentToAstInContext,
  rustTypeFromCarrierInContext,
} from "../../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustCallGenericArgument, RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations.js";
import { planRustUnionMethodCall } from "./union-methods.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../../../target-model/types/carriers/generic-callables.js";

import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { planRustGenericCallableErrorPropagation } from "./generic-errors.js";
import { rustSourceCallCallableStorageCarrier } from "../../../../analysis/operations/target-operation.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { rustExpressionReferencesPath } from "../../../target-ast/inspection/source-usage.js";
import { propagateRustBottomOperand } from "../bottom-operands.js";
import { rustOptionalStorageCallArguments } from "../../types/type-projections.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import { rustMemberAccessReceiver } from "../../../../target-model/syntax/expressions.js";
import { planRustNativeInputInvocation, planRustNativeInputPropagation, rustNativeInputEffectsMatch } from "./native-input.js";
import { rustPropagateLocalError } from "../../program/fallible-boundaries.js";

import { planRustSourceErrorPropagation } from "./source-errors.js";
import { rustRetainedCallSubstitutions } from "../../../../analysis/callables/retained-call-lifetimes.js";
import { rustValueCarrierBeforeContextualConversion } from "../../../../analysis/conversions/value-carrier-queries.js";
import { rustNativeCallableCompletion } from "../../../../target-model/types/callable-completions.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";

export function sourceCallEffectsMatch(
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  effects: import("../../../../target-model/records/object-methods.js").RustSourceCallEffectsFact | undefined,
  definitions: RustTypeDefinitions,
  nativeInput?: import("../../../../analysis/callables/native-inputs.js").RustNativeCallableCall,
): boolean {
  if (effects === undefined ||
    (effects.invocation !== "infallible" && effects.invocation !== "fallible") ||
    (effects.awaiting !== "not-applicable" && effects.awaiting !== "infallible" && effects.awaiting !== "fallible")) {
    return false;
  }
  if (nativeInput !== undefined || effects.nativeInput !== undefined) {
    return fact.target.form === "callable" && nativeInput !== undefined && rustNativeInputEffectsMatch(nativeInput, effects);
  }
  const isAsync = rustNativeCallableCompletion(fact.resultCarrier, definitions) !== undefined;
  if (fact.target.form === "union-method") {
    if (effects.unionBranches?.length !== fact.target.variants.length ||
      !effects.unionBranches.every(branch => branch !== undefined &&
        (branch.invocation === "infallible" || branch.invocation === "fallible") &&
        (isAsync ? branch.awaiting === "infallible" || branch.awaiting === "fallible"
          : branch.awaiting === "not-applicable"))) return false;
    const invocation = effects.unionBranches.some(branch => branch.invocation === "fallible") ? "fallible" : "infallible";
    const awaiting = !isAsync ? "not-applicable"
      : effects.unionBranches.some(branch => branch.awaiting === "fallible") ? "fallible" : "infallible";
    return effects.invocation === invocation && effects.awaiting === awaiting;
  }
  const callableCarrier = fact.target.form === "callable"
    ? fact.target.carrier
    : fact.target.form === "structural-method" || fact.target.form === "constructor-value"
      ? fact.target.callableCarrier
      : undefined;
  return isAsync
    ? effects.awaiting !== "not-applicable" &&
      (callableCarrier === undefined || callableCarrier.kind === "function-pointer" ||
        rustGenericCallableValue(callableCarrier) !== undefined ||
        effects.invocation === "fallible")
    : effects.awaiting === "not-applicable";
}

export function planSelectedSourceCall(
  node: Node,
  callee: Node | undefined,
  args: readonly RustExpr[],
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  context: RustPlanContext,
  borrowedInputs: ReadonlyMap<Node, RustExpr>,
): RustExpr | undefined {
  const selected = context.input.program.records.selectedCall.get(node);
  const selectedMatches = selected !== undefined && sourceCallSelectedMemberMatches(
    fact,
    selected,
    selected.member.returnType,
    context.input.program.typeFamilies.normalize,
    context.input.program.projectTypes,
    rustSourceCallArgumentCarriers(node, context.input.program.source.ast, context.input.program.records),
    context.input.program.typeDefinitions,
    rustRetainedCallSubstitutions(context.input.program.records, node),
  );
  if (!selectedMatches) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-selected-signature",
      "Selected project-source call fact conflicts with the TSTS-selected target member ABI.",
    ));
    return undefined;
  }
  const rawArgumentNodes = context.input.program.source.ast.arguments(node);
  if (!isDenseDataArray(rawArgumentNodes) || rawArgumentNodes.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-arguments",
      "Selected project-source call contains an undefined or non-data argument slot.",
    ));
    return undefined;
  }
  const argumentNodes = rawArgumentNodes as readonly Node[];
  const nativeInput = context.input.program.callableValues.native.callFor(node);
  if (argumentNodes.length !== args.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-arguments",
      "Selected project-source call arguments do not match the finalized Rust expression plan.",
    ));
    return undefined;
  }
  const shaped = shapeRustSourceCallParameters(
    argumentNodes,
    args,
    fact,
    context,
    borrowedInputs,
  );
  if (shaped === undefined) {
    return undefined;
  }
  const sourceGenericArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const targetGenericArguments = (fact.targetGenericArguments ?? []).map((argument) =>
    substituteRustTargetGenericArgument(
      argument,
      context.typeParameterSubstitutions ?? new Map(),
      context.lifetimeSubstitutions ?? new Map(),
    ));
  if (sourceGenericArguments.length !== targetGenericArguments.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-generic-arguments",
      "Selected project-source call has inconsistent source and target generic-argument evidence.",
    ));
    return undefined;
  }
  const targetAstGenericArguments = targetGenericArguments.flatMap(
    (argument): readonly (RustCallGenericArgument | undefined)[] =>
      argument.kind === "lifetime"
        ? []
        : [rustTargetCallGenericArgumentToAstInContext(argument, context)],
  );
  if (targetAstGenericArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-generic-arguments",
      "Selected project-source call generic arguments do not have exact Rust target representations.",
    ));
    return undefined;
  }
  const targetTypeArguments = rustTargetGenericTypeArguments(targetGenericArguments);
  const selectedDeclaration = selected.sourceDeclaration;
  const requiresCallableSpecialization = selectedDeclaration !== undefined &&
    context.input.program.sourceCallableSpecializations.requiresSpecialization(
      selectedDeclaration,
    );
  const callableSpecialization = requiresCallableSpecialization && selectedDeclaration !== undefined
    ? context.input.program.sourceCallableSpecializations.variantForCall(
        selectedDeclaration,
        targetTypeArguments,
      )
    : undefined;
  if (requiresCallableSpecialization && callableSpecialization === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-callable-specialization",
      "Selected project-source call has no exact finite Rust callable specialization.",
    ));
    return undefined;
  }
  if (selectedDeclaration !== undefined && callableSpecialization === undefined && fact.target.form !== "constructor") {
    const lexical = context.input.program.lexicalFunctions.forDeclaration(selectedDeclaration);
    if (lexical?.kind === "unresolved") return undefined;
    for (const parameter of lexical?.genericParameters ?? []) {
      if (parameter.kind !== "type" || context.typeParameterSubstitutions?.has(parameter.identity) === true) continue;
      const type = rustTypeFromCarrierInContext({ kind: "type-parameter", identity: parameter.identity,
        name: parameter.targetName }, context);
      if (type === undefined) return undefined;
      targetAstGenericArguments.push({ kind: "type", type });
    }
    const contract = context.input.program.declarationGenericRequirements.contractFor(selectedDeclaration,
      fact.asyncBody === undefined ? undefined : true);
    if (contract !== undefined) {
      const substitutions = new Map(contract.typeParameters.map((parameter, index) =>
        [parameter.identity, targetTypeArguments[index]!] as const));
      targetAstGenericArguments.push(...rustOptionalStorageCallArguments(selectedDeclaration, substitutions, context));
    }
  }
  if (selectedDeclaration !== undefined && fact.target.form !== "callable" &&
    callableSpecialization === undefined) {
    const native = context.input.program.callableValues.native;
    const inputs = new Set([...native.inputsFor(selectedDeclaration), ...native.capturesFor(selectedDeclaration)]);
    const witnesses = [...inputs].map(input => context.input.program.callableValues.nativeStorage.invocationWitnessFor(input, node));
    if (targetAstGenericArguments.length > 0 || witnesses.some(witness => witness !== undefined)) {
      for (const witness of witnesses) {
        const type = witness === undefined ? { kind: "infer" as const } : rustTypeFromCarrierInContext(witness, context);
        if (type === undefined) return undefined;
        targetAstGenericArguments.push({ kind: "type", type });
      }
    }
  }
  const callGenericArguments = targetAstGenericArguments.length === 0 ||
      callableSpecialization !== undefined
    ? undefined
    : targetAstGenericArguments as readonly RustCallGenericArgument[];

  const classReceiver = "classReceiver" in fact.target ? fact.target.classReceiver : undefined;
  const classBindings: { name: string; value: RustExpr }[] = [];
  let retainedClass: RustExpr | undefined;
  if (classReceiver !== undefined) {
    const value = planExpression(classReceiver, context);
    if (value === undefined || context.syntheticNames === undefined) return undefined;
    const name = allocateRustSyntheticName(context.syntheticNames, "class_receiver");
    classBindings.push({ name, value });
    retainedClass = { kind: "path", path: name };
  }
  let planned: RustExpr | undefined;
  switch (fact.target.form) {
    case "constructor-value": {
      const constructor = context.input.program.structuralShapes.definitionForCarrier(fact.target.receiverCarrier)?.construction;
      const receiver = callee === undefined ? undefined : planExpression(callee, context);
      if (constructor === undefined || receiver === undefined || callee === undefined) break;
      const selected: RustExpr = { kind: "field", receiver: receiver, name: "dispatch" };
      planned = { kind: "method-call", receiver: { kind: "method-call", receiver: selected, method: "clone", args: [] },
        method: constructor.targetName, args: shaped };
      break;
    }
    case "union-method": {
      planned = planRustUnionMethodCall(node, callee, shaped, fact, fact.target, callGenericArguments, targetTypeArguments, context);
      break;
    }
    case "function": {
      const targetName = fact.asyncBody !== undefined ? fact.asyncBody.targetName
        : callableSpecialization?.targetName ?? fact.target.name;
      const declaration = selected.sourceDeclaration;
      const lexical = declaration === undefined ? undefined : context.input.program.lexicalFunctions.forDeclaration(declaration);
      const path = lexical === undefined ? sourceModuleItemPath(context, fact.target.fileName, targetName) : targetName;
      const captures = declaration === undefined ? [] : planRustLexicalFunctionArguments(declaration, context);
      if (captures === undefined) break;
      if (path === undefined || !isValidRustIdentifier(targetName)) {
        break;
      }
      const environment = rustClassStaticEnvironmentForCall(selected.sourceDeclaration, context, retainedClass);
      const genericArguments = rustClassStaticCallGenericArguments(selected.sourceDeclaration, callGenericArguments, context);
      planned = {
        kind: "call",
        path,
        args: [...(environment === undefined ? [] : [{ kind: "reference" as const, expr: environment }]), ...shaped, ...captures],
        ...(genericArguments === undefined ? {} : { genericArguments }),
      };
      break;
    }
    case "method": {
      const targetName = fact.asyncBody?.targetName ?? (fact.target.dispatch === undefined
        ? callableSpecialization?.targetName ?? fact.target.name
        : fact.target.name);
      if (!isValidRustIdentifier(targetName)) {
        break;
      }
      const receiverNode = rustMemberAccessReceiver(context.input.program.source.ast, callee);
      if (fact.target.dispatch !== undefined) {
        const dispatchDeclaration = selected.sourceDeclaration;
        const dispatchVariant = dispatchDeclaration === undefined
          ? undefined
          : context.input.program.projectMethodDispatch.variantForMember(
              dispatchDeclaration,
              targetTypeArguments,
              substituteRustTargetGenerics(fact.target.dispatch.ownerCarrier,
                context.typeParameterSubstitutions ?? new Map(), context.lifetimeSubstitutions ?? new Map()),
            );
        if (dispatchVariant === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.project-method-specialization",
            "Selected polymorphic project call has no exact finalized Rust dispatch specialization.",
          ));
          break;
        }
        planned = fact.target.dispatch.selected === "exact"
          ? planRustExactProjectMethodCall(
              node,
              context.projectDispatchRoot,
              fact.target.dispatch.ownerCarrier,
              dispatchVariant.exactSlot,
              shaped,
              context,
            )
          : receiverNode === undefined
            ? undefined
            : (() => {
                const receiver = planExpression(receiverNode, context);
                return receiver === undefined
                  ? undefined
                  : planRustVirtualProjectMethodCall(
                      node,
                      receiver,
                      fact.target.dispatch.ownerCarrier,
                      dispatchVariant.virtualSlot,
                      shaped,
                      context,
                    );
              })();
        break;
      }
      const promoted = receiverNode === undefined || !fact.target.mutatesSelf
        ? { kind: "not-promoted" as const }
        : planRustPromotedStorageLocation(
            receiverNode,
            context,
            planExpression,
            shaped.length > 0,
          );
      if (promoted.kind === "promoted") {
        if (promoted.expression === undefined) {
          break;
        }
        planned = planPromotedSourceMethodCall(
          node,
          promoted.expression,
          targetName,
          shaped,
          context,
        );
        break;
      }
      const receiverOverride = receiverNode === undefined
        ? undefined
        : context.expressionOverrides?.get(receiverNode);
      const receiver = receiverOverride?.valueForm === "storage"
        ? receiverOverride.expression
        : receiverNode === undefined
          ? undefined
          : planExpression(receiverNode, context);
      if (receiver !== undefined) {
        planned = {
          kind: "method-call",
          receiver,
          method: targetName,
          ...(callGenericArguments === undefined ? {} : { genericArguments: callGenericArguments }),
          args: shaped,
          receiverMode: fact.target.mutatesSelf ? "mut-ref" : "ref",
        };
      }
      break;
    }
    case "static-method": {
      const value = rustSourceTypeCarrierValue(fact.target.typeCarrier);
      const typePath = value === undefined ? undefined : sourceTypePath(context, value);
      const targetName = fact.asyncBody?.targetName ?? callableSpecialization?.targetName ?? fact.target.name;
      if (typePath !== undefined && isValidRustIdentifier(targetName)) {
        const environment = rustClassStaticEnvironmentForCall(selected.sourceDeclaration, context, retainedClass);
        planned = {
          kind: "call",
          path: `${typePath}::${targetName}`,
          args: [...(environment === undefined ? [] : [{ kind: "reference" as const, expr: environment }]), ...shaped],
          ...(callGenericArguments === undefined ? {} : { genericArguments: callGenericArguments }),
        };
      }
      break;
    }
    case "constructor": {
      const owner = rustTypeFromCarrierInContext(fact.target.typeCarrier, context);
      const targetName = fact.target.name;
      if (owner !== undefined && isValidRustIdentifier(targetName)) {
        const definition = context.input.program.projectTypes.definitionForCarrier(fact.target.typeCarrier);
        const environment = definition === undefined ? undefined : rustOwnedClassEnvironmentForCall(definition.declaration, context, retainedClass);
        planned = {
          kind: "associated-call",
          owner,
          method: targetName,
          args: [...(environment === undefined ? [] : [environment]), ...shaped],
        };
      }
      break;
    }
    case "callable": {
      const location = callee === undefined ? undefined : rustPreparedValueLocation(callee, context);
      if (location?.invoke !== undefined) {
        planned = location.invoke(shaped, context);
        break;
      }
      const plannedCallable = callee === undefined ? undefined : planExpression(callee, context);
      if (callee === undefined || plannedCallable === undefined) {
        break;
      }
      const callable = plannedCallable;
      if (nativeInput !== undefined) {
        planned = planRustNativeInputInvocation(nativeInput, callable, shaped, callGenericArguments, context);
        break;
      }
      if (fact.target.carrier.kind === "function-pointer" ||
        fact.target.carrier.kind === "closure") {
        planned = { kind: "invoke", callee: callable, args: shaped };
        break;
      }
      const generic = rustGenericCallableValue(fact.target.carrier);
      const protocol = rustGenericCallableProtocol(fact.target.carrier) ?? rustCallableProtocol(fact.target.carrier);
      if (protocol !== undefined && protocol.parameters.length === shaped.length) {
        planned = {
          kind: "method-call",
          receiver: callable,
          method: rustCallableInputProtocol(fact.target.carrier) === undefined ? "call" : "invoke",
          args: generic === undefined ? [{ kind: "tuple-literal", elements: shaped }] : shaped,
          ...(generic === undefined || callGenericArguments === undefined ? {} : { genericArguments: callGenericArguments }),
        };
      }
      break;
    }
    case "structural-method": {
      const receiverNode = rustMemberAccessReceiver(context.input.program.source.ast, callee);
      const receiver = receiverNode === undefined
        ? undefined
        : planExpression(receiverNode, context);
      const storageOverride = callee === undefined
        ? undefined
        : context.expressionOverrides?.get(callee);
      if (receiverNode !== undefined && receiver !== undefined) {
        planned = invokeRustStructuralObjectMethod(
          fact.target.receiverCarrier,
          receiver,
          fact.target.storageIndex,
          shaped,
          fact.resultCarrier,
          context,
          storageOverride === undefined
            ? undefined
            : {
                expression: storageOverride.expression,
                carrier: storageOverride.carrier,
              },
          targetTypeArguments,
          callGenericArguments,
        );
      }
      break;
    }
  }
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-target",
      "Selected project-source call target does not resolve to a finalized Rust path or receiver operation.",
    ));
    return undefined;
  }
  if (fact.parameters.some((parameter, index) => {
    const argument = shaped[index];
    return isRustUnitCarrier(parameter.parameterCarrier) && argument !== undefined &&
      argument.kind !== "path" && !(argument.kind === "tuple-literal" && argument.elements.length === 0);
  })) {
    planned = rustValueBlock([], planned, { value: [rustLintAttributes.unitArguments] });
  }
  if (classBindings.length > 0) planned = rustValueBlock(classBindings.map(binding =>
    rustExpressionReferencesPath(planned!, binding.name) ? binding : { ...binding, name: `_${binding.name}` }), planned);
  const effects = context.input.program.records.sourceCallEffects.get(node);
  if (effects === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-effects",
      "Project-source call requires finalized post-fixpoint invocation and await effects.",
    ));
    return undefined;
  }
  const callableCarrier = rustSourceCallCallableStorageCarrier(fact, context.input.program.structuralShapes);
  const genericInvocation = context.input.program.records.genericCallableInvocation.get(node);
  if (nativeInput !== undefined && !rustNativeInputEffectsMatch(nativeInput, effects)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.native-callable-effects", "Native invocation effects conflict with the sealed input implementation contract."));
    return undefined;
  }
  if (nativeInput === undefined && rustGenericCallableValue(callableCarrier) !== undefined) {
    const physical = context.input.program.callableValues.nativeStorage.invocationCallableFor(node);
    if (genericInvocation === undefined || physical === undefined || physical.kind === "unresolved" ||
      !rustTargetTypeRefEquals(physical.carrier, genericInvocation.carrier) ||
      genericInvocation.effects.invocation !== effects.invocation || genericInvocation.effects.awaiting !== effects.awaiting) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.generic-callable-effects",
        "The invocation effects differ from the sealed generic implementation family."));
      return undefined;
    }
  }
  if (context.syntheticNames !== undefined) planned = propagateRustBottomOperand(planned, context.syntheticNames);
  if (planned.kind === "bottom" || fact.target.form === "union-method") return planned;
  if (nativeInput !== undefined) {
    const result = planRustNativeInputPropagation(node, nativeInput, planned, context);
    return result === undefined ? undefined : isRustNeverCarrier(fact.resultCarrier)
      ? rustBottomAfterEffect(result, "fallible never call returned") : result;
  }
  if (fact.target.form === "callable" && rustCallableProtocol(fact.target.carrier) !== undefined && callee !== undefined) {
    const source = rustValueCarrierBeforeContextualConversion(context.input.program.records, callee);
    const physical = source === undefined ? undefined : rustNativeCallableOperand(source, callee, {
      records: context.input.program.records, storage: context.input.program.callableValues.nativeStorage,
      producers: context.input.program.callableValues.nativeProducers, definitions: context.input.program.typeDefinitions,
    });
    const error = physical === undefined ? undefined : rustTypeFromCarrierInContext(physical.signature.error, context);
    if (error?.kind === "named" && error.path === "core::convert::Infallible" && context.syntheticNames !== undefined) {
      return rustEliminateInfallibleResult(planned, allocateRustSyntheticName(context.syntheticNames, "call_value"),
        allocateRustSyntheticName(context.syntheticNames, "call_error"));
    }
  }
  if (effects.invocation === "infallible") {
    return isRustNeverCarrier(fact.resultCarrier) ? rustBottomExpression(planned) : planned;
  }
  if (genericInvocation !== undefined) {
    const result = planRustGenericCallableErrorPropagation(node, genericInvocation, "invocation", planned, context);
    return result === undefined ? undefined : isRustNeverCarrier(fact.resultCarrier)
      ? rustBottomAfterEffect(result, "fallible never call returned") : result;
  }
  const sourceErrors = context.input.program.records.sourceErrorEffects.get(node);
  if (selectedDeclaration !== undefined && fact.target.form !== "callable" &&
    fact.target.form !== "structural-method" && fact.target.form !== "constructor-value") {
    const edges = sourceErrors?.edges.filter(edge => edge.kind === "invoke" && edge.declaration === selectedDeclaration) ?? [];
    if (edges.length !== 1) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.source-call-error-correspondence", "The selected source call has no unique exact invocation error edge."));
      return undefined;
    }
    const result = planRustSourceErrorPropagation(node, edges[0]!, planned, context);
    return result === undefined ? undefined : isRustNeverCarrier(fact.resultCarrier)
      ? rustBottomAfterEffect(result, "fallible never call returned") : result;
  }
  const resultErrorType = rustActiveErrorType(context);
  const operandBoundary = rustCallableProtocol(callableCarrier) !== undefined || callableCarrier?.kind === "closure"
      ? rustCurrentErrorBoundary(context)
    : selected.sourceDeclaration === undefined
      ? undefined
      : rustErrorBoundaryForProjectMember(selected.sourceDeclaration, context);
  if (resultErrorType === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.call",
      "Fallible calls require a fallible lowering context (a throwing function or a try block).",
    ));
    return undefined;
  }
  if (operandBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-error-boundary",
      "Fallible source call has no exact selected declaration error boundary.",
    ));
    return undefined;
  }
  const propagated = rustPropagateLocalError(context.fallibleBoundary!, rustErrorType(operandBoundary), planned);
  if (propagated === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.source-call-error-channel", "A source call requires its exact local error channel in the active region."));
    return undefined;
  }
  return isRustNeverCarrier(fact.resultCarrier)
    ? rustBottomAfterEffect(propagated, "fallible never call returned")
    : propagated;
}
