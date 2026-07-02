import type { Node, TargetTypeRef } from "@tsonic/tsts";
import {
  KindBinaryExpression,
  Node_Initializer,
  KindCallExpression,
  KindElementAccessExpression,
  KindFalseKeyword,
  KindIdentifier,
  KindNewExpression,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindStringLiteral,
  KindTrueKeyword,
  BinaryExpression_Left,
  BinaryExpression_Right,
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
  PrefixUnaryExpression_Operand,
} from "../../common/source-ast.js";
import { rustFallibleCallFactKey, rustOptionWrapFactKey, rustSourceTypeCarrierValue, rustTargetOperationFactKey } from "../../source/rust-facts/keys.js";
import type { RustProviderOperationForm, RustTargetOperationFact } from "../../source/rust-facts/keys.js";
import type { RustExpr } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { diagnosticInput, isValidRustIdentifier, rustValueName, sourceTypePath } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { isFloatCarrier } from "./render-types.js";
import { isRustIntegerCarrier } from "../../source/rust-target-types.js";

export function planExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const planned = planExpressionInner(node, context);
  if (planned === undefined) {
    return undefined;
  }
  const wrap = context.input.facts.getFact(node, rustOptionWrapFactKey);
  return wrap?.wrap === true ? { kind: "call", path: "Some", args: [planned] } : planned;
}

function planExpressionInner(node: Node, context: RustPlanContext): RustExpr | undefined {
  const { ast } = context.input;
  const kind = ast.kindName(node);
  switch (kind) {
    case KindNumericLiteral: {
      return planNumericLiteral(node, context);
    }
    case KindStringLiteral: {
      const literalFact = rustOperationFact(node, context);
      if (literalFact !== undefined && literalFact.kind === "source-enum-member") {
        const value = rustSourceTypeCarrierValue(literalFact.resultCarrier);
        const typePath = value === undefined ? undefined : sourceTypePath(context, value);
        if (typePath === undefined) {
          return undefined;
        }
        return { kind: "path", path: `${typePath}::${literalFact.name}` };
      }
      return { kind: "string-literal", value: ast.text(node) };
    }
    case KindTrueKeyword: {
      return { kind: "bool-literal", value: true };
    }
    case KindFalseKeyword: {
      return { kind: "bool-literal", value: false };
    }
    case "KindThisExpression":
    case "KindThisKeyword": {
      return { kind: "path", path: "self" };
    }
    case "KindNullKeyword": {
      const fact = rustOperationFact(node, context);
      if (fact === undefined || fact.kind !== "option-none") {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.nullish",
          "null literals require a finalized Option lane fact.",
        ));
        return undefined;
      }
      return { kind: "path", path: "None" };
    }
    case KindIdentifier: {
      const identifierFact = rustOperationFact(node, context);
      if (identifierFact !== undefined && identifierFact.kind === "option-none") {
        return { kind: "path", path: "None" };
      }
      const name = rustValueName(ast.text(node));
      if (!isValidRustIdentifier(name)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.identifier",
          `Identifier '${ast.text(node)}' does not lower to a valid Rust identifier.`,
        ));
        return undefined;
      }
      return { kind: "path", path: name };
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(node);
      return inner === undefined ? undefined : planExpression(inner, context);
    }
    case "KindArrayLiteralExpression": {
      return planArrayLiteral(node, context);
    }
    case "KindObjectLiteralExpression": {
      return planRecordLiteral(node, context);
    }
    case "KindArrowFunction": {
      const closureFact = rustOperationFact(node, context);
      if (closureFact === undefined || closureFact.kind !== "closure") {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.closure",
          "Arrow functions require a finalized closure fact.",
        ));
        return undefined;
      }
      const arrowParams = context.input.ast.parameters(node);
      const params: { name: string; byRefCopy: boolean }[] = [];
      for (const [index, parameter] of arrowParams.entries()) {
        const parameterName = parameter === undefined ? "" : rustValueName(ast.text(ast.name(parameter) ?? parameter));
        if (!isValidRustIdentifier(parameterName)) {
          return undefined;
        }
        params.push({ name: parameterName, byRefCopy: closureFact.byRefCopyParams[index] === true });
      }
      const bodyNode = context.input.ast.body(node);
      const closureContext: RustPlanContext = { ...context, fallibleContext: false };
      const body = bodyNode === undefined ? undefined : planExpression(bodyNode, closureContext);
      return body === undefined ? undefined : { kind: "closure", params, body };
    }
    case "KindAwaitExpression": {
      const awaitFact = rustOperationFact(node, context);
      if (awaitFact === undefined || awaitFact.kind !== "await-op") {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.async",
          "Await expressions require a finalized future output fact.",
        ));
        return undefined;
      }
      const operand = Node_Expression(node);
      if (operand !== undefined) {
        context.awaitedCalls?.add(operand);
      }
      const planned = operand === undefined ? undefined : planExpression(operand, context);
      return planned === undefined ? undefined : { kind: "field", receiver: planned, name: "await" };
    }
    case KindPrefixUnaryExpression:
    case KindPostfixUnaryExpression: {
      return planUnaryExpression(node, context);
    }
    case KindBinaryExpression: {
      return planBinaryExpression(node, context);
    }
    case KindCallExpression: {
      return planCallExpression(node, context);
    }
    case KindNewExpression: {
      return planNewExpression(node, context);
    }
    case KindPropertyAccessExpression: {
      return planPropertyAccess(node, context);
    }
    case KindElementAccessExpression: {
      return planElementAccess(node, context);
    }
    default: {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.expression",
        "The Rust target does not support this expression.",
      ));
      return undefined;
    }
  }
}

