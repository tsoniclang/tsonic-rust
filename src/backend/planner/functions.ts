import type { Node } from "@tsonic/tsts";
import {
  KindIdentifier,
  Node_Name,
  Node_Type,
} from "../../common/source-ast.js";
import { isRustNeverCarrier, isRustUnitCarrier } from "../../source/rust-target-types.js";
import type { RustBlock, RustItem, RustTypeParameter } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planBlockLike } from "./statements.js";
import { diagnosticInput, isValidRustIdentifier, rustPublicName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustReturnTypeFromCarrierInContext } from "./render-types.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustGeneratorFactKey, rustSourceCallableReturnFactKey } from "../../source/rust-facts/keys.js";
import {
  applyRustGenericRequirements,
  createRustGenericRequirementSet,
  requireRustCarrierRequirements,
} from "./generic-requirements.js";
import {
  publishRustSourceCallableContract,
} from "./source-callable-contracts.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "./synthetic-names.js";
import { applyRustTailShape, rustBlockTerminates } from "./block-flow.js";
import { planExpression } from "./expressions.js";
import {
  planRustCallableParameterPrelude,
  planRustCallableParameters,
} from "./callable-parameters.js";
import { resolveRustCallableBodyReturnType } from "./callable-body-return.js";
import { rustDeclarationRequiresUnsafe } from "./explicit-safety.js";
import { rustSafetyAttributesForDeclaration } from "./explicit-safety.js";
import { applyFallibleShape } from "./fallible-shape.js";

export { applyRustTailShape, rustBlockTerminates } from "./block-flow.js";

