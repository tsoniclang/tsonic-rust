import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import {
  KindIdentifier,
  Node_Name,
  Node_Type,
} from "../../common/source-ast.js";
import { isRustUnitCarrier } from "../../source/rust-target-types.js";
import type { RustBlock, RustExpr, RustFunctionParam, RustItem, RustStmt, RustTypeParameter } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planBlockLike } from "./statements.js";
import { diagnosticInput, isValidRustIdentifier, rustSourceName, rustPublicName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustGeneratorFactKey, rustMutatedBindingFactKey, rustSourceParameterAbiFactKey } from "../../source/rust-facts/keys.js";
import { rustLocationStorageForDeclaration } from "./typed-locations.js";
import {
  applyRustGenericRequirements,
  createRustGenericRequirementSet,
  requireRustCarrierRequirements,
  requireRustLocationValueCarrier,
} from "./generic-requirements.js";
import {
  publishRustSourceCallableContract,
} from "./source-callable-contracts.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "./synthetic-names.js";

export function planFunctionDeclaration(node: Node, outerContext: RustPlanContext): RustItem | undefined {
  const { ast } = outerContext.input;
  const isAsync = ast.hasModifierKind(node, "async");
  const generatorFact = outerContext.input.facts.getFact(node, rustGeneratorFactKey);
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
  const params: RustFunctionParam[] = [];
  const locationParameterStatements: RustStmt[] = [];
  let paramsFailed = false;
  for (const parameter of ast.parameters(node)) {
    if (parameter === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.parameter",
        "Function declaration contains an undefined parameter slot.",
      ));
      paramsFailed = true;
      continue;
    }
    const parameterName = rustSourceName(context, ast.text(ast.name(parameter) ?? parameter));
    const parameterCarrier = context.input.facts.getFact(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier;
    const parameterType = rustTypeFromCarrierInContext(parameterCarrier, context);
    if (!isValidRustIdentifier(parameterName) || parameterType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "rust.backend.parameter",
        `Parameter '${parameterName}' has no supported Rust carrier fact.`,
      ));
      paramsFailed = true;
      continue;
    }
    if (generatorFact !== undefined && parameterCarrier !== undefined &&
      !requireRustCarrierRequirements(parameterCarrier, ["static"], parameter, context)) {
      paramsFailed = true;
      continue;
    }
    const locationStorage = rustLocationStorageForDeclaration(parameter, context);
    if (locationStorage !== undefined &&
      (parameterCarrier === undefined ||
        !rustTargetTypeRefEquals(parameterCarrier, locationStorage.valueCarrier))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "rust.backend.typed-location-parameter-carrier",
        `Promoted parameter '${parameterName}' conflicts with its finalized parameter carrier.`,
      ));
      paramsFailed = true;
      continue;
    }
    params.push({
      name: parameterName,
      type: parameterType,
      mutable: locationStorage === undefined &&
        context.input.facts.getFact(parameter, rustMutatedBindingFactKey) !== undefined,
    });
    if (locationStorage !== undefined) {
      if (!requireRustLocationValueCarrier(
        locationStorage.valueCarrier,
        parameter,
        context,
      )) {
        paramsFailed = true;
        continue;
      }
      context.usedAliases?.add("rt");
      locationParameterStatements.push({
        kind: "let",
        name: parameterName,
        mutable: false,
        init: {
          kind: "call",
          path: "rt::Location::allocate",
          args: [{ kind: "path", path: parameterName }],
        },
      });
    }
  }
  const returnTypeNode = Node_Type(ast, node);
  if (returnTypeNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      "Functions require an explicit return type annotation.",
    ));
    return undefined;
  }
  const returnCarrier = generatorFact?.carrier ?? asyncFact?.outputCarrier ?? context.input.facts.getRuntimeCarrierFact(returnTypeNode)?.carrier;
  const isUnit = isRustUnitCarrier(returnCarrier);
  const returnType = isUnit ? undefined : rustTypeFromCarrierInContext(returnCarrier, context);
  if (!isUnit && returnType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode),
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
  const fallible = context.input.facts.getFact(node, rustFallibleFactKey) !== undefined;
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
  const syntheticNames = createRustSyntheticNameState(ast, bodyNode, params.map((param) => param.name));
  const generatorControllerName = generatorFact === undefined
    ? undefined
    : allocateRustSyntheticName(syntheticNames, "generator");
  const bodyContext: RustPlanContext = {
    ...context,
    emittedLocalNames: new Set(params.map((param) => param.name)),
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: returnType ?? { kind: "unit" },
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
    ...(fallible ? { fallibleContext: true } : {}),
  };
  const plannedBody = planBlockLike(bodyNode, bodyContext);
  if (paramsFailed || plannedBody === undefined) {
    return undefined;
  }
  const body: RustBlock = {
    statements: [...locationParameterStatements, ...plannedBody.statements],
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
      pub: isExported,
      ...(nonSnakeSeen.value ? { attrs: ["#[allow(non_snake_case)]"] } : {}),
      ...(finalizedTypeParams.length === 0 ? {} : { typeParams: finalizedTypeParams }),
      params,
      ...(returnType === undefined ? {} : { returnType }),
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "call",
            path: generatorFact.kind === "sync" ? "rt::Generator::new" : "rt::AsyncGenerator::new",
            args: [{
              kind: "closure-block",
              params: [{ name: generatorControllerName!, mutable: false }],
              move: true,
              async: true,
              body: applyRustTailShape(body, !isRustUnitCarrier(generatorFact.returnType)),
            }],
          },
        }],
      },
    };
    return publishRustSourceCallableContract(node, item, context) ? item : undefined;
  }
  if (returnType !== undefined && !rustBlockTerminates(body)) {
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
    pub: isExported,
    ...(nonSnakeSeen.value ? { attrs: ["#[allow(non_snake_case)]"] } : {}),
    ...(isAsync ? { isAsync: true } : {}),
    ...(fallible ? { fallible: true } : {}),
    ...(finalizedTypeParams.length === 0
      ? {}
      : { typeParams: finalizedTypeParams }),
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: applyFallibleShape(applyRustTailShape(body, returnType !== undefined), fallible, returnType !== undefined),
  };
  return publishRustSourceCallableContract(node, item, context)
    ? item
    : undefined;
}