export function expressionCarrier(node: Node, context: RustPlanContext): TargetTypeRef | undefined {
  return context.input.facts.getRuntimeCarrierFact(node)?.carrier;
}

function rustOperationFact(node: Node, context: RustPlanContext): RustTargetOperationFact | undefined {
  return context.input.facts.getFact(node, rustTargetOperationFactKey);
}

export function planNumericLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const carrier = expressionCarrier(node, context);
  if (carrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.literal-carrier",
      "Numeric literal has no finalized Rust carrier fact.",
    ));
    return undefined;
  }
  const text = context.input.ast.text(node);
  if (isFloatCarrier(carrier)) {
    const floatText = text.includes(".") || text.includes("e") || text.includes("E") ? text : `${text}.0`;
    return { kind: "float-literal", text: floatText };
  }
  if (isRustIntegerCarrier(carrier)) {
    if (!/^[0-9]+$/u.test(text)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.literal-carrier",
        `Numeric literal '${text}' cannot lower to integer carrier.`,
      ));
      return undefined;
    }
    return { kind: "int-literal", text };
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.literal-carrier",
    "Numeric literal carrier is not a supported Rust numeric carrier.",
  ));
  return undefined;
}

function planUnaryExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact === undefined || fact.kind !== "operator-token") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator",
      "Unary expression requires a finalized Rust operator fact.",
    ));
    return undefined;
  }
  if (fact.operator !== "-" && fact.operator !== "!") {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator",
      `Unary operator '${fact.operator}' is only supported in statement position.`,
    ));
    return undefined;
  }
  const operandNode = PrefixUnaryExpression_Operand(node);
  const operand = operandNode === undefined ? undefined : planExpression(operandNode, context);
  return operand === undefined ? undefined : { kind: "unary", operator: fact.operator, operand };
}

function planBinaryExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "option-coalesce") {
    const leftNode = BinaryExpression_Left(node);
    const rightNode = BinaryExpression_Right(node);
    const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
    const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return { kind: "method-call", receiver: left, method: "unwrap_or", args: [right] };
  }
  if (fact !== undefined && fact.kind === "option-check") {
    const { ast } = context.input;
    const leftNode = BinaryExpression_Left(node);
    const rightNode = BinaryExpression_Right(node);
    const optionNode = leftNode !== undefined && context.input.facts.getRuntimeCarrierFact(leftNode) !== undefined &&
      ast.kindName(leftNode) !== "KindIdentifier"
      ? leftNode
      : rightNode !== undefined && context.input.facts.getRuntimeCarrierFact(rightNode) !== undefined
        ? rightNode
        : leftNode;
    const value = optionNode === undefined ? undefined : planExpression(optionNode, context);
    if (value === undefined) {
      return undefined;
    }
    return { kind: "method-call", receiver: value, method: fact.negated ? "is_some" : "is_none", args: [] };
  }
  if (fact === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator",
      "Binary expression requires a finalized Rust operator fact.",
    ));
    return undefined;
  }
  const leftNode = BinaryExpression_Left(node);
  const rightNode = BinaryExpression_Right(node);
  const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
  const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
  if (left === undefined || right === undefined) {
    return undefined;
  }
  if (fact.kind === "string-concat") {
    const parts: RustExpr[] = [];
    for (const side of [left, right]) {
      if (side.kind === "string-concat") {
        parts.push(...side.parts);
      } else {
        parts.push(side);
      }
    }
    return { kind: "string-concat", parts };
  }
  if (fact.kind === "operator-token") {
    // Owned-String literals in comparison position lower as &str literals so
    // generated code stays clippy-clean (cmp_owned).
    const comparison = fact.operator === "==" || fact.operator === "!=";
    const borrowLiteral = (side: RustExpr): RustExpr =>
      comparison && side.kind === "string-literal" ? { kind: "str-literal", value: side.value } : side;
    return { kind: "binary", operator: fact.operator, left: borrowLiteral(left), right: borrowLiteral(right) };
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.operator",
    "Binary expression selected a non-operator Rust operation.",
  ));
  return undefined;
}

function planArguments(node: Node, context: RustPlanContext): readonly RustExpr[] | undefined {
  const args: RustExpr[] = [];
  for (const argument of context.input.ast.arguments(node)) {
    if (argument === undefined) {
      continue;
    }
    const planned = planExpression(argument, context);
    if (planned === undefined) {
      return undefined;
    }
    args.push(planned);
  }
  return args;
}

