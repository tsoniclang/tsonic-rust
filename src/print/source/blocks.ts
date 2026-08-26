import { appendToLastLine, firstLine, lastLine, lastLineLength, printRustPattern, remainingLines, renderedFits } from "./patterns.js";
import { indentText, printRustType } from "./types.js";
import { printFittedCall } from "./expressions/calls.js";
import { printRustAssociatedCallTarget, printRustDirectCallTarget } from "./expressions/callable.js";
import { printFittedMethodChain, printRustAssociatedOwner, printRustFlatLetInitializer, rustMethodChain, rustMethodChainBreaksReceiverWhenExpanded, rustMethodChainFirstMethodRequiresExpansion } from "./expressions/chains.js";
import { printRustAssociatedCallOwner, printRustLetInitializer, printRustTypeFitted } from "./expressions/blocks.js";
import { printRustCapturedErrorExpression, printRustExpr } from "./expressions/core.js";
import { printRustExprFitted } from "./expressions/fitted.js";
import { rustFormatWidth, rustNestedCallWidth } from "./formatting.js";
import { printRustAttribute } from "./attributes.js";
import type { RustAttribute } from "../../backend/target-ast/attributes.js";
import type { RustBlock, RustExpr, RustLocalErrorCapture, RustStmt } from "../../backend/target-ast/nodes.js";

export function printRustBlockStatements(block: RustBlock, depth: number): string {
  return [
    ...(block.innerAttrs ?? []).map((attribute) => `${indentText(depth)}${printRustAttribute(attribute, "inner", depth)}`),
    ...block.statements.map((statement) => printRustStmt(statement, depth)),
  ].join("\n");
}

function printRustBlock(block: RustBlock, depth: number, header: string): string {
  const body = printRustBlockStatements(block, depth + 1);
  const indent = indentText(depth);
  return body.length === 0 ? `${indent}${header} {}` : `${indent}${header} {\n${body}\n${indent}}`;
}

