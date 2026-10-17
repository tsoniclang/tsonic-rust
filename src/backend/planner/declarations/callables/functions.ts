import type { Node } from "@tsonic/tsts";
import { planRustAbsentValue } from "../../expressions/optional-storage.js";
import { Node_Type } from "@tsonic/target-api/source";
import { isRustNeverCarrier, isRustUnitCarrier } from "../../../../target-model/types/index.js";
import type { RustBlock, RustItem } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant, missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import { planBlockLike } from "../../statements/index.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustCurrentErrorBoundary,
  rustSourceItemIsPubliclyReachable,
} from "../../program/plan-context.js";
import { rustAuthoredDeadCodeDisposition } from "../../program/reachability-directives.js";
import type { RustPlanContext } from "../../program/plan-context.js";

import {
  planRustCallableGenerics,
  rustCallableSpecialization,
} from "./generics.js";
import type {
  RustSourceCallableSpecializationVariant,
} from "../../../../analysis/callables/specializations.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../../names/synthetic.js";
import { applyRustTailShape, rustBlockTerminates, retainRustCheckedCompletion } from "../../../target-ast/normalization/block-flow.js";
import { planExpression } from "../../expressions/index.js";
import {
  planRustCallableParameterPrelude,
  planRustCallableParameters,
} from "./parameters.js";
import { resolveRustCallableBodyReturnType, resolveRustCallableOutwardReturnType, resolveRustJsPromiseReturnType } from "./return-types.js";
import { rustDeclarationRequiresUnsafe } from "../../safety/explicit-safety.js";
import { rustSafetyAttributesForDeclaration } from "../../safety/explicit-safety.js";
import { applyFallibleShape } from "../../types/fallible-shape.js";
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
  readonly item: RustItem;
  readonly helper: RustItem | undefined;
}

