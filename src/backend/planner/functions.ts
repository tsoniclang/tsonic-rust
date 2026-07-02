import type { AstReader, Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  KindAsteriskEqualsToken,
  KindBinaryExpression,
  KindEqualsToken,
  KindMinusEqualsToken,
  KindPercentEqualsToken,
  KindPlusEqualsToken,
  KindSlashEqualsToken,
  KindIdentifier,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  Node_Expression,
  Node_Name,
  Node_Type,
  PrefixUnaryExpression_Operand,
  getPostfixUnaryOperatorText,
  getPrefixUnaryOperatorText,
} from "../../common/source-ast.js";
import { isRustUnitCarrier } from "../../source/rust-target-types.js";
import type { RustBlock, RustFunctionParam, RustItem, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planBlockLike } from "./statements.js";
import { diagnosticInput, isValidRustIdentifier, rustValueName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { rustTargetOperationFactKey } from "../../source/rust-facts/keys.js";

export function planFunctionDeclaration(node: Node, context: RustPlanContext): RustItem | undefined {
  const { ast } = context.input;
  if (ast.hasModifierKind(node, "async")) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      "Async functions are not supported by the Rust target.",
    ));
    return undefined;
  }
  const nameNode = Node_Name(node);
  const sourceName = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  const name = rustValueName(sourceName);
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
    const parameterName = rustValueName(ast.text(ast.name(parameter) ?? parameter));
    const parameterCarrier = context.input.facts.getRuntimeCarrierFact(parameter)?.carrier;
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
  const bodyContext: RustPlanContext = {
    ...context,
    mutatedNames: collectMutatedNames(ast, bodyNode, context),
    emittedLocalNames: new Set(params.map((param) => param.name)),
  };
  const body = planBlockLike(bodyNode, bodyContext);
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

// Name-level write analysis over a function body: a binding becomes `let mut`
// only when an assignment or increment/decrement to that name is proven.
export function collectMutatedNames(ast: AstReader, body: Node, context?: RustPlanContext): ReadonlySet<string> {
  const mutated = new Set<string>();
  const addWriteTarget = (target: Node | undefined): void => {
    if (target === undefined) {
      return;
    }
    const targetKind = ast.kindName(target);
    if (targetKind === KindIdentifier) {
      mutated.add(ast.text(target));
      return;
    }
    if (targetKind === "KindPropertyAccessExpression" || targetKind === "KindElementAccessExpression") {
      addWriteTarget(Node_Expression(target));
      return;
    }
    if (targetKind === "KindCallExpression" && context !== undefined) {
      // Flow-marker wrappers (borrowMut/move) erase to their argument.
      const fact = context.input.facts.getFact(target, rustTargetOperationFactKey);
      if (fact !== undefined && fact.kind === "flow-marker") {
        const [argument] = ast.arguments(target);
        addWriteTarget(argument);
      }
    }
  };
  const visit = (node: Node): void => {
    const kind = ast.kindName(node);
    if (kind === "KindCallExpression" && context !== undefined) {
      const fact = context.input.facts.getFact(node, rustTargetOperationFactKey);
      if (fact !== undefined && fact.kind === "provider-operation" && (fact.target.form === "call" || fact.target.form === "free-call")) {
        const modes = fact.target.form === "call" ? fact.target.argModes : fact.target.argModes;
        const argumentNodes = ast.arguments(node);
        for (const [index, argument] of argumentNodes.entries()) {
          if ((modes?.[index] ?? "value") === "mut-ref") {
            addWriteTarget(argument);
          }
        }
      }
      if (fact !== undefined && fact.kind === "provider-operation" && fact.target.form === "receiver-method" && fact.target.mutatesReceiver === true) {
        addWriteTarget(Node_Expression(Node_Expression(node)));
      }
      if (fact !== undefined && fact.kind === "source-method" && fact.mutatesSelf) {
        addWriteTarget(Node_Expression(Node_Expression(node)));
      }
      if (fact === undefined) {
        // Source-owned calls: arguments feeding &mut slice parameters are
        // mutable borrows at the call site.
        const callee = Node_Expression(node);
        const reference = callee === undefined
          ? undefined
          : context.input.analysis.getProjectSourceReferenceForNode(callee, { sourceFile: context.sourceFile });
        if (reference !== undefined) {
          const parameters = ast.parameters(reference.declaration);
          const argumentNodes = ast.arguments(node);
          for (const [index, argument] of argumentNodes.entries()) {
            const parameter = parameters[index];
            const parameterCarrier = parameter === undefined
              ? undefined
              : context.input.facts.getRuntimeCarrierFact(parameter)?.carrier;
            if (parameterCarrier?.kind === "pointer" && parameterCarrier.mutability === "mut") {
              addWriteTarget(argument);
            }
          }
        }
      }
    }
    if (kind === KindBinaryExpression) {
      const operatorToken = BinaryExpression_OperatorToken(node);
      const writeTokens = [
        KindEqualsToken,
        KindPlusEqualsToken,
        KindMinusEqualsToken,
        KindAsteriskEqualsToken,
        KindSlashEqualsToken,
        KindPercentEqualsToken,
      ];
      if (operatorToken !== undefined && writeTokens.includes(ast.kindName(operatorToken))) {
        addWriteTarget(BinaryExpression_Left(node));
      }
    } else if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
      const operatorText = kind === KindPrefixUnaryExpression
        ? getPrefixUnaryOperatorText(ast, node)
        : getPostfixUnaryOperatorText(ast, node);
      if (operatorText === "++" || operatorText === "--") {
        const operand = PrefixUnaryExpression_Operand(node);
        if (operand !== undefined && ast.kindName(operand) === KindIdentifier) {
          mutated.add(ast.text(operand));
        }
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(body);
  return mutated;
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