function printRustStmt(statement: RustStmt, depth: number): string {
  const indent = indentText(depth);
  switch (statement.kind) {
    case "let": {
      const mutability = statement.mutable ? "mut " : "";
      const attributes = statement.attrs?.map((attribute) => `${indent}${printRustAttribute(attribute, "outer", depth)}\n`).join("") ?? "";
      const typeSuffix = statement.type === undefined ? "" : `: ${printRustType(statement.type)}`;
      if (statement.init === undefined) {
        return `${attributes}${indent}let ${mutability}${statement.name}${typeSuffix};`;
      }
      if (statement.type !== undefined) {
        const declarationPrefix = `${indent}let ${mutability}${statement.name}: `;
        const renderedType = printRustTypeFitted(
          statement.type,
          depth,
          declarationPrefix.length,
        );
        if (renderedType.includes("\n")) {
          const assignmentPrefix = appendToLastLine(
            `${declarationPrefix}${renderedType}`,
            " = ",
          );
          const initializerColumn = lastLineLength(assignmentPrefix) + 1;
          const initializer = printRustExprFitted(
            statement.init,
            depth,
            initializerColumn,
          );
          if (renderedFits(initializer, initializerColumn)) {
            return `${attributes}${appendToLastLine(`${assignmentPrefix}${initializer}`, ";")}`;
          }
          const continuationIndent = indentText(depth + 1);
          const continuation = printRustExprFitted(
            statement.init,
            depth + 1,
            continuationIndent.length,
          );
          return `${attributes}${appendToLastLine(
            `${assignmentPrefix.trimEnd()}\n${continuationIndent}${continuation}`,
            ";",
          )}`;
        }
      }
      const prefix = `${indent}let ${mutability}${statement.name}${typeSuffix} = `;
      return `${attributes}${printRustLetInitializer(prefix, statement.init, depth)}`;
    }
    case "let-pattern": {
      const prefix = `${indent}let ${printRustPattern(statement.pattern)} = `;
      const initializer = printRustExprFitted(statement.init, depth, prefix.length);
      return appendToLastLine(`${prefix}${initializer}`, ";");
    }
    case "expr": {
      return `${indent}${printRustStatementExpr(statement.expr, depth, indent.length + 1)};`;
    }
    case "assign": {
      return printRustAssignment(statement.target, statement.operator, statement.value, depth);
    }
    case "return": {
      return statement.expr === undefined
        ? `${indent}return;`
        : `${indent}return ${printRustExprFitted(statement.expr, depth, indent.length + "return ".length + 1)};`;
    }
    case "tail": {
      return `${indent}${printRustExprFitted(
        statement.expr,
        depth,
        indent.length,
        undefined,
        "statement",
      )}`;
    }
    case "if": {
      const rendered = printRustConditionalBlock("if", statement.condition, statement.then, depth);
      const attributes = printRustStatementAttributes(statement.attrs, depth);
      if (statement.else === undefined) {
        return `${attributes}${rendered}`;
      }
      const elseBody = printRustBlockStatements(statement.else, depth + 1);
      const indentStr = indentText(depth);
      const withoutTrailing = rendered.endsWith("{}") ? `${rendered.slice(0, -2)}{\n${indentStr}}` : rendered;
      const complete = elseBody.length === 0
        ? `${withoutTrailing} else {}`
        : `${withoutTrailing} else {\n${elseBody}\n${indentStr}}`;
      return `${attributes}${complete}`;
    }
    case "loop": {
      return printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}loop`,
      );
    }
    case "while": {
      const rendered = printRustConditionalBlock("while", statement.condition, statement.body, depth);
      const complete = statement.label === undefined
        ? rendered
        : `${indent}'${statement.label}: ${rendered.slice(indent.length)}`;
      return `${printRustStatementAttributes(statement.attrs, depth)}${complete}`;
    }
    case "while-let-some": {
      return printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}while let Some(${statement.bindingMutable === true ? "mut " : ""}${statement.binding}) = ${printRustExpr(statement.expression)}`,
      );
    }
    case "for": {
      return `${printRustStatementAttributes(statement.attrs, depth)}${printRustForBlock(statement, depth)}`;
    }
    case "if-let-some": {
      return printRustBlock(
        statement.body,
        depth,
        `if let Some(${statement.binding}) = ${printRustExpr(statement.expression)}`,
      );
    }
    case "break": {
      return `${indent}break${statement.label === undefined ? "" : ` '${statement.label}`};`;
    }
    case "continue": {
      return `${indent}continue${statement.label === undefined ? "" : ` '${statement.label}`};`;
    }
    case "completion-exit": {
      const completion: RustExpr = statement.completion === "return"
        ? {
            kind: "call",
            path: "rt::Completion::Return",
            args: [statement.expr ?? { kind: "path", path: "()" }],
          }
        : {
            kind: "call",
            path: statement.completion === "break"
              ? "rt::Completion::Break"
              : "rt::Completion::Continue",
            args: [{ kind: "int-literal", text: String(statement.loopId ?? 0) }],
          };
      const value: RustExpr = statement.resultWrapped
        ? { kind: "call", path: "Ok", args: [completion] }
        : completion;
      const local = statement.captureLabel !== undefined;
      const tail = statement.tail === true && !local;
      const prefix = local
        ? `${indent}break '${statement.captureLabel} `
        : tail ? indent : `${indent}return `;
      return `${prefix}${printRustExprFitted(value, depth, prefix.length)}${tail ? "" : ";"}`;
    }
    case "resource-scope": {
      return printRustResourceScope(statement, depth);
    }
    case "index-assign": {
      return printRustAssignment({
        kind: "index",
        receiver: statement.receiver,
        index: statement.index,
      }, "=", statement.value, depth);
    }
    case "scope": {
      const body = printRustBlockStatements(statement.body, depth + 1);
      const prefix = statement.label === undefined ? "" : `'${statement.label}: `;
      return body.length === 0
        ? `${indent}${prefix}{}`
        : `${indent}${prefix}{\n${body}\n${indent}}`;
    }
    case "unsafe-scope": {
      return printRustBlock(statement.body, depth, "unsafe");
    }
    case "throw": {
      if (statement.errorCapture !== undefined) {
        const renderedError = printRustExprFitted(statement.error, depth + 1, indentText(depth + 1).length);
        const captured = printRustCapturedErrorExpression(renderedError, statement.errorCapture, depth);
        return appendToLastLine(`${indent}${captured}`, ";");
      }
      const tail = statement.tail === true;
      const control = tail ? "" : "return ";
      const prefix = `${control}Err(`;
      const callChain = statement.error.kind === "call" || statement.error.kind === "associated-call"
        ? collectNestedCallExpressionChain(statement.error)
        : undefined;
      if (callChain !== undefined && callChain.callables.length > 1 &&
        (printRustExpr(statement.error).length > rustNestedCallWidth ||
          indent.length + prefix.length + printRustExpr(statement.error).length >= rustFormatWidth - 10)) {
        const argumentIndent = indentText(depth + 1);
        return [
          `${indent}${prefix}${callChain.callables.map((callable) => `${callable}(`).join("")}`,
          ...callChain.arguments.map((argument) => appendToLastLine(
            `${argumentIndent}${printRustExprFitted(
              argument,
              depth + 1,
              argumentIndent.length,
            )}`,
            ",",
          )),
          `${indent}${")".repeat(callChain.callables.length + 1)}${tail ? "" : ";"}`,
        ].join("\n");
      }
      const renderedError = printRustExprFitted(
        statement.error,
        depth,
        indent.length + prefix.length + 1,
      );
      const rendered = appendToLastLine(
        `${prefix}${renderedError}`,
        `)${tail ? "" : ";"}`,
      );
      if (renderedFits(rendered, indent.length) &&
        rendered.length + indent.length < rustFormatWidth) {
        return `${indent}${rendered}`;
      }
      const errorIndent = indentText(depth + 1);
      const expandedError = printRustExprFitted(
        statement.error,
        depth + 1,
        errorIndent.length,
      );
      return [
        `${indent}${prefix}`,
        appendToLastLine(`${errorIndent}${expandedError}`, ","),
        `${indent})${tail ? "" : ";"}`,
      ].join("\n");
    }
    case "try-scope": {
      return printRustTryScope(statement, depth);
    }
  }
}

