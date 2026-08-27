import {
  rustAsyncFunctionFactKey,
  rustFallibleFactKey,
  rustGeneratorFactKey,
  rustSelfModeFactKey,
  rustSourceCallableReturnFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyFallibleShape } from "../types/fallible-shape.js";
import { applyRustTailShape, rustBlockTerminates } from "./functions.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustCurrentErrorBoundary,
  rustErrorBoundaryForProjectMember,
  rustErrorType,
} from "../program/plan-context.js";
import { isRustNeverCarrier, isRustUnitCarrier } from "../../../target-model/types/index.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { Node_Type } from "@tsonic/target-api/source";
import { planBlockLike } from "../statements/index.js";
import { planExpression } from "../expressions/index.js";
import { planRustCallableGenerics, rustCallableSpecialization } from "./callable-generics.js";
import { planRustCallableParameterPrelude, planRustCallableParameters } from "./callable-parameters.js";
import { rustSelfParameter } from "./self-parameter.js";
import { projectOwnMethods } from "../objects/polymorphism/model.js";
import { readRustProjectMethodOverride } from "../objects/project-objects.js";
import { resolveRustCallableBodyReturnType } from "./callable-body-return.js";
import { rustDeclarationRequiresUnsafe, rustSafetyAttributesForDeclaration } from "../safety/explicit-safety.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { rustReturnTypeFromCarrierInContext } from "../types/render.js";
import { rustLifetimeToAst } from "../types/lifetime-syntax.js";
import type { Node } from "@tsonic/tsts";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustProjectTypeDefinition } from "../../../analysis/project-types/type-policy.js";
import type { RustType, RustImplFunction, RustStmt } from "../../target-ast/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function planProjectMethod(
  member: Node,
  outerContext: RustPlanContext,
  options?: {
    readonly targetName?: string;
    readonly safetyPlacement?: "getter" | "setter";
    readonly typeArgumentSubstitutions?: ReadonlyMap<string, TargetTypeRef>;
    readonly fallibleBoundary?: import("../program/source-package-errors.js").RustSourcePackageErrorBoundary;
  },
): RustImplFunction | undefined {
  let context = outerContext;
  const { ast } = context.input.program.source;
  const sourceMethodName = options?.targetName ??
    context.input.program.projectTypes.callableTargetName(member);
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
  const methodName = sourceMethodName ?? "";
  if (!isValidRustIdentifier(methodName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.class",
      `Method name '${methodName}' is not a valid Rust identifier.`,
    ));
    return undefined;
  }
  const bodyNode = ast.body(member);
  if (bodyNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.method-body",
      "Method declaration has no concrete source body.",
    ));
    return undefined;
  }
  const genericPlan = planRustCallableGenerics(
    member,
    context,
    options?.typeArgumentSubstitutions,
  );
  if (genericPlan === undefined) {
    return undefined;
  }
  context = genericPlan.context;
  const generatorFact = context.input.program.facts.getFact(member, rustGeneratorFactKey);
  const syntheticNames = context.syntheticNames ?? createRustSyntheticNameState(ast, member, []);
  const parameterPlan = planRustCallableParameters(member, context, syntheticNames, {
    ...(generatorFact !== undefined && generatorFact.storage.kind !== "lifetime"
      ? { requiredStaticParameters: generatorFact.capturedParameters }
      : {}),
  });
  if (parameterPlan === undefined) {
    return undefined;
  }
  const params = parameterPlan.params;
  const returnTypeNode = Node_Type(ast, member);
  const asyncFact = context.input.program.facts.getFact(member, rustAsyncFunctionFactKey);
  const sourceAsync = ast.hasModifierKind(member, "async");
  if (sourceAsync && generatorFact === undefined && asyncFact === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.async-method",
      "Async methods require a finalized Promise or async-generator carrier fact.",
    ));
    return undefined;
  }
  const returnCarrier = generatorFact?.carrier ?? asyncFact?.outputCarrier ??
    context.input.program.facts.getFact(member, rustSourceCallableReturnFactKey)?.returnCarrier;
  if (returnCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode ?? member),
      "rust.backend.class",
      "Method return type has no finalized Rust carrier fact.",
    ));
    return undefined;
  }
  const fallible = context.input.program.facts.getFact(member, rustFallibleFactKey) !== undefined;
  const callableErrorBoundary = fallible
    ? options?.fallibleBoundary ?? rustErrorBoundaryForProjectMember(member, context)
    : undefined;
  const bodyErrorBoundary = callableErrorBoundary ?? (generatorFact === undefined
    ? undefined
    : rustCurrentErrorBoundary(context));
  if ((fallible || generatorFact !== undefined) && bodyErrorBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.method-error-boundary",
      "Method has no exact source-package error boundary.",
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
      diagnosticInput(context, returnTypeNode ?? member),
      "rust.backend.class",
      "Method return type has no supported Rust carrier fact.",
    ));
    return undefined;
  }
  const isStatic = ast.hasModifierKind(member, "static");
  const methodAttributes = [
    ...(isStatic && methodName === "new" ? [rustLintAttributes.newReturningOtherType] : []),
    ...(ast.hasModifierKind(ast.parent(member) ?? member, "export") ? [] : [rustLintAttributes.deadCode]),
    ...(genericPlan.preservesExplicitLifetimes ? [rustLintAttributes.needlessLifetimes] : []),
    ...safetyAttributes,
  ];
  if (generatorFact !== undefined && fallible) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.generator-fallibility",
      "Throwing generator method bodies require a closed Rust generator error protocol.",
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
      diagnosticInput(context, returnTypeNode ?? member),
      "rust.backend.generator-return-carrier",
      "Generator method body return type has no supported Rust carrier fact.",
    ));
    return undefined;
  }
  const bodyContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: bodyReturnType,
    ...(sourceAsync && generatorFact === undefined ? { asyncContext: true } : {}),
    ...(generatorFact === undefined
      ? {}
      : {
          generator: {
            declaration: member,
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
  const body = planBlockLike(bodyNode, bodyContext);
  if (body === undefined) {
    return undefined;
  }
  if (generatorFact === undefined && !isUnit && !rustBlockTerminates(body)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, bodyNode),
      "rust.backend.return-flow",
      "Value-returning methods require finalized control flow that returns or throws on every path.",
    ));
    return undefined;
  }
  const selfMode = isStatic ? undefined : context.input.program.facts.getFact(member, rustSelfModeFactKey);
  if (!isStatic && selfMode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.self-mode",
      "Instance method has no finalized Rust self-passing mode.",
    ));
    return undefined;
  }
  if (generatorFact !== undefined) {
    if (!isRustUnitCarrier(generatorFact.returnType) && !rustBlockTerminates(body)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, bodyNode),
        "rust.backend.generator-return-flow",
        "Value-returning generator methods require finalized control flow that returns on every path.",
      ));
      return undefined;
    }
    context.usedAliases?.add("rt");
    const generatorReturnType = generatorFact.storage.kind === "static"
      ? returnType
      : borrowedGeneratorType(
          returnType,
          generatorFact.kind,
          generatorFact.storage.kind === "receiver"
            ? { kind: "placeholder" }
            : rustLifetimeToAst(generatorFact.storage.lifetime),
        );
    if (generatorReturnType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.instance-generator-carrier",
        "Instance generator method has no lifetime-bound Rust generator return carrier.",
      ));
      return undefined;
    }
    const generics = genericPlan.finalizeGenerics();
    return {
      name: methodName,
      ...(isUnsafe ? { isUnsafe: true } : {}),
      visibility: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected") ? "public" : "private",
      ...(methodAttributes.length === 0 ? {} : { attrs: methodAttributes }),
      ...(isStatic ? {} : { selfParam: rustSelfParameter(selfMode!.mode) }),
      generics,
      params,
      returnType: generatorReturnType,
      body: {
        statements: [...parameterStatements, {
          kind: "tail",
          expr: {
            kind: "call",
            path: generatorFact.kind === "sync"
              ? generatorFact.storage.kind === "static"
                ? "rt::Generator::new"
                : "rt::BorrowedGenerator::new"
              : generatorFact.storage.kind === "static"
                ? "rt::AsyncGenerator::new"
                : "rt::BorrowedAsyncGenerator::new",
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
  }
  const generics = genericPlan.finalizeGenerics();
  const finalizedBody = applyFallibleShape(
    applyRustTailShape({ statements: [...parameterStatements, ...body.statements] }, returnType !== undefined),
    fallible
      ? {
          fallible: true,
          hasReturnValue: returnType !== undefined,
          errorType: rustErrorType(callableErrorBoundary!),
          inferErrorTypeFromReturnType: true,
        }
      : { fallible: false, hasReturnValue: returnType !== undefined },
  );
  const overridePrelude = options?.targetName === undefined && !isStatic
    ? planDirectProjectMethodOverridePrelude(member, params, syntheticNames, context)
    : [];
  if (overridePrelude === undefined) {
    return undefined;
  }
  return {
    name: methodName,
    ...(isUnsafe ? { isUnsafe: true } : {}),
    visibility: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected") ? "public" : "private",
    ...(methodAttributes.length === 0 ? {} : { attrs: methodAttributes }),
    ...(callableErrorBoundary === undefined
      ? {}
      : { errorType: rustErrorType(callableErrorBoundary) }),
    ...(sourceAsync ? { isAsync: true } : {}),
    ...(isStatic ? {} : { selfParam: rustSelfParameter(selfMode!.mode) }),
    generics,
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: {
      statements: [...overridePrelude, ...finalizedBody.statements],
    },
  };
}

function planDirectProjectMethodOverridePrelude(
  member: Node,
  params: readonly import("../../target-ast/nodes.js").RustFunctionParam[],
  syntheticNames: import("../names/synthetic.js").RustSyntheticNameState,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const usage = context.input.program.projectMethodProperties.usageFor(member);
  if (usage?.writable !== true) {
    return [];
  }
  const owner = context.input.program.projectTypes.definitionContainingDeclaration(member);
  const targetName = owner === undefined
    ? undefined
    : context.input.program.projectTypes.fieldStorageName(owner, member);
  const representation = context.input.program.objectRepresentations.representationFor(owner);
  if (owner?.kind !== "class" || targetName === undefined ||
    representation === undefined ||
    context.input.program.facts.getFact(member, rustFallibleFactKey) === undefined ||
    syntheticNames === undefined) {
    return undefined;
  }
  const overrideName = allocateRustSyntheticName(
    syntheticNames,
    "method_override",
  );
  return [{
    kind: "if-let-some",
    binding: overrideName,
    expression: readRustProjectMethodOverride(
      { kind: "path", path: "self" },
      targetName,
      representation,
    ),
    body: {
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
    },
  }];
}

export function planProjectMethodVariants(
  member: Node,
  context: RustPlanContext,
): readonly RustImplFunction[] | undefined {
  const specializations = context.input.program.sourceCallableSpecializations;
  if (!specializations.requiresSpecialization(member)) {
    const method = planProjectMethod(member, context);
    return method === undefined ? undefined : Object.freeze([method]);
  }
  const variants = specializations.variantsForCallable(member);
  if (variants.length === 0) {
    return undefined;
  }
  const methods: RustImplFunction[] = [];
  for (const variant of variants) {
    const specialization = rustCallableSpecialization(
      variant.sourceTypeParameterNames,
      variant.targetTypeArguments,
    );
    if (specialization === undefined) {
      return undefined;
    }
    const method = planProjectMethod(member, context, {
      targetName: variant.targetName,
      typeArgumentSubstitutions: specialization,
    });
    if (method === undefined) {
      return undefined;
    }
    methods.push(method);
  }
  return Object.freeze(methods);
}

export function planProjectStaticMethods(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
): readonly RustImplFunction[] | undefined {
  const methods: RustImplFunction[] = [];
  for (const member of projectOwnMethods(definition, context)) {
    if (!context.input.program.source.ast.hasModifierKind(member, "static")) {
      continue;
    }
    const planned = planProjectMethodVariants(member, context);
    if (planned === undefined) {
      return undefined;
    }
    methods.push(...planned);
  }
  return methods;
}

function borrowedGeneratorType(
  type: RustType | undefined,
  kind: "sync" | "async",
  lifetime: import("../../target-ast/nodes.js").RustLifetime,
): RustType | undefined {
  if (type?.kind !== "named" ||
    type.path !== (kind === "sync" ? "rt::Generator" : "rt::AsyncGenerator")) {
    return undefined;
  }
  return {
    ...type,
    path: kind === "sync" ? "rt::BorrowedGenerator" : "rt::BorrowedAsyncGenerator",
    genericArguments: [
      { kind: "lifetime", lifetime },
      ...(type.genericArguments ?? []),
    ],
  };
}