// Fallible lowering: returns wrap Ok, tails wrap Ok, and unit bodies end
// with Ok(()).
export function applyFallibleShape(body: RustBlock, fallible: boolean, hasReturnValue: boolean): RustBlock {
  if (!fallible) {
    return body;
  }
  const resultExpression = (expression: RustExpr): RustExpr => expression.kind === "try"
    ? expression.expr
    : { kind: "call", path: "Ok", args: [expression] };
  const wrap = (statement: RustStmt): RustStmt => {
    if (statement.kind === "return" && statement.expr !== undefined) {
      return { kind: "return", expr: resultExpression(statement.expr) };
    }
    if (statement.kind === "return") {
      return { kind: "return", expr: { kind: "path", path: "Ok(())" } };
    }
    if (statement.kind === "tail") {
      return { kind: "tail", expr: resultExpression(statement.expr) };
    }
    if (statement.kind === "if") {
      return {
        ...statement,
        then: { statements: statement.then.statements.map(wrap) },
        ...(statement.else === undefined ? {} : { else: { statements: statement.else.statements.map(wrap) } }),
      };
    }
    if (statement.kind === "while" || statement.kind === "for" ||
      statement.kind === "while-let-some" || statement.kind === "if-let-some") {
      return { ...statement, body: { statements: statement.body.statements.map(wrap) } };
    }
    if (statement.kind === "scope") {
      return { ...statement, body: { statements: statement.body.statements.map(wrap) } };
    }
    if (statement.kind === "try-catch") {
      // The try body is its own Result closure; catch bodies run in the
      // enclosing fallible function.
      return { ...statement, catchBody: { statements: statement.catchBody.statements.map(wrap) } };
    }
    return statement;
  };
  const wrapped = body.statements.map(wrap);
  const last = wrapped[wrapped.length - 1];
  const endsWithExit = last !== undefined && (
    last.kind === "tail" ||
    last.kind === "return" ||
    last.kind === "throw" ||
    (last.kind === "resource-scope" && last.terminates)
  );
  if (!hasReturnValue && !endsWithExit) {
    wrapped.push({ kind: "tail", expr: { kind: "path", path: "Ok(())" } });
  }
  return { statements: wrapped };
}

export function rustBlockTerminates(block: RustBlock): boolean {
  const last = block.statements[block.statements.length - 1];
  if (last === undefined) {
    return false;
  }
  if (last.kind === "return" || last.kind === "tail" || last.kind === "throw") {
    return true;
  }
  if (last.kind === "scope") {
    return rustBlockTerminates(last.body);
  }
  if (last.kind === "resource-scope") {
    return last.terminates;
  }
  return last.kind === "if" && last.else !== undefined &&
    rustBlockTerminates(last.then) && rustBlockTerminates(last.else);
}

export function applyRustTailShape(body: RustBlock, hasReturnValue: boolean): RustBlock {
  if (body.statements.length === 0) {
    return body;
  }
  const lastIndex = body.statements.length - 1;
  const last = body.statements[lastIndex];
  if (last === undefined) {
    return body;
  }
  let tail = last;
  if (hasReturnValue && last.kind === "return" && last.expr !== undefined) {
    tail = { kind: "tail", expr: last.expr };
  } else if (last.kind === "throw") {
    tail = { ...last, tail: true };
  } else if (last.kind === "scope") {
    tail = { ...last, body: applyRustTailShape(last.body, hasReturnValue) };
  } else if (last.kind === "if" && last.else !== undefined &&
    rustBlockTerminates(last.then) && rustBlockTerminates(last.else)) {
    tail = {
      ...last,
      then: applyRustTailShape(last.then, hasReturnValue),
      else: applyRustTailShape(last.else, hasReturnValue),
    };
  }
  return tail === last
    ? body
    : { statements: [...body.statements.slice(0, lastIndex), tail] };
}