function printRustStatementAttributes(
  attrs: readonly RustAttribute[] | undefined,
  depth: number,
): string {
  const indent = indentText(depth);
  return attrs?.map((attribute) => `${indent}${printRustAttribute(attribute, "outer", depth)}\n`).join("") ?? "";
}

export function collectNestedCallExpressionChain(
  expression: Extract<RustExpr, { readonly kind: "call" | "associated-call" }>,
): {
  readonly callables: readonly string[];
  readonly arguments: readonly RustExpr[];
} | undefined {
  const callables: string[] = [];
  let current = expression;
  for (;;) {
    callables.push(current.kind === "call"
      ? printRustDirectCallTarget(current)
      : printRustAssociatedCallTarget(current, printRustAssociatedOwner(current.owner)));
    if (current.args.length !== 1 ||
      (current.args[0]?.kind !== "call" && current.args[0]?.kind !== "associated-call")) {
      return current.args.length === 0 ? undefined : { callables, arguments: current.args };
    }
    current = current.args[0];
  }
}

function printRustForBlock(
  statement: Extract<RustStmt, { readonly kind: "for" }>,
  depth: number,
): string {
  const indent = indentText(depth);
  const prefix = `${statement.label === undefined ? "" : `'${statement.label}: `}for ${statement.bindingMutable === true ? "mut " : ""}${statement.binding} in`;
  const flatIterable = printRustExpr(statement.iterable);
  const flatHeader = `${prefix} ${flatIterable}`;
  if (!flatIterable.includes("\n") && renderedFits(flatHeader, indent.length)) {
    return printRustBlock(statement.body, depth, flatHeader);
  }
  const attachedColumn = indent.length + prefix.length + 1;
  const attachedIterable = printRustExprFitted(
    statement.iterable,
    depth,
    attachedColumn,
    indentText(depth + 1),
  );
  if (attachedIterable.includes("\n") && renderedFits(attachedIterable, attachedColumn)) {
    const body = printRustBlockStatements(statement.body, depth + 1);
    return [
      `${indent}${prefix} ${firstLine(attachedIterable)}`,
      ...remainingLines(attachedIterable),
      `${indent}{`,
      ...(body.length === 0 ? [] : [body]),
      `${indent}}`,
    ].join("\n");
  }
  const iterableIndent = indentText(depth + 1);
  const iterable = printRustExprFitted(
    statement.iterable,
    depth + 1,
    iterableIndent.length,
  );
  const body = printRustBlockStatements(statement.body, depth + 1);
  return [
    `${indent}${prefix}`,
    `${iterableIndent}${iterable}`,
    `${indent}{`,
    ...(body.length === 0 ? [] : [body]),
    `${indent}}`,
  ].join("\n");
}