export function planFunctionDeclaration(node: Node, outerContext: RustPlanContext): RustItem | undefined {
  const { ast } = outerContext.input;
  const isAsync = ast.hasModifierKind(node, "async");
  const generatorFact = outerContext.input.facts.getFact(node, rustGeneratorFactKey);
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
  const asyncFact = outerContext.input.facts.getFact(node, rustAsyncFunctionFactKey);
  if (isAsync && generatorFact === undefined && asyncFact === undefined) {
    outerContext.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(outerContext, node),
      "rust.backend.async",
      "Async functions require a finalized Promise return carrier fact.",
    ));
    return undefined;
  }
  const nameNode = Node_Name(ast, node);
  const sourceName = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  const isExported = ast.hasModifierKind(node, "export");
  // Naming policy: user-authored names are preserved verbatim; items with
  // non-snake identifiers carry a scoped lint allowance.
  const publicName = rustPublicName(sourceName);
  const name = publicName.name;
  const nonSnakeSeen = { value: publicName.needsAllow };
  let context: RustPlanContext = { ...outerContext, nonSnakeSeen };
  if (!isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      `Function name '${name}' is not a valid Rust identifier.`,
    ));
    return undefined;
  }
  const typeParams: RustTypeParameter[] = [];
  for (const typeParameter of ast.typeParameters(node)) {
    if (typeParameter === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.type-parameter",
        "Function declaration contains an undefined type-parameter slot.",
      ));
      return undefined;
    }
    const typeParameterName = ast.text(ast.name(typeParameter) ?? typeParameter);
    if (!isValidRustIdentifier(typeParameterName)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, typeParameter),
        "rust.backend.generics",
        "Type parameter names must be valid Rust identifiers.",
      ));
      return undefined;
    }
    typeParams.push({ name: typeParameterName, bounds: [] });
  }
  const genericRequirements = createRustGenericRequirementSet(
    typeParams.map((parameter) => parameter.name),
  );
  context = { ...context, genericRequirements };
  const syntheticNames = createRustSyntheticNameState(ast, node, []);
  const parameterPlan = planRustCallableParameters(node, context, syntheticNames, {
    requireStatic: generatorFact !== undefined,
  });
  if (parameterPlan === undefined) {
    return undefined;
  }
  const params = parameterPlan.params;
  const returnTypeNode = Node_Type(ast, node);
  const returnCarrier = generatorFact?.carrier ?? asyncFact?.outputCarrier ??
    context.input.facts.getFact(node, rustSourceCallableReturnFactKey)?.returnCarrier;
  const fallible = context.input.facts.getFact(node, rustFallibleFactKey) !== undefined;
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
  if (generatorFact !== undefined && ![
    generatorFact.yieldType,
    generatorFact.returnType,
    generatorFact.nextType,
  ].every((carrier) =>
    requireRustCarrierRequirements(carrier, ["static"], node, context))) {
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
    ...(fallible || generatorFact !== undefined ? { fallibleContext: true } : {}),
  };
  const parameterStatements = planRustCallableParameterPrelude(
    parameterPlan,
    bodyContext,
    planExpression,
  );
  if (parameterStatements === undefined) {
    return undefined;
  }
  const plannedBody = planBlockLike(bodyNode, bodyContext);
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
    context.usedAliases?.add("rt");
    const finalizedTypeParams = applyRustGenericRequirements(typeParams, genericRequirements);
    const item: Extract<RustItem, { readonly kind: "function" }> = {
      kind: "function",
      name,
      visibility: isExported ? "public" : "crate",
      ...(!nonSnakeSeen.value && safetyAttributes.length === 0
        ? {}
        : {
            attrs: [
              ...(nonSnakeSeen.value ? ["#[allow(non_snake_case)]"] : []),
              ...safetyAttributes,
            ],
          }),
      ...(isUnsafe ? { isUnsafe: true } : {}),
      ...(finalizedTypeParams.length === 0 ? {} : { typeParams: finalizedTypeParams }),
      params,
      ...(returnType === undefined ? {} : { returnType }),
      body: {
        ...(parameterPlan.bodyInnerAttrs.length === 0
          ? {}
          : { innerAttrs: parameterPlan.bodyInnerAttrs }),
        statements: [...parameterStatements, {
          kind: "tail",
          expr: {
            kind: "call",
            path: generatorFact.kind === "sync" ? "rt::Generator::new" : "rt::AsyncGenerator::new",
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
                  errorDomain: context.errorDomain,
                },
              ),
            }],
          },
        }],
      },
    };
    return publishRustSourceCallableContract(node, item, context) ? item : undefined;
  }
  if (!isUnit && !rustBlockTerminates(body)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, bodyNode),
      "rust.backend.return-flow",
      "Value-returning functions require finalized control flow that returns or throws on every path.",
    ));
    return undefined;
  }
  const finalizedTypeParams = applyRustGenericRequirements(
    typeParams,
    genericRequirements,
  );
  const item: Extract<RustItem, { readonly kind: "function" }> = {
    kind: "function",
    name,
    visibility: isExported ? "public" : "crate",
    ...(!nonSnakeSeen.value && safetyAttributes.length === 0
      ? {}
      : {
          attrs: [
            ...(nonSnakeSeen.value ? ["#[allow(non_snake_case)]"] : []),
            ...safetyAttributes,
          ],
        }),
    ...(isAsync ? { isAsync: true } : {}),
    ...(isUnsafe ? { isUnsafe: true } : {}),
    ...(fallible ? { fallible: true } : {}),
    ...(finalizedTypeParams.length === 0
      ? {}
      : { typeParams: finalizedTypeParams }),
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: {
      ...applyFallibleShape(
        applyRustTailShape({ statements: [...parameterStatements, ...body.statements] }, returnType !== undefined),
        {
          fallible,
          hasReturnValue: returnType !== undefined,
          errorDomain: context.errorDomain,
        },
      ),
      ...(parameterPlan.bodyInnerAttrs.length === 0
        ? {}
        : { innerAttrs: parameterPlan.bodyInnerAttrs }),
    },
  };
  return publishRustSourceCallableContract(node, item, context)
    ? item
    : undefined;
}