function planProviderOperationExpression(
  context: RustPlanContext,
  form: RustProviderOperationForm,
  receiverNode: Node | undefined,
  args: readonly RustExpr[],
): RustExpr | undefined {
  switch (form.form) {
    case "call": {
      const shaped = args.map((argument, index): RustExpr => {
        const mode = form.argModes?.[index] ?? "value";
        if (mode === "ref") {
          // Owned-string literals borrow as &str literals directly.
          if (argument.kind === "string-literal") {
            return { kind: "str-literal", value: argument.value };
          }
          return { kind: "reference", expr: argument };
        }
        if (mode === "mut-ref") {
          return { kind: "reference", expr: argument, mutable: true };
        }
        return argument;
      });
      const trailing = (form.trailingArgs ?? []).map((text): RustExpr => ({ kind: "path", path: text }));
      let result: RustExpr = { kind: "call", path: form.path, args: [...shaped, ...trailing] };
      for (const chained of form.chain ?? []) {
        result = { kind: "method-call", receiver: result, method: chained, args: [] };
      }
      return result;
    }
    case "call-str-slice": {
      const asStr = args.map((argument): RustExpr =>
        argument.kind === "string-literal"
          ? { kind: "str-literal", value: argument.value }
          : { kind: "method-call", receiver: argument, method: "as_str", args: [] });
      return {
        kind: "call",
        path: form.path,
        args: [{ kind: "reference", expr: { kind: "slice-literal", elements: asStr } }],
      };
    }
    case "path": {
      return { kind: "path", path: form.path };
    }
    case "method": {
      const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      return receiver === undefined ? undefined : { kind: "method-call", receiver, method: form.name, args };
    }
    case "field": {
      const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      return receiver === undefined ? undefined : { kind: "field", receiver, name: form.name };
    }
    case "index": {
      const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      if (receiver === undefined || args.length !== 1) {
        return undefined;
      }
      const index = args[0];
      return index === undefined ? undefined : { kind: "index", receiver, index };
    }
    case "binary-operator": {
      const [left, right] = args;
      if (left === undefined || right === undefined || args.length !== 2) {
        return undefined;
      }
      return { kind: "binary", operator: form.operator, left, right };
    }
    case "free-call": {
      const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      if (receiver === undefined) {
        return undefined;
      }
      const receiverArg: RustExpr = form.receiverMode === "ref" ? { kind: "reference", expr: receiver } : receiver;
      const ordered = form.argOrder === undefined ? args : form.argOrder.map((index) => args[index]).filter((argument): argument is RustExpr => argument !== undefined);
      const shapedArgs = ordered.map((argument, index): RustExpr => {
        if ((form.argModes?.[index] ?? "value") !== "ref") {
          return argument;
        }
        return argument.kind === "string-literal"
          ? { kind: "str-literal", value: argument.value }
          : { kind: "reference", expr: argument };
      });
      const trailing = (form.trailingArgs ?? []).map((text): RustExpr => ({ kind: "path", path: text }));
      return { kind: "call", path: form.path, args: [receiverArg, ...shapedArgs, ...trailing] };
    }
    case "receiver-method": {
      const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      if (receiver === undefined) {
        return undefined;
      }
      const shapedArgs = args.map((argument, index): RustExpr => {
        const cast = form.argCasts?.[index];
        const mode = form.argModes?.[index] ?? "value";
        let shaped: RustExpr = argument;
        if (cast !== undefined) {
          shaped = { kind: "cast", expr: shaped, to: cast };
        }
        if (mode === "ref") {
          shaped = { kind: "reference", expr: shaped };
        }
        return shaped;
      });
      let result: RustExpr = { kind: "method-call", receiver, method: form.name, args: shapedArgs };
      for (const chained of form.chain ?? []) {
        result = { kind: "method-call", receiver: result, method: chained, args: [] };
      }
      return result;
    }
  }
}

function planCallExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const { ast } = context.input;
  const callCarrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  if (callCarrier?.kind === "target-named" && callCarrier.id === "rust.core.Future" && context.awaitedCalls?.has(node) !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.async",
      "Async call results must be awaited; futures cannot be stored or ignored.",
    ));
    return undefined;
  }
  const callee = Node_Expression(node);
  const fact = rustOperationFact(node, context);
  const args = planArguments(node, context);
  if (args === undefined) {
    return undefined;
  }
  if (fact !== undefined && fact.kind === "flow-marker") {
    // Flow marker calls erase to their argument; passing shape comes from the
    // consuming position's finalized argument modes.
    const [argument] = args;
    return argument;
  }
  if (fact !== undefined && fact.kind === "source-static-method") {
    const value = rustSourceTypeCarrierValue(fact.typeCarrier);
    const typePath = value === undefined ? undefined : sourceTypePath(context, value);
    if (typePath === undefined) {
      return undefined;
    }
    return { kind: "call", path: `${typePath}::${rustValueName(fact.name)}`, args };
  }
  if (fact !== undefined && fact.kind === "source-method") {
    const receiverNode = callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression
      ? Node_Expression(callee)
      : undefined;
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    if (receiver === undefined) {
      return undefined;
    }
    const methodCall: RustExpr = { kind: "method-call", receiver, method: rustValueName(fact.name), args };
    if (fact.fallible === true) {
      if (context.fallibleContext !== true) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "rust.error.call",
          "Fallible calls require a fallible lowering context (a throwing function or a try block).",
        ));
        return undefined;
      }
      return { kind: "try", expr: methodCall };
    }
    return methodCall;
  }
  if (fact !== undefined && fact.kind === "provider-operation") {
    const receiverNode = callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression
      ? Node_Expression(callee)
      : undefined;
    const planned = planProviderOperationExpression(context, fact.target, receiverNode, args);
    if (planned === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.provider.call",
        "Provider call operation could not be lowered.",
      ));
      return undefined;
    }
    if (fact.fallible === true) {
      if (context.fallibleContext !== true) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "rust.error.call",
          "Fallible operations require a fallible lowering context (a throwing function or a try block).",
        ));
        return undefined;
      }
      return applyResultCast({ kind: "try", expr: planned }, fact.castResult);
    }
    return applyResultCast(planned, fact.castResult);
  }
  const sourceReference = callee === undefined
    ? undefined
    : context.input.analysis.getProjectSourceReferenceForNode(callee, { sourceFile: context.sourceFile });
  if (sourceReference === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.call",
      "Call expression has neither a provider operation fact nor a project source reference.",
    ));
    return undefined;
  }
  const declarationFileName = ast.getFileName(sourceReference.sourceFile);
  const moduleName = context.moduleNameByFileName.get(declarationFileName);
  const declarationName = rustValueName(ast.text(ast.name(sourceReference.declaration) ?? sourceReference.declaration));
  if (moduleName === undefined || !isValidRustIdentifier(declarationName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.call",
      "Call target does not resolve to a generated Rust module function.",
    ));
    return undefined;
  }
  const fallibleCall = context.input.facts.getFact(node, rustFallibleCallFactKey) !== undefined;
  if (fallibleCall && context.fallibleContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.call",
      "Fallible calls require a fallible lowering context (a throwing function or a try block).",
    ));
    return undefined;
  }
  const path = moduleName === context.moduleName ? declarationName : `crate::${moduleName}::${declarationName}`;
  const parameters = ast.parameters(sourceReference.declaration);
  const callArgumentNodes = ast.arguments(node).filter((argument): argument is Node => argument !== undefined);
  const shapedArgs = args.map((argument, index) => {
    const parameter = parameters[index];
    const parameterCarrier = parameter === undefined
      ? undefined
      : context.input.facts.getRuntimeCarrierFact(parameter)?.carrier;
    const argumentNode = callArgumentNodes[index];
    const argumentCarrier = argumentNode === undefined
      ? undefined
      : context.input.facts.getRuntimeCarrierFact(argumentNode)?.carrier;
    // Owned dense arrays borrow into slice parameters: proven by both
    // finalized carriers, not by syntax.
    if (parameterCarrier?.kind === "pointer" && parameterCarrier.pointee.kind === "array" && argumentCarrier?.kind === "array") {
      return { kind: "reference" as const, expr: argument, mutable: parameterCarrier.mutability === "mut" };
    }
    return argument;
  });
  const call: RustExpr = { kind: "call", path, args: shapedArgs };
  return fallibleCall ? { kind: "try", expr: call } : call;
}

function planNewExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "source-constructor") {
    const value = rustSourceTypeCarrierValue(fact.resultCarrier);
    const typePath = value === undefined ? undefined : sourceTypePath(context, value);
    const args = planArguments(node, context);
    if (typePath === undefined || args === undefined) {
      if (typePath === undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.class",
          "Constructor does not resolve to a generated Rust struct path.",
        ));
      }
      return undefined;
    }
    return { kind: "call", path: `${typePath}::new`, args };
  }
  if (fact === undefined || fact.kind !== "provider-operation" || fact.operationKind !== "constructor") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.constructor",
      "Constructor expression requires a finalized provider constructor fact.",
    ));
    return undefined;
  }
  const args = planArguments(node, context);
  if (args === undefined) {
    return undefined;
  }
  const planned = planProviderOperationExpression(context, fact.target, undefined, args);
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.constructor",
      "Provider constructor operation could not be lowered.",
    ));
  }
  return planned;
}