function printRustTryScope(
  statement: Extract<RustStmt, { readonly kind: "try-scope" }>,
  depth: number,
): string {
  const indent = indentText(depth);
  const nested = indentText(depth + 1);
  const completionType = `rt::Completion<${printRustType(statement.returnType)}>`;
  const lines = printRustCompletionCapture(
    statement.flowName,
    statement.bodyLabel,
    completionType,
    statement.body,
    statement.fallible,
    statement.bodyTerminates,
    depth,
  );
  let flowFallible = statement.fallible;
  if (statement.finallyClause !== undefined && statement.finallyName !== undefined) {
    const finallyClause = statement.finallyClause;
    lines.push(...printRustCompletionCapture(
      statement.finallyName,
      finallyClause.captureLabel,
      completionType,
      finallyClause.body,
      finallyClause.fallible,
      finallyClause.terminates,
      depth,
    ));
    if (flowFallible || finallyClause.fallible) {
      const bodyResult = flowFallible ? statement.flowName : `Ok(${statement.flowName})`;
      const finallyResult = finallyClause.fallible
        ? statement.finallyName
        : `Ok(${statement.finallyName})`;
      lines.push(
        `${indent}let ${statement.flowName}: rt::TsonicResult<${completionType}> =`,
        `${nested}rt::finish_finally(${bodyResult}, ${finallyResult});`,
      );
      flowFallible = true;
    } else {
      lines.push(
        `${indent}let ${statement.flowName} = match ${statement.finallyName} {`,
        `${nested}rt::Completion::Normal => ${statement.flowName},`,
        `${nested}completion => completion,`,
        `${indent}};`,
      );
    }
  }
  if (flowFallible) {
    lines.push(...printRustResultPropagationAssignment(
      statement.flowName,
      statement.flowName,
      statement.errorCapture,
      depth,
    ));
  }
  lines.push(...printCompletionDispatch(statement, depth));
  return lines.join("\n");
}

function printRustCompletionCapture(
  name: string,
  label: string,
  completionType: string,
  body: RustBlock,
  fallible: boolean,
  terminates: boolean,
  depth: number,
): string[] {
  const indent = indentText(depth);
  const captureType = fallible
    ? `rt::TsonicResult<${completionType}>`
    : completionType;
  const inlineExpression = printRustCompletionCaptureExpression(
    completionType,
    body,
    fallible,
    terminates,
    label,
    depth,
  );
  const prefix = `${indent}let ${name}: ${captureType} = `;
  if (inlineExpression.length === 1) {
    const assignment = `${prefix}${inlineExpression[0]};`;
    return renderedFits(assignment, 0)
      ? [assignment]
      : [`${prefix.trimEnd()}`, `${indentText(depth + 1)}${inlineExpression[0]};`];
  }
  if (renderedFits(`${prefix}${inlineExpression[0]}`, 0) &&
    prefix.length + inlineExpression[0]!.length <= rustFormatWidth - 4) {
    return [
      `${prefix}${inlineExpression[0]}`,
      ...inlineExpression.slice(1, -1),
      `${inlineExpression[inlineExpression.length - 1]};`,
    ];
  }
  const continuationExpression = printRustCompletionCaptureExpression(
    completionType,
    body,
    fallible,
    terminates,
    label,
    depth + 1,
  );
  return [
    `${prefix.trimEnd()}`,
    `${indentText(depth + 1)}${continuationExpression[0]}`,
    ...continuationExpression.slice(1, -1),
    `${continuationExpression[continuationExpression.length - 1]};`,
  ];
}

