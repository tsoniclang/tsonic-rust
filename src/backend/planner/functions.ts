import type { Node } from "@tsonic/tsts";
import {
  KindIdentifier,
  Node_Name,
  Node_Type,
} from "../../common/source-ast.js";
import { isRustUnitCarrier } from "../../source/rust-target-types.js";
import type { RustBlock, RustFunctionParam, RustItem, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planBlockLike } from "./statements.js";
import { diagnosticInput, isValidRustIdentifier, rustSourceName, rustPublicName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustMutatedBindingFactKey, rustSourceParameterAbiFactKey } from "../../source/rust-facts/keys.js";

export function planFunctionDeclaration(node: Node, outerContext: RustPlanContext): RustItem | undefined {
  const { ast } = outerContext.input;
  const isAsync = ast.hasModifierKind(node, "async");
  const asyncFact = outerContext.input.facts.getFact(node, rustAsyncFunctionFactKey);
  if (isAsync && asyncFact === undefined) {
    outerContext.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(outerContext, node),
      "rust.backend.async",
      "Async functions require a finalized Promise return carrier fact.",
    ));
    return undefined;
  }
  const nameNode = Node_Name(node);
  const sourceName = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  const isExported = ast.hasModifierKind(node, "export");
  // Naming policy: user-authored names are preserved verbatim; items with
  // non-snake identifiers carry a scoped lint allowance.
  const publicName = rustPublicName(sourceName);
  const name = publicName.name;
  const nonSnakeSeen = { value: publicName.needsAllow };
  const context: RustPlanContext = { ...outerContext, nonSnakeSeen };
  if (!isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      `Function name '${name}' is not a valid Rust identifier.`,
    ));
    return undefined;
  }
  const params: RustFunctionParam[] = [];
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
    params.push({
      name: parameterName,
      type: parameterType,
      mutable: context.input.facts.getFact(parameter, rustMutatedBindingFactKey) !== undefined,
    });
  }
  const returnTypeNode = Node_Type(node);
  if (returnTypeNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      "Functions require an explicit return type annotation.",
    ));
    return undefined;
  }
  const returnCarrier = asyncFact?.outputCarrier ?? context.input.facts.getRuntimeCarrierFact(returnTypeNode)?.carrier;
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
  if (fallible) {
    context.usedAliases?.add("rt");
  }
  const bodyContext: RustPlanContext = {
    ...context,
    emittedLocalNames: new Set(params.map((param) => param.name)),
    ...(fallible ? { fallibleContext: true } : {}),
  };
  const body = planBlockLike(bodyNode, bodyContext);
  if (paramsFailed || body === undefined) {
    return undefined;
  }
  if (returnType !== undefined && !rustBlockTerminates(body)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, bodyNode),
      "rust.backend.return-flow",
      "Value-returning functions require finalized control flow that returns or throws on every path.",
    ));
    return undefined;
  }
  const typeParams: string[] = [];
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
    typeParams.push(typeParameterName);
  }
  return {
    kind: "function",
    name,
    pub: isExported,
    ...(nonSnakeSeen.value ? { attrs: ["#[allow(non_snake_case)]"] } : {}),
    ...(isAsync ? { isAsync: true } : {}),
    ...(fallible ? { fallible: true } : {}),
    ...(typeParams.length === 0 ? {} : { typeParams }),
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: applyFallibleShape(applyTailReturn(body, returnType !== undefined), fallible, returnType !== undefined),
  };
}

// Fallible lowering: returns wrap Ok, tails wrap Ok, and unit bodies end
// with Ok(()).
export function applyFallibleShape(body: RustBlock, fallible: boolean, hasReturnValue: boolean): RustBlock {
  if (!fallible) {
    return body;
  }
  const wrap = (statement: RustStmt): RustStmt => {
    if (statement.kind === "return" && statement.expr !== undefined) {
      return { kind: "return", expr: { kind: "call", path: "Ok", args: [statement.expr] } };
    }
    if (statement.kind === "return") {
      return { kind: "return", expr: { kind: "path", path: "Ok(())" } };
    }
    if (statement.kind === "tail") {
      return { kind: "tail", expr: { kind: "call", path: "Ok", args: [statement.expr] } };
    }
    if (statement.kind === "if") {
      return {
        ...statement,
        then: { statements: statement.then.statements.map(wrap) },
        ...(statement.else === undefined ? {} : { else: { statements: statement.else.statements.map(wrap) } }),
      };
    }
    if (statement.kind === "while" || statement.kind === "for") {
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
  const endsWithExit = last !== undefined && (last.kind === "tail" || last.kind === "return" || last.kind === "throw");
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
  return last.kind === "if" && last.else !== undefined &&
    rustBlockTerminates(last.then) && rustBlockTerminates(last.else);
}

function applyTailReturn(body: RustBlock, hasReturnValue: boolean): RustBlock {
  if (!hasReturnValue || body.statements.length === 0) {
    return body;
  }
  const last = body.statements[body.statements.length - 1];
  if (last === undefined || last.kind !== "return" || last.expr === undefined) {
    return body;
  }
  const tail: RustStmt = { kind: "tail", expr: last.expr };
  return { statements: [...body.statements.slice(0, -1), tail] };
}
