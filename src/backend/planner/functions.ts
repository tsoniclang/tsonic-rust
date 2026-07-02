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
import { diagnosticInput, isValidRustIdentifier } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrier } from "./render-types.js";

export function planFunctionDeclaration(node: Node, context: RustPlanContext): RustItem | undefined {
  const { ast } = context.input;
  if (ast.hasModifierKind(node, "async")) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      "Async functions are not supported by the Rust target yet.",
    ));
    return undefined;
  }
  const nameNode = Node_Name(node);
  const name = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
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
      continue;
    }
    const parameterName = ast.text(ast.name(parameter) ?? parameter);
    const parameterCarrier = context.input.facts.getRuntimeCarrierFact(parameter)?.carrier;
    const parameterType = rustTypeFromCarrier(parameterCarrier);
    if (!isValidRustIdentifier(parameterName) || parameterType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "rust.backend.parameter",
        `Parameter '${parameterName}' has no supported Rust carrier fact.`,
      ));
      paramsFailed = true;
      continue;
    }
    params.push({ name: parameterName, type: parameterType });
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
  const returnCarrier = context.input.facts.getRuntimeCarrierFact(returnTypeNode)?.carrier;
  const isUnit = isRustUnitCarrier(returnCarrier);
  const returnType = isUnit ? undefined : rustTypeFromCarrier(returnCarrier);
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
  const body = planBlockLike(bodyNode, context);
  if (paramsFailed || body === undefined) {
    return undefined;
  }
  return {
    kind: "function",
    name,
    pub: ast.hasModifierKind(node, "export"),
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: applyTailReturn(body, returnType !== undefined),
  };
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