function printRustCompletionCaptureExpression(
  _completionType: string,
  body: RustBlock,
  fallible: boolean,
  terminates: boolean,
  label: string,
  depth: number,
): string[] {
  const indent = indentText(depth);
  const nested = indentText(depth + 1);
  const renderedBody = printRustBlockStatements(body, depth + 1);
  const normal = fallible
    ? `${nested}Ok(rt::Completion::Normal)`
    : `${nested}rt::Completion::Normal`;
  return [
    `'${label}: {`,
    ...(renderedBody.length === 0 ? [] : [renderedBody]),
    ...(terminates ? [] : [normal]),
    `${indent}}`,
  ];
}

function printRustResourceScope(
  statement: Extract<RustStmt, { readonly kind: "resource-scope" }>,
  depth: number,
): string {
  const indent = indentText(depth);
  const nested = indentText(depth + 1);
  const completionType = `rt::Completion<${printRustType(statement.returnType)}>`;
  const nestedCleanup = printRustBlockStatements(statement.cleanup, depth + 1);
  const directCleanup = printRustBlockStatements(statement.cleanup, depth);
  const lines = printRustCompletionCapture(
    statement.flowName,
    statement.flowName,
    completionType,
    statement.body,
    statement.fallible,
    statement.terminates,
    depth,
  );
  if (statement.fallible) {
    lines.push(
      `${indent}let ${statement.cleanupName}: rt::TsonicResult<()> = '${statement.cleanupName}: {`,
      ...(nestedCleanup.length === 0 ? [] : [nestedCleanup]),
      `${nested}Ok(())`,
      `${indent}};`,
      ...printRustResultPropagationAssignment(
        statement.flowName,
        `rt::finish_resource(${statement.flowName}, ${statement.cleanupName})`,
        statement.errorCapture,
        depth,
      ),
    );
  } else if (directCleanup.length > 0) {
    lines.push(directCleanup);
  }
  lines.push(...printCompletionDispatch(statement, depth));
  return lines.join("\n");
}

function printRustResultPropagationAssignment(
  name: string,
  expression: string,
  errorCapture: RustLocalErrorCapture | undefined,
  depth: number,
): string[] {
  const indent = indentText(depth);
  if (errorCapture === undefined) {
    return [printRustFlatLetInitializer(
      `${indent}let ${name} = `,
      `${expression}?`,
      depth,
    )];
  }
  const nested = indentText(depth + 1);
  const captured = printRustCapturedErrorExpression("error", errorCapture, depth + 2);
  const capturedLines = captured.split("\n");
  return [
    `${indent}let ${name} = match ${expression} {`,
    `${nested}Ok(value) => value,`,
    `${nested}Err(error) => {`,
    `${indentText(depth + 2)}${capturedLines[0]}`,
    ...capturedLines.slice(1),
    `${nested}},`,
    `${indent}};`,
  ];
}