function planPropertyAccess(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "source-field") {
    const receiverNode = Node_Expression(node);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    return receiver === undefined ? undefined : { kind: "field", receiver, name: rustValueName(fact.name) };
  }
  if (fact !== undefined && fact.kind === "source-enum-member") {
    const value = rustSourceTypeCarrierValue(fact.resultCarrier);
    const typePath = value === undefined ? undefined : sourceTypePath(context, value);
    if (typePath === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.enum",
        "Enum member access does not resolve to a generated Rust enum path.",
      ));
      return undefined;
    }
    return { kind: "path", path: `${typePath}::${fact.name}` };
  }
  if (fact === undefined || fact.kind !== "provider-operation") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.property",
      "Property access requires a finalized provider property fact.",
    ));
    return undefined;
  }
  const planned = planProviderOperationExpression(context, fact.target, Node_Expression(node), []);
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.property",
      "Provider property operation could not be lowered.",
    ));
    return undefined;
  }
  return applyResultCast(planned, fact.castResult);
}

function planElementAccess(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "tuple-index") {
    const receiver = Node_Expression(node);
    const planned = receiver === undefined ? undefined : planExpression(receiver, context);
    return planned === undefined ? undefined : { kind: "field", receiver: planned, name: String(fact.index) };
  }
  if (fact === undefined || fact.kind !== "provider-operation") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.indexer",
      "Element access requires a finalized provider indexer fact.",
    ));
    return undefined;
  }
  const argumentNode = ElementAccessExpression_ArgumentExpression(node);
  const argument = argumentNode === undefined ? undefined : planExpression(argumentNode, context);
  if (argument === undefined) {
    return undefined;
  }
  const planned = planProviderOperationExpression(context, fact.target, Node_Expression(node), [argument]);
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.indexer",
      "Provider indexer operation could not be lowered.",
    ));
    return undefined;
  }
  return applyResultCast(planned, fact.castResult);
}

function applyResultCast(expression: RustExpr, castTo: string | undefined): RustExpr {
  return castTo === undefined ? expression : { kind: "cast", expr: expression, to: castTo };
}

export function planArrayLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "tuple-literal") {
    const elements: RustExpr[] = [];
    for (const element of context.input.ast.elements(node)) {
      if (element === undefined) {
        continue;
      }
      const planned = planExpression(element, context);
      if (planned === undefined) {
        return undefined;
      }
      elements.push(planned);
    }
    return { kind: "tuple-literal", elements };
  }
  if (fact === undefined || fact.kind !== "array-literal") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.array-literal",
      "Array literals require a finalized Rust array lane fact.",
    ));
    return undefined;
  }
  if (fact.lane !== "dense") {
    // Sparse literals lower at variable-declaration level into JsArray
    // construction statements.
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.js.sparse-array",
      "Sparse array literals are supported only as variable initializers.",
    ));
    return undefined;
  }
  const elements: RustExpr[] = [];
  for (const element of context.input.ast.elements(node)) {
    if (element === undefined) {
      continue;
    }
    const planned = planExpression(element, context);
    if (planned === undefined) {
      return undefined;
    }
    elements.push(planned);
  }
  return { kind: "vec-literal", elements };
}

function planRecordLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact === undefined || fact.kind !== "record-literal") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Object literals require a finalized record shape fact.",
    ));
    return undefined;
  }
  const value = rustSourceTypeCarrierValue(fact.resultCarrier);
  const typePath = value === undefined ? undefined : sourceTypePath(context, value);
  if (typePath === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Object literal shape does not resolve to a generated Rust struct.",
    ));
    return undefined;
  }
  const { ast } = context.input;
  const fields: { name: string; value: RustExpr }[] = [];
  for (const property of ast.properties(node)) {
    if (property === undefined) {
      continue;
    }
    const nameNode = ast.name(property);
    const fieldName = rustValueName(nameNode === undefined ? "" : ast.text(nameNode));
    const initializer = Node_Initializer(property);
    const planned = initializer === undefined ? undefined : planExpression(initializer, context);
    if (!isValidRustIdentifier(fieldName) || planned === undefined) {
      return undefined;
    }
    fields.push({ name: fieldName, value: planned });
  }
  return { kind: "struct-literal", path: typePath, fields };
}
