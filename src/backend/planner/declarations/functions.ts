import type { Node } from "@tsonic/tsts";
import { Node_Type } from "@tsonic/target-api/source";
import { isRustNeverCarrier, isRustUnitCarrier } from "../../../target-model/types/index.js";
import type { RustBlock, RustItem } from "../../target-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planBlockLike } from "../statements/index.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustCurrentErrorBoundary,
  rustErrorBoundaryForDeclaration,
  rustErrorType,
  rustSourceItemIsPubliclyReachable,
} from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustReturnTypeFromCarrierInContext } from "../types/render.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustGeneratorFactKey, rustSourceCallableReturnFactKey } from "../../../analysis/facts/keys.js";
import {
  planRustCallableGenerics,
} from "./callable-generics.js";
import type {
  RustSourceCallableSpecializationVariant,
} from "../../../analysis/callables/specializations.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";
import { applyRustTailShape, rustBlockTerminates } from "../statements/block-flow.js";
import { planExpression } from "../expressions/index.js";
import {
  planRustCallableParameterPrelude,
  planRustCallableParameters,
} from "./callable-parameters.js";
import { resolveRustCallableBodyReturnType } from "./callable-body-return.js";
import { rustDeclarationRequiresUnsafe } from "../safety/explicit-safety.js";
import { rustSafetyAttributesForDeclaration } from "../safety/explicit-safety.js";
import { applyFallibleShape } from "../types/fallible-shape.js";
import { rustExplicitLifetimeContractAttributes, rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { rustExplicitDeclarationContract } from "./explicit-contracts.js";
import { rustGeneratorExecutionCarrier } from "../ownership/execution-carriers.js";

export { applyRustTailShape, rustBlockTerminates } from "../statements/block-flow.js";

export function planFunctionDeclarations(
  node: Node,
  outerContext: RustPlanContext,
): readonly RustItem[] | undefined {
  const explicitContract = rustExplicitDeclarationContract(node, outerContext);
  if (outerContext.input.program.source.ast.body(node) === undefined &&
    explicitContract?.abi !== undefined) {
    const item = planRustExternFunction(node, explicitContract.abi, outerContext);
    return item === undefined ? undefined : Object.freeze([item]);
  }
  const specializations = outerContext.input.program.sourceCallableSpecializations;
  if (!specializations.requiresSpecialization(node)) {
    const item = planRustFunctionItem({
      callableDeclaration: node,
      nameDeclaration: node,
      name: outerContext.input.program.names.functionNameForDeclaration(node),
      exported: outerContext.input.program.source.ast.hasModifierKind(node, "export"),
    }, outerContext);
    return item === undefined ? undefined : Object.freeze([item]);
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
    items.push(item);
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
  }, outerContext);
}