function printCompletionDispatch(
  statement: {
    readonly flowName: string;
    readonly fallible: boolean;
    readonly tail?: true;
    readonly propagate: boolean;
    readonly propagateLabel?: string;
    readonly dispatchReturn: boolean;
    readonly dispatchTargets: readonly {
      readonly kind: "loop" | "switch" | "label";
      readonly id: number;
      readonly label: string;
      readonly continuePrelude?: readonly RustStmt[];
    }[];
    readonly terminates: boolean;
  },
  depth: number,
): readonly string[] {
  const indent = indentText(depth);
  const armIndent = indentText(depth + 1);
  const returnsAsTail = statement.tail === true && statement.terminates;
  const arms: string[] = statement.terminates
    ? [
        `${armIndent}rt::Completion::Normal => {`,
        `${indentText(depth + 2)}unreachable!("terminating Tsonic completion scope completed normally")`,
        `${armIndent}}`,
      ]
    : [`${armIndent}rt::Completion::Normal => {}`];
  if (statement.propagate) {
    const value = statement.fallible ? "Ok(completion)" : "completion";
    arms.push(
      statement.propagateLabel === undefined
        ? `${armIndent}completion => ${returnsAsTail ? "" : "return "}${value},`
        : `${armIndent}completion => break '${statement.propagateLabel} ${value},`,
    );
  } else {
    if (statement.dispatchReturn) {
      arms.push(
        `${armIndent}rt::Completion::Return(value) => ${returnsAsTail ? "" : "return "}${statement.fallible ? "Ok(value)" : "value"},`,
      );
    }
    for (const target of statement.dispatchTargets) {
      arms.push(
        `${armIndent}rt::Completion::Break(${target.id}) => break '${target.label},`,
      );
      if (target.kind !== "loop") {
        continue;
      }
      const continuePrelude = target.continuePrelude ?? [];
      if (continuePrelude.length === 0) {
        arms.push(`${armIndent}rt::Completion::Continue(${target.id}) => continue '${target.label},`);
      } else {
        const prelude = printRustBlockStatements(
          { statements: continuePrelude },
          depth + 2,
        );
        arms.push(
          `${armIndent}rt::Completion::Continue(${target.id}) => {`,
          prelude,
          `${indentText(depth + 2)}continue '${target.label};`,
          `${armIndent}}`,
        );
      }
    }
    const unmatchedVariants = [
      ...(statement.dispatchReturn ? [] : ["rt::Completion::Return(_)"]),
      "rt::Completion::Break(_)",
      "rt::Completion::Continue(_)",
    ];
    const unmatchedPattern = `${unmatchedVariants.join(" | ")} => {`;
    arms.push(
      ...(armIndent.length + unmatchedPattern.length <= rustFormatWidth
        ? [`${armIndent}${unmatchedPattern}`]
        : [
            ...unmatchedVariants.map((variant, index) =>
              `${armIndent}${index === 0 ? "" : "| "}${variant}${index === unmatchedVariants.length - 1 ? " => {" : ""}`),
          ]),
      `${indentText(depth + 2)}unreachable!("invalid finalized Tsonic completion target")`,
      `${armIndent}}`,
    );
  }
  return [
    `${indent}match ${statement.flowName} {`,
    ...arms,
    `${indent}}`,
  ];
}

function printRustAssignment(
  target: RustExpr,
  operator: Extract<RustStmt, { readonly kind: "assign" }>["operator"],
  value: RustExpr,
  depth: number,
): string {
  const indent = indentText(depth);
  const flat = `${printRustExpr(target)} ${operator} ${printRustExpr(value)}`;
  if (renderedFits(flat, indent.length + 1)) {
    return `${indent}${flat};`;
  }
  const renderedTarget = printRustExprFitted(target, depth, indent.length);
  const inlinePrefix = `${indent}${renderedTarget} ${operator} `;
  const inlineValue = printRustExprFitted(value, depth, lastLineLength(inlinePrefix));
  const continuationIndent = indentText(depth + 1);
  const continuationValue = printRustExprFitted(value, depth + 1, continuationIndent.length);
  const continuationAvoidsNestedExpansion = inlineValue.includes("\n") &&
    !continuationValue.includes("\n");
  const multilineValueCanFollowAssignment = value.kind !== "binary" ||
    value.operator === "&&" || value.operator === "||";
  if (!renderedTarget.includes("\n") &&
    (!inlineValue.includes("\n") ||
      multilineValueCanFollowAssignment && !continuationAvoidsNestedExpansion) &&
    inlinePrefix.length + firstLine(inlineValue).length <= rustFormatWidth) {
    return `${inlinePrefix}${inlineValue};`;
  }
  return `${indent}${renderedTarget} ${operator}\n${continuationIndent}${continuationValue};`;
}