function planRustFunctionParameters(
  node: Node,
  inputContext: RustPlanContext,
) {
  const { ast } = inputContext.input.program.source;
  const syntheticNames = createRustSyntheticNameState(ast, node, []);
  const environment = planRustLexicalFunctionEnvironment(node, { ...inputContext, syntheticNames });
  if (environment === undefined) return undefined;
  const parameterPlan = planRustCallableParameters(node, environment.context, syntheticNames);
  if (parameterPlan === undefined) return undefined;
  const operation = environment.context.input.program.records.targetOperation.get(node);
  const leading = planRustCallableLeadingParameters(node,
    operation?.kind === "closure" ? operation.leadingParameters ?? [] : [], environment.context);
  if (leading === undefined) return undefined;
  const leadingParams = leading.parameters.map(parameter => {
    const type = rustTypeFromCarrierInContext(parameter.carrier, environment.context);
    return type === undefined ? undefined : { name: parameter.name, type };
  });
  if (leadingParams.some(parameter => parameter === undefined)) return undefined;
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
  const specializations = outerContext.input.program.sourceCallableSpecializations;
  if (!specializations.requiresSpecialization(node)) {
    const item = planRustFunctionItem({
      callableDeclaration: node,
      nameDeclaration: node,
      name: outerContext.input.program.names.functionNameForDeclaration(node),
      exported: outerContext.input.program.source.ast.hasModifierKind(node, "export"),
    }, outerContext);
    return item === undefined ? undefined : Object.freeze(item.helper === undefined ? [item.item] : [item.item, item.helper]);
  }
  const variants = specializations.variantsForCallable(node);
  if (variants.length === 0) {
    return undefined;
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
      return undefined;
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
): RustItem | undefined {
  return planRustFunctionItem({
    callableDeclaration,
    nameDeclaration: declaration,
    name,
    exported,
  }, outerContext)?.item;
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
): RustFunctionItemPlan | undefined {
  const node = source.callableDeclaration;
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
  const nativeBody = outerContext.input.program.promiseBodies.declarations.get(node);
  const nativeBodyName = nativeBody === undefined ? undefined
    : source.specialization === undefined ? nativeBody.name : source.specialization.nativeBodyName;
  if (nativeBody !== undefined && nativeBodyName === undefined) failRustPlannerInvariant(
    "A specialized native Promise body requires its selected physical name.", node);
  if (isAsync && generatorFact === undefined && asyncFact === undefined) {
    outerContext.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(outerContext, node),
      "rust.backend.async",
      "Async functions require a finalized Promise return carrier fact.",
    ));
    return undefined;
  }
  const isExported = source.exported;
  const name = source.name ??
    outerContext.input.program.names.nameForDeclaration(source.nameDeclaration) ?? "";
  const lexical = outerContext.input.program.lexicalFunctions.forDeclaration(node);
  const visibility = lexical !== undefined ? "private" as const : isExported || rustSourceItemIsPubliclyReachable(outerContext, name)
    ? "public" as const
    : "crate" as const;
  const deadCode = rustAuthoredDeadCodeDisposition(
    outerContext,
    source.nameDeclaration,
  );
  const declarationAttributes = [...safetyAttributes];
  let context: RustPlanContext = nativeBody === undefined ? functionContext
    : { ...functionContext, promiseBody: true, promiseBodyName: nativeBodyName! };
  if (!isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      `Function name '${name}' is not a valid Rust identifier.`,
    ));
    return undefined;
  }
  const specialization = source.specialization === undefined
    ? undefined
    : rustCallableSpecialization(
        source.specialization.sourceTypeParameterIdentities,
        source.specialization.targetTypeArguments,
      );
  if (source.specialization !== undefined && specialization === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.callable-specialization",
      "Callable specialization does not match its exact source type-parameter arity.",
    ));
    return undefined;
  }
  if (lexical?.kind === "unresolved") {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.lexical-function-contract", lexical.reason));
    return undefined;
  }
  const genericPlan = planRustCallableGenerics(node, context, specialization, lexical?.genericParameters);
  if (genericPlan === undefined) {
    return undefined;
  }
  context = genericPlan.context;
  if (genericPlan.preservesExplicitLifetimes) {
    declarationAttributes.push(rustLintAttributes.needlessLifetimes);
  }
  const parameters = planRustFunctionParameters(node, context);
  if (parameters === undefined) return undefined;
  const { params, parameterPlan, syntheticNames } = parameters;
  context = parameters.context;
  const returnTypeNode = Node_Type(ast, node);
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
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function-error-boundary",
      "Function has no exact finalized native error region.",
    ));
    return undefined;
  }
  const isUnit = isRustUnitCarrier(returnCarrier);
  const isNever = isRustNeverCarrier(returnCarrier);
  const returnType = isUnit || fallible && isNever
    ? undefined
    : resolveRustCallableOutwardReturnType(node, returnCarrier, context);
  if (!isUnit && !(fallible && isNever) && returnType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode ?? node),
      "rust.backend.function",
      "Function return type has no supported Rust carrier fact.",
    ));
    return undefined;
  }
  const emittedReturnType = returnsJsPromise && nativeBody === undefined
    ? resolveRustJsPromiseReturnType(node, context)
    : returnType;
  if (returnsJsPromise && nativeBody === undefined && emittedReturnType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode ?? node),
      "rust.backend.js-promise-return",
      "JavaScript-surface async functions require one renderable finalized Promise carrier.",
    ));
    return undefined;
  }
  const bodyNode = ast.body(node);
  if (bodyNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      "Functions require a body.",
    ));
    return undefined;
  }
  if (generatorFact !== undefined && fallible) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.generator-fallibility",
      "Throwing generator bodies require a closed Rust generator error protocol.",
    ));
    return undefined;
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
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode ?? node),
      "rust.backend.generator-return-carrier",
      "Generator body return type has no supported Rust carrier fact.",
    ));
    return undefined;
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
  };
  const parameterStatements = planRustCallableParameterPrelude(
    parameterPlan,
    bodyContext,
    planExpression,
  );
  if (parameterStatements === undefined) {
    return undefined;
  }
  const plannedBody = ast.kindName(bodyNode) === "KindBlock"
    ? planBlockLike(bodyNode, bodyContext)
    : (() => {
        const expression = planRustReturnValueExpression(bodyNode, bodyContext, planExpression);
        return expression === undefined
          ? undefined
          : { statements: [{ kind: "tail" as const, expr: expression }] };
      })();
  if (plannedBody === undefined) {
    return undefined;
  }
  const body: RustBlock = retainRustCheckedCompletion({
    statements: [...plannedBody.statements, ...(sourceReturn?.fallthroughUndefined
      ? [planRustReturnExit(planRustAbsentValue(returnCarrier!, bodyContext), bodyContext)] : [])],
  }, !isUnit && generatorFact === undefined ? sourceReturn?.canFallThrough : undefined);
  if (generatorFact !== undefined) {
    if (!isRustUnitCarrier(generatorFact.returnType) && !rustBlockTerminates(body)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, bodyNode),
        "rust.backend.generator-return-flow",
        "Value-returning generators require finalized control flow that returns on every path.",
      ));
      return undefined;
    }
    context.usedAliases?.add("rt");
    if (returnType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.generator-storage-carrier",
        "Generator function has no exact lifetime-bound Rust storage carrier.",
      ));
      return undefined;
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
  if (!isUnit && !rustBlockTerminates(body)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, bodyNode),
      "rust.backend.return-flow",
      "Value-returning functions require finalized control flow that returns or throws on every path.",
    ));
    return undefined;
  }
  const generics = genericPlan.finalizeGenerics();
  const finalizedBody = applyFallibleShape(
    applyRustTailShape({ statements: [...parameterStatements, ...body.statements] }, returnType !== undefined),
    fallible
      ? {
          fallible: true,
          hasReturnValue: returnType !== undefined,
          errorType: callableErrorBoundary!.errorType,
          inferErrorTypeFromReturnType: true,
        }
      : { fallible: false, hasReturnValue: returnType !== undefined },
  );
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
  if (nativeBody === undefined || !context.input.program.promiseBodies.objects.has(node))
    return Object.freeze({ item, helper: undefined });
  const adapterGenerics = planRustCallableGenerics(node, functionContext, specialization, lexical?.genericParameters);
  if (adapterGenerics === undefined) return undefined;
  const adapterParameters = planRustFunctionParameters(node, adapterGenerics.context);
  if (adapterParameters === undefined) return undefined;
  const adapterContext = adapterParameters.context;
  if (asyncFact?.kind !== "js-promise") return undefined;
  const adapterReturn = resolveRustJsPromiseReturnType(node, adapterContext);
  const adapterBody = planRustPromiseBodyObjectAdapter(node, { kind: "call", path: nativeBodyName!,
    genericArguments: rustPromiseBodyGenericArguments(generics),
    args: adapterParameters.params.map(parameter => ({ kind: "path", path: parameter.name })),
  }, callableErrorBoundary, adapterContext);
  if (adapterReturn === undefined || adapterBody === undefined) return undefined;
  const helper: RustItem = { kind: "function", name, visibility,
    ...(deadCode === undefined ? {} : { deadCode }),
    ...(declarationAttributes.length === 0 ? {} : { attrs: declarationAttributes }),
    ...(isUnsafe ? { isUnsafe: true } : {}),
    generics: adapterGenerics.finalizeGenerics(), params: adapterParameters.params,
    returnType: adapterReturn, body: adapterBody };
  return Object.freeze({ item, helper });
}
import { planRustReturnValueExpression } from "../../expressions/value-destinations.js";