function planRustExternFunction(
  node: Node,
  abi: import("../../../target-model/semantics/index.js").RustAbi,
  context: RustPlanContext,
): RustItem | undefined {
  const { ast } = context.input.program.source;
  const contract = rustExplicitDeclarationContract(node, context);
  const name = context.input.program.names.functionNameForDeclaration(node) ?? "";
  if (!isValidRustIdentifier(name) || abi === "Rust" || ast.hasModifierKind(node, "async") ||
    context.input.program.facts.getFact(node, rustGeneratorFactKey) !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.extern-declaration",
      "A bodyless Rust extern declaration requires a valid name, a non-Rust ABI, and a synchronous non-generator signature.",
    ));
    return undefined;
  }
  const genericPlan = planRustCallableGenerics(node, context);
  if (genericPlan === undefined) return undefined;
  const generics = genericPlan.finalizeGenerics();
  if (generics.parameters.length !== 0 || generics.wherePredicates.length !== 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.extern-generics",
      "Foreign Rust declarations cannot carry source generic parameters or where predicates.",
    ));
    return undefined;
  }
  const syntheticNames = createRustSyntheticNameState(ast, node, []);
  const parameterPlan = planRustCallableParameters(node, genericPlan.context, syntheticNames);
  if (parameterPlan === undefined || parameterPlan.prelude.length !== 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.extern-parameter-abi",
      "Foreign Rust declarations require direct parameters with no generated source-ABI prelude.",
    ));
    return undefined;
  }
  const returnCarrier = context.input.program.facts.getFact(
    node,
    rustSourceCallableReturnFactKey,
  )?.returnCarrier;
  const returnType = isRustUnitCarrier(returnCarrier)
    ? undefined
    : rustReturnTypeFromCarrierInContext(returnCarrier, context);
  if (!isRustUnitCarrier(returnCarrier) && returnType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, Node_Type(ast, node) ?? node),
      "rust.backend.extern-return-carrier",
      "Foreign Rust declaration has no exact renderable return carrier.",
    ));
    return undefined;
  }
  const requiresUnsafe = rustDeclarationRequiresUnsafe(node, "declaration", context.input);
  const edition = context.input.program.configuration.dialect.edition;
  if (edition === "2021" && !requiresUnsafe) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.extern-safe-item-dialect",
      "Rust 2021 cannot express an independently safe foreign item; select requiresUnsafe or Rust 2024.",
    ));
    return undefined;
  }
  const attrs = rustSafetyAttributesForDeclaration(node, requiresUnsafe, context.input);
  return {
    kind: "extern-block",
    ...(attrs.length === 0 ? {} : { attrs }),
    abi,
    safety: edition === "2024" ? "unsafe" : "safe",
    functions: [{
      name,
      visibility: ast.hasModifierKind(node, "export") ? "public" : "crate",
      safety: edition === "2024"
        ? requiresUnsafe ? "unsafe" : "safe"
        : "inherited",
      generics,
      params: parameterPlan.params,
      ...(returnType === undefined ? {} : { returnType }),
      ...(contract?.variadic === true ? { variadic: true } : {}),
    }],
    statics: [],
  };
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
): RustItem | undefined {
  const node = source.callableDeclaration;
  const { ast } = outerContext.input.program.source;
  const explicitContract = rustExplicitDeclarationContract(
    source.nameDeclaration,
    outerContext,
  );
  const isAsync = ast.hasModifierKind(node, "async");
  const generatorFact = outerContext.input.program.facts.getFact(node, rustGeneratorFactKey);
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
  const asyncFact = outerContext.input.program.facts.getFact(node, rustAsyncFunctionFactKey);
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
  const declarationAttributes = [
    ...(rustSourceItemIsPubliclyReachable(outerContext, name)
      ? []
      : [rustLintAttributes.deadCode]),
    ...safetyAttributes,
  ];
  let context: RustPlanContext = outerContext;
  if (!isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      `Function name '${name}' is not a valid Rust identifier.`,
    ));
    return undefined;
  }
  const specialization = source.specialization?.specialization;
  const genericPlan = planRustCallableGenerics(node, context, specialization);
  if (genericPlan === undefined) {
    return undefined;
  }
  context = genericPlan.context;
  const syntheticNames = createRustSyntheticNameState(ast, node, []);
  const parameterPlan = planRustCallableParameters(node, context, syntheticNames);
  if (parameterPlan === undefined) {
    return undefined;
  }
  const params = parameterPlan.params;
  const returnTypeNode = Node_Type(ast, node);
  const returnCarrier = generatorFact?.carrier ?? asyncFact?.outputCarrier ??
    context.input.program.facts.getFact(node, rustSourceCallableReturnFactKey)?.returnCarrier;
  const fallible = context.input.program.facts.getFact(node, rustFallibleFactKey) !== undefined;
  const callableErrorBoundary = fallible
    ? rustErrorBoundaryForDeclaration(node, context)
    : undefined;
  const bodyErrorBoundary = callableErrorBoundary ?? (generatorFact === undefined
    ? undefined
    : rustCurrentErrorBoundary(context));
  if ((fallible || generatorFact !== undefined) && bodyErrorBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function-error-boundary",
      "Function has no exact source-package error boundary.",
    ));
    return undefined;
  }
  const isUnit = isRustUnitCarrier(returnCarrier);
  const isNever = isRustNeverCarrier(returnCarrier);
  const returnType = isUnit || fallible && isNever
    ? undefined
    : rustReturnTypeFromCarrierInContext(returnCarrier, context);
  if (!isUnit && !(fallible && isNever) && returnType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode ?? node),
      "rust.backend.function",
      "Function return type has no supported Rust carrier fact.",
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
    ...(bodyErrorBoundary === undefined ? {} : { fallibleBoundary: bodyErrorBoundary }),
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
        const expression = planExpression(bodyNode, bodyContext);
        return expression === undefined
          ? undefined
          : { statements: [{ kind: "tail" as const, expr: expression }] };
      })();
  if (plannedBody === undefined) {
    return undefined;
  }
  const body: RustBlock = {
    statements: plannedBody.statements,
  };
  if (generatorFact !== undefined) {
    if (!isRustUnitCarrier(generatorFact.returnType) && !rustBlockTerminates(body)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, bodyNode),
        "rust.backend.generator-return-flow",
        "Value-returning generators require finalized control flow that returns on every path.",
      ));
      return undefined;
    }
    const executionCarrier = rustGeneratorExecutionCarrier(
      node,
      generatorFact.kind,
      context,
    );
    if (executionCarrier === undefined) return undefined;
    context.usedAliases?.add("rt");
    const generics = genericPlan.finalizeGenerics();
    const itemAttributes = [
      ...declarationAttributes,
      ...rustExplicitLifetimeContractAttributes(generics),
    ];
    const item: Extract<RustItem, { readonly kind: "function" }> = {
      kind: "function",
      name,
      visibility: isExported || rustSourceItemIsPubliclyReachable(outerContext, name)
        ? "public"
        : "crate",
      ...(itemAttributes.length === 0
        ? {}
        : { attrs: itemAttributes }),
      ...(isUnsafe ? { isUnsafe: true } : {}),
      ...(explicitContract?.abi === undefined ? {} : { abi: explicitContract.abi }),
      ...(explicitContract?.variadic === true ? { variadic: true } : {}),
      generics,
      params,
      returnType: executionCarrier.returnType,
      body: {
        statements: [...parameterStatements, {
          kind: "tail",
          expr: {
            kind: "call",
            path: executionCarrier.constructorPath,
            args: [{
              kind: "closure-block",
              params: [{ name: generatorControllerName!, mutable: false }],
              move: true,
              async: true,
              body: applyFallibleShape(
                applyRustTailShape(body, !isRustUnitCarrier(generatorFact.returnType)),
                {
                  fallible: true,
                  hasReturnValue: !isRustUnitCarrier(generatorFact.returnType),
                  errorType: rustErrorType(bodyErrorBoundary!),
                  inferErrorTypeFromReturnType: false,
                },
              ),
            }],
          },
        }],
      },
    };
    return item;
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
  const itemAttributes = [
    ...declarationAttributes,
    ...rustExplicitLifetimeContractAttributes(generics),
  ];
  const item: Extract<RustItem, { readonly kind: "function" }> = {
    kind: "function",
    name,
    visibility: isExported || rustSourceItemIsPubliclyReachable(outerContext, name)
      ? "public"
      : "crate",
    ...(itemAttributes.length === 0
      ? {}
      : { attrs: itemAttributes }),
    ...(isAsync ? { isAsync: true } : {}),
    ...(isUnsafe ? { isUnsafe: true } : {}),
    ...(explicitContract?.abi === undefined ? {} : { abi: explicitContract.abi }),
    ...(explicitContract?.variadic === true ? { variadic: true } : {}),
    ...(callableErrorBoundary === undefined
      ? {}
      : { errorType: rustErrorType(callableErrorBoundary) }),
    generics,
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: {
      ...applyFallibleShape(
        applyRustTailShape({ statements: [...parameterStatements, ...body.statements] }, returnType !== undefined),
        fallible
          ? {
              fallible: true,
              hasReturnValue: returnType !== undefined,
              errorType: rustErrorType(callableErrorBoundary!),
              inferErrorTypeFromReturnType: true,
            }
          : { fallible: false, hasReturnValue: returnType !== undefined },
      ),
    },
  };
  return item;
}