function printRustStatementExpr(
  expression: RustExpr,
  depth: number,
  column: number,
): string {
  if (expression.kind === "try" && expression.errorCapture === undefined &&
    (expression.expr.kind === "call" || expression.expr.kind === "associated-call")) {
    const callable = expression.expr.kind === "call"
      ? printRustDirectCallTarget(expression.expr)
      : printRustAssociatedCallTarget(
          expression.expr,
          printRustAssociatedCallOwner(expression.expr),
        );
    const flat = printRustExpr(expression.expr);
    const forceExpanded = !renderedFits(`${flat}?`, column) ||
      expression.expr.args.length > 1 && flat.length > rustNestedCallWidth &&
        expression.expr.args.filter((argument) =>
          argument.kind === "call" || argument.kind === "associated-call" ||
          argument.kind === "method-call" || argument.kind === "try").length > 1;
    return appendToLastLine(
      printFittedCall(
        callable,
        expression.expr.args,
        depth,
        column,
        forceExpanded,
        true,
      ),
      "?",
    );
  }
  if (expression.kind === "try" && expression.errorCapture === undefined &&
    expression.expr.kind === "method-call") {
    const chain = rustMethodChain(expression.expr);
    const firstMethodRequiresExpansion = chain !== undefined &&
      rustMethodChainFirstMethodRequiresExpansion(chain, depth);
    if (chain !== undefined &&
      (firstMethodRequiresExpansion ||
        column + printRustExpr(expression).length >= rustFormatWidth - 1)) {
      const breakBeforeFirstSelector = rustMethodChainBreaksReceiverWhenExpanded(chain);
      return appendToLastLine(
        printFittedMethodChain(
          chain,
          depth,
          column,
          breakBeforeFirstSelector,
          indentText(depth + 1),
          !breakBeforeFirstSelector,
        ),
        "?",
      );
    }
  }
  return printRustExprFitted(expression, depth, column, undefined, "statement");
}

function printRustConditionalBlock(
  keyword: "if" | "while",
  condition: RustExpr,
  block: RustBlock,
  depth: number,
): string {
  const indent = indentText(depth);
  const prefix = `${keyword} `;
  const renderedCondition = printRustExprFitted(
    condition,
    depth,
    indent.length + prefix.length,
    undefined,
    "condition",
  );
  if (!renderedCondition.includes("\n")) {
    const header = `${indent}${prefix}${renderedCondition} {`;
    if (header.length <= rustFormatWidth) {
      return printRustBlock(block, depth, `${prefix}${renderedCondition}`);
    }
    const body = printRustBlockStatements(block, depth + 1);
    return body.length === 0
      ? `${indent}${prefix}${renderedCondition}\n${indent}{}`
      : `${indent}${prefix}${renderedCondition}\n${indent}{\n${body}\n${indent}}`;
  }
  const body = printRustBlockStatements(block, depth + 1);
  const conditionHeader = `${indent}${prefix}${renderedCondition}`;
  const conditionEnding = lastLine(renderedCondition).trim();
  const conditionEndingLine = lastLine(conditionHeader);
  const conditionEndingIndent = conditionEndingLine.length - conditionEndingLine.trimStart().length;
  const header = (conditionEnding === "}" || conditionEnding.endsWith("})")) &&
      conditionEndingIndent === indent.length &&
      conditionEndingLine.length + 2 <= rustFormatWidth
    ? appendToLastLine(conditionHeader, " {")
    : `${conditionHeader}\n${indent}{`;
  return body.length === 0
    ? `${header}}`
    : `${header}\n${body}\n${indent}}`;
}
