import { appendToLastLine, firstLine, lastLine, lastLineLength, remainingLines, renderedFits } from "./patterns.js";
import { indentText, printRustType } from "./types.js";
import { printFittedCall } from "./expressions/calls.js";
import { printRustAssociatedCallTarget, printRustDirectCallTarget } from "./expressions/callable.js";
import { printFittedMethodChain, printRustFlatLetInitializer, rustMethodChain, rustMethodChainBreaksReceiverWhenExpanded, rustMethodChainFirstMethodRequiresExpansion, rustMethodChainPrefersVerticalLayout } from "./expressions/chains.js";
import { printRustAssociatedCallOwner, printRustLetInitializer, printRustTypeFitted } from "./expressions/blocks.js";
import { printRustExpr } from "./expressions/core.js";
import { printRustExprFitted } from "./expressions/fitted.js";
import { expressionIsRightHandBlock } from "./expressions/precedence.js";
import { rustFormatWidth, rustNestedCallWidth } from "./formatting.js";
import type { RustBlock, RustExpr, RustStmt, RustType } from "../../backend/target-ast/nodes.js";

export function printRustBlockStatements(block: RustBlock, depth: number): string {
  return [
    ...(block.innerAttrs ?? []).map((attribute) => `${indentText(depth)}${attribute}`),
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
      const attributes = statement.attrs?.map((attribute) => `${indent}${attribute}\n`).join("") ?? "";
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
          " = x".length,
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
      const indentStr = indentText(depth);
      const withoutTrailing = rendered.endsWith("{}") ? `${rendered.slice(0, -2)}{\n${indentStr}}` : rendered;
      const nestedElseIf = nestedMarkedElseIf(statement.elseIf, statement.else);
      if (nestedElseIf !== undefined) {
        const nested = printRustStmt(nestedElseIf, depth);
        return `${attributes}${withoutTrailing} else ${nested.slice(indentStr.length)}`;
      }
      const elseBody = printRustBlockStatements(statement.else, depth + 1);
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
      const rendered = printRustConditionalBlock(
        "while",
        statement.condition,
        statement.body,
        depth,
        statement.label,
      );
      return `${printRustStatementAttributes(statement.attrs, depth)}${rendered}`;
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
      const rendered = printRustIfLetSomeBlock(statement, depth);
      if (statement.else === undefined) {
        return rendered;
      }
      const nestedElseIf = nestedMarkedElseIf(statement.elseIf, statement.else);
      if (nestedElseIf !== undefined) {
        const nested = printRustStmt(nestedElseIf, depth);
        return `${rendered} else ${nested.slice(indent.length)}`;
      }
      const elseBody = printRustBlockStatements(statement.else, depth + 1);
      return elseBody.length === 0
        ? `${rendered} else {}`
        : `${rendered} else {\n${elseBody}\n${indent}}`;
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
      const prefix = statement.tail === true ? indent : `${indent}return `;
      return `${prefix}${printRustExprFitted(value, depth, prefix.length)}${statement.tail === true ? "" : ";"}`;
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
      const prefix = `${statement.tail === true ? "" : "return "}Err(`;
      const renderedError = printRustExprFitted(
        statement.error,
        depth,
        indent.length + prefix.length + 1,
      );
      const rendered = appendToLastLine(
        `${prefix}${renderedError}`,
        `)${statement.tail === true ? "" : ";"}`,
      );
      if (renderedFits(rendered, indent.length) &&
        (rendered.includes("\n") || rendered.length + indent.length < rustFormatWidth)) {
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
        `${indent})${statement.tail === true ? "" : ";"}`,
      ].join("\n");
    }
    case "try-scope": {
      return printRustTryScope(statement, depth);
    }
  }
}

function printRustIfLetSomeBlock(
  statement: Extract<RustStmt, { readonly kind: "if-let-some" }>,
  depth: number,
): string {
  const indent = indentText(depth);
  const prefix = `if let Some(${statement.binding}) = `;
  const expression = printRustExprFitted(
    statement.expression,
    depth,
    indent.length + prefix.length,
  );
  if (!expression.includes("\n") &&
    renderedFits(`${prefix}${expression} {`, indent.length)) {
    return printRustBlock(statement.body, depth, `${prefix}${expression}`);
  }
  if (!expression.includes("\n") &&
    renderedFits(`${prefix}${expression}`, indent.length)) {
    const body = printRustBlockStatements(statement.body, depth + 1);
    return [
      `${indent}${prefix}${expression}`,
      `${indent}{`,
      ...(body.length === 0 ? [] : [body]),
      `${indent}}`,
    ].join("\n");
  }
  if (expression.includes("\n") &&
    renderedFits(`${prefix}${expression}`, indent.length)) {
    const body = printRustBlockStatements(statement.body, depth + 1);
    return [
      `${indent}${prefix}${expression}`,
      `${indent}{`,
      ...(body.length === 0 ? [] : [body]),
      `${indent}}`,
    ].join("\n");
  }
  const continuationIndent = indentText(depth + 1);
  const continuation = printRustExprFitted(
    statement.expression,
    depth + 1,
    continuationIndent.length,
  );
  const body = printRustBlockStatements(statement.body, depth + 1);
  return [
    `${indent}${prefix.trimEnd()}`,
    `${continuationIndent}${continuation}`,
    `${indent}{`,
    ...(body.length === 0 ? [] : [body]),
    `${indent}}`,
  ].join("\n");
}

function printRustStatementAttributes(
  attrs: readonly string[] | undefined,
  depth: number,
): string {
  const indent = indentText(depth);
  return attrs?.map((attribute) => `${indent}${attribute}\n`).join("") ?? "";
}

function printRustForBlock(
  statement: Extract<RustStmt, { readonly kind: "for" }>,
  depth: number,
): string {
  const indent = indentText(depth);
  const prefix = `${statement.label === undefined ? "" : `'${statement.label}: `}for ${statement.bindingMutable === true ? "mut " : ""}${statement.binding} in`;
  const flatIterable = printRustExpr(statement.iterable);
  const flatHeader = `${prefix} ${flatIterable}`;
  if (!flatIterable.includes("\n") && renderedFits(flatHeader, indent.length) &&
    !rustMethodChainPrefersVerticalLayout(statement.iterable)) {
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
  const completionType: RustType = rustAppliedType("rt::Completion", [statement.returnType]);
  const completionTypeText = printRustType(completionType);
  const lines = printRustCompletionCapture(
    statement.bodyName,
    completionType,
    statement.body,
    statement.bodyFallible,
    statement.bodyTerminates,
    statement.asynchronous,
    depth,
  );
  let flowFallible = statement.bodyFallible;
  if (statement.catchClause === undefined) {
    lines.push(`${indent}let ${statement.flowName} = ${statement.bodyName};`);
  } else {
    const catchClause = statement.catchClause;
    const flowType = catchClause.fallible
      ? `rt::TsonicResult<${completionTypeText}>`
      : completionTypeText;
    const flowAssignment = `${indent}let ${statement.flowName}: ${flowType} =`;
    const inlineFlowMatchPrefix = `${flowAssignment} match ${statement.bodyName}`;
    const catchUsesBlock = statement.asynchronous;
    const matchWithBraceFits = renderedFits(`${inlineFlowMatchPrefix} {`, 0);
    const matchHeaderFits = renderedFits(inlineFlowMatchPrefix, 0);
    const matchDepth = matchHeaderFits ? depth : depth + 1;
    const matchIndent = indentText(matchDepth);
    const armIndent = indentText(matchDepth + 1);
    const catchExpression = printRustCompletionCaptureExpression(
      catchClause.body,
      catchClause.fallible,
      catchClause.terminates,
      statement.asynchronous,
      matchDepth + (catchUsesBlock ? 2 : 1),
    );
    const catchArm = catchExpression.length === 1
      ? [`${armIndent}Err(${catchClause.binding}) => ${catchExpression[0]},`]
      : catchUsesBlock
        ? [
          `${armIndent}Err(${catchClause.binding}) => {`,
          `${indentText(matchDepth + 2)}${catchExpression[0]}`,
          ...catchExpression.slice(1),
          `${armIndent}}`,
        ]
        : [
            `${armIndent}Err(${catchClause.binding}) => ${catchExpression[0]}`,
            ...catchExpression.slice(1, -1),
            `${catchExpression[catchExpression.length - 1]},`,
          ];
    lines.push(
      ...(matchWithBraceFits
        ? [`${inlineFlowMatchPrefix} {`]
        : matchHeaderFits
          ? [inlineFlowMatchPrefix, `${matchIndent}{`]
          : [flowAssignment, `${matchIndent}match ${statement.bodyName} {`]),
      `${armIndent}Ok(completion) => ${catchClause.fallible ? "Ok(completion)" : "completion"},`,
      ...catchArm,
      `${matchIndent}};`,
    );
    flowFallible = catchClause.fallible;
  }
  if (statement.finallyClause !== undefined && statement.finallyName !== undefined) {
    const finallyClause = statement.finallyClause;
    lines.push(...printRustCompletionCapture(
      statement.finallyName,
      completionType,
      finallyClause.body,
      finallyClause.fallible,
      finallyClause.terminates,
      statement.asynchronous,
      depth,
    ));
    if (flowFallible || finallyClause.fallible) {
      const bodyResult = flowFallible ? statement.flowName : `Ok(${statement.flowName})`;
      const finallyResult = finallyClause.fallible
        ? statement.finallyName
        : `Ok(${statement.finallyName})`;
      lines.push(
        `${indent}let ${statement.flowName}: rt::TsonicResult<${completionTypeText}> =`,
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
    lines.push(`${indent}let ${statement.flowName} = ${statement.flowName}?;`);
  }
  lines.push(...printCompletionDispatch(statement, depth));
  return lines.join("\n");
}

function printRustCompletionCapture(
  name: string,
  completionType: RustType,
  body: RustBlock,
  fallible: boolean,
  terminates: boolean,
  asynchronous: boolean,
  depth: number,
): string[] {
  const indent = indentText(depth);
  const captureType = fallible
    ? rustAppliedType("rt::TsonicResult", [completionType])
    : completionType;
  const inlineExpression = printRustCompletionCaptureExpression(
    body,
    fallible,
    terminates,
    asynchronous,
    depth,
  );
  const declarationPrefix = `${indent}let ${name}: `;
  const renderedCaptureType = printRustTypeFitted(
    captureType,
    depth,
    declarationPrefix.length,
    " = x".length,
  );
  const prefix = appendToLastLine(`${declarationPrefix}${renderedCaptureType}`, " = ");
  if (inlineExpression.length === 1) {
    const assignment = `${prefix}${inlineExpression[0]};`;
    return renderedFits(assignment, 0)
      ? [assignment]
      : [`${prefix.trimEnd()}`, `${indentText(depth + 1)}${inlineExpression[0]};`];
  }
  if (renderedFits(`${prefix}${inlineExpression[0]}`, 0) &&
    lastLineLength(prefix) + inlineExpression[0]!.length <= rustFormatWidth - 4) {
    return [
      `${prefix}${inlineExpression[0]}`,
      ...inlineExpression.slice(1, -1),
      `${inlineExpression[inlineExpression.length - 1]};`,
    ];
  }
  const continuationExpression = printRustCompletionCaptureExpression(
    body,
    fallible,
    terminates,
    asynchronous,
    depth + 1,
  );
  return [
    `${prefix.trimEnd()}`,
    `${indentText(depth + 1)}${continuationExpression[0]}`,
    ...continuationExpression.slice(1, -1),
    `${continuationExpression[continuationExpression.length - 1]};`,
  ];
}

function rustAppliedType(path: string, arguments_: readonly RustType[]): RustType {
  return {
    kind: "named",
    path,
    genericArguments: arguments_.map((type) => ({ kind: "type" as const, type })),
  };
}

function printRustCompletionCaptureExpression(
  body: RustBlock,
  fallible: boolean,
  terminates: boolean,
  asynchronous: boolean,
  depth: number,
): string[] {
  const indent = indentText(depth);
  const nested = indentText(depth + 1);
  if (!asynchronous && !terminates && body.statements.length === 0) {
    return [fallible
      ? "rt::completion_region(|| Ok(rt::Completion::Normal))"
      : "rt::completion_region(|| rt::Completion::Normal)"];
  }
  if (asynchronous && !terminates && body.statements.length === 0) {
    return [fallible
      ? "(async { Ok(rt::Completion::Normal) }).await"
      : "(async { rt::Completion::Normal }).await"];
  }
  if (!asynchronous && terminates && body.statements.length === 1) {
    const only = printRustStmt(body.statements[0]!, depth + 1).trim();
    if (!only.includes("\n") && !only.endsWith(";")) {
      return [`rt::completion_region(|| ${only})`];
    }
  }
  const renderedBody = printRustBlockStatements(body, depth + 1);
  const normal = fallible
    ? `${nested}Ok(rt::Completion::Normal)`
    : `${nested}rt::Completion::Normal`;
  return [
    asynchronous ? "(async {" : "rt::completion_region(|| {",
    ...(renderedBody.length === 0 ? [] : [renderedBody]),
    ...(terminates ? [] : [normal]),
    ...(asynchronous
      ? [`${indent}})`, `${indent}.await`]
      : [`${indent}})`]),
  ];
}

function printRustResourceScope(
  statement: Extract<RustStmt, { readonly kind: "resource-scope" }>,
  depth: number,
): string {
  const indent = indentText(depth);
  const nested = indentText(depth + 1);
  const completionType = `rt::Completion<${printRustType(statement.returnType)}>`;
  const body = printRustBlockStatements(statement.body, depth + 1);
  const nestedCleanup = printRustBlockStatements(statement.cleanup, depth + 1);
  const directCleanup = printRustBlockStatements(statement.cleanup, depth);
  const bodyTail = statement.fallible
    ? `${nested}Ok(rt::Completion::Normal)`
    : `${nested}rt::Completion::Normal`;
  const cleanupTail = statement.fallible ? `${nested}Ok(())` : undefined;
  const bodyType = statement.fallible
    ? `rt::TsonicResult<${completionType}>`
    : completionType;
  const bodyCompletesNormally = !statement.terminates;
  const directBody = printDirectResourceBody(statement.body, depth + 1);
  const requiresBoundary = statement.fallible || rustBlockHasCompletionExit(statement.body);
  const directAssignment = directBody === undefined
    ? undefined
    : `${indent}let ${statement.flowName}: ${bodyType} = ${directBody.trimStart()}`;
  const lines = body.length === 0
    ? [printRustFlatLetInitializer(
        `${indent}let ${statement.flowName}: ${bodyType} = `,
        bodyTail.trim(),
        depth,
      )]
    : directBody !== undefined
      ? directAssignment !== undefined && renderedFits(directAssignment, 0)
        ? [directAssignment]
        : [
            `${indent}let ${statement.flowName}: ${bodyType} =`,
            directBody,
          ]
      : !requiresBoundary
        ? [
            `${indent}let ${statement.flowName}: ${bodyType} = {`,
            body,
            ...(bodyCompletesNormally ? [bodyTail] : []),
            `${indent}};`,
          ]
    : [
        `${indent}let ${statement.flowName}: ${bodyType} = ${statement.asynchronous ? "(async {" : "(|| {"}`,
        body,
        ...(bodyCompletesNormally ? [bodyTail] : []),
        statement.asynchronous ? `${indent}})\n${indent}.await;` : `${indent}})();`,
      ];
  if (statement.fallible) {
    if (nestedCleanup.length === 0) {
      lines.push(statement.asynchronous
        ? `${indent}let ${statement.cleanupName}: rt::TsonicResult<()> = (async { Ok(()) }).await;`
        : `${indent}let ${statement.cleanupName}: rt::TsonicResult<()> = (|| Ok(()))();`);
    } else {
      lines.push(
        `${indent}let ${statement.cleanupName}: rt::TsonicResult<()> = ${statement.asynchronous ? "(async {" : "(|| {"}`,
        nestedCleanup,
        cleanupTail!,
        statement.asynchronous ? `${indent}})\n${indent}.await;` : `${indent}})();`,
      );
    }
    lines.push(printRustFlatLetInitializer(
      `${indent}let ${statement.flowName} = `,
      `rt::finish_resource(${statement.flowName}, ${statement.cleanupName})?`,
      depth,
    ));
  } else if (statement.asynchronous) {
    if (nestedCleanup.length > 0) {
      lines.push(
        `${indent}(async {`,
        nestedCleanup,
        `${indent}})`,
        `${indent}.await;`,
      );
    }
  } else if (directCleanup.length > 0) {
    lines.push(directCleanup);
  }
  lines.push(...printCompletionDispatch(statement, depth));
  return lines.join("\n");
}

function rustBlockHasCompletionExit(block: RustBlock): boolean {
  return block.statements.some((statement): boolean => {
    if (statement.kind === "completion-exit") {
      return true;
    }
    if (statement.kind === "resource-scope") {
      return statement.propagate;
    }
    if (statement.kind === "if") {
      return rustBlockHasCompletionExit(statement.then) ||
        (statement.else !== undefined && rustBlockHasCompletionExit(statement.else));
    }
    if (statement.kind === "if-let-some") {
      return rustBlockHasCompletionExit(statement.body) ||
        (statement.else !== undefined && rustBlockHasCompletionExit(statement.else));
    }
    if (statement.kind === "loop" || statement.kind === "while" || statement.kind === "while-let-some" ||
      statement.kind === "for" ||
      statement.kind === "scope" || statement.kind === "unsafe-scope") {
      return rustBlockHasCompletionExit(statement.body);
    }
    if (statement.kind === "try-scope") {
      return statement.propagate;
    }
    return false;
  });
}

function nestedMarkedElseIf(
  marked: true | undefined,
  block: RustBlock,
): Extract<RustStmt, { readonly kind: "if" | "if-let-some" }> | undefined {
  if (marked !== true || block.statements.length !== 1 ||
    (block.innerAttrs?.length ?? 0) !== 0) {
    return undefined;
  }
  const nested = block.statements[0];
  if (nested?.kind !== "if" && nested?.kind !== "if-let-some") {
    return undefined;
  }
  return nested.kind === "if" && (nested.attrs?.length ?? 0) !== 0
    ? undefined
    : nested;
}

function printDirectResourceBody(body: RustBlock, depth: number): string | undefined {
  if (body.statements.length !== 1) {
    return undefined;
  }
  const statement = body.statements[0]!;
  const isTail = statement.kind === "tail" ||
    (statement.kind === "throw" && statement.tail === true) ||
    (statement.kind === "completion-exit" && statement.tail === true);
  if (!isTail) {
    return undefined;
  }
  return `${printRustStmt(statement, depth)};`;
}

function printCompletionDispatch(
  statement: {
    readonly flowName: string;
    readonly fallible: boolean;
    readonly tail?: true;
    readonly propagate: boolean;
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
    arms.push(
      `${armIndent}completion => ${returnsAsTail ? "" : "return "}${statement.fallible ? "Ok(completion)" : "completion"},`,
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
  const renderedTarget = printRustExprFitted(target, depth, indent.length);
  const inlinePrefix = `${indent}${renderedTarget} ${operator} `;
  const inlineValue = printRustExprFitted(value, depth, lastLineLength(inlinePrefix));
  if (!renderedTarget.includes("\n") && !inlineValue.includes("\n") &&
    renderedFits(`${inlinePrefix}${inlineValue};`, 0)) {
    return `${inlinePrefix}${inlineValue};`;
  }
  const continuationIndent = indentText(depth + 1);
  const continuationValue = printRustExprFitted(value, depth + 1, continuationIndent.length);
  const continuationAvoidsNestedExpansion = inlineValue.includes("\n") &&
    !continuationValue.includes("\n");
  const continuationCompactsMatchHeader = value.kind === "match" &&
    !firstLine(inlineValue).trimEnd().endsWith("{") &&
    firstLine(continuationValue).trimEnd().endsWith("{");
  const multilineValueCanFollowAssignment = value.kind !== "binary" ||
    value.operator === "&&" || value.operator === "||";
  if (!renderedTarget.includes("\n") &&
    (!inlineValue.includes("\n") ||
      multilineValueCanFollowAssignment && !continuationAvoidsNestedExpansion &&
        !continuationCompactsMatchHeader) &&
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
  if (expression.kind === "try" &&
    (expression.expr.kind === "call" || expression.expr.kind === "associated-call")) {
    const callable = expression.expr.kind === "call"
      ? printRustDirectCallTarget(expression.expr)
      : printRustAssociatedCallTarget(
          expression.expr,
          printRustAssociatedCallOwner(expression.expr),
        );
    const flat = printRustExpr(expression.expr);
    const flatArguments = expression.expr.args.map(printRustExpr).join(", ");
    const forceExpanded = !renderedFits(`${flat}?`, column) ||
      expression.expr.args.length > 1 && flatArguments.length > rustNestedCallWidth &&
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
  if (expression.kind === "try" && expression.expr.kind === "method-call") {
    const chain = rustMethodChain(expression.expr);
    const firstMethodRequiresExpansion = chain !== undefined &&
      rustMethodChainFirstMethodRequiresExpansion(chain, depth);
    const attachedStatementBlockArgument = expression.expr.args.length === 1 &&
      expressionIsRightHandBlock(expression.expr.args[0]!);
    if (chain !== undefined &&
      !attachedStatementBlockArgument &&
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
  label?: string,
): string {
  const indent = indentText(depth);
  const prefix = `${label === undefined ? "" : `'${label}: `}${keyword} `;
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
  const header = (conditionEnding === ")" || conditionEnding === "}" ||
      conditionEnding.endsWith("})") ||
      conditionEnding.endsWith(")?")) &&
      conditionEndingIndent === indent.length &&
      conditionEndingLine.length + 2 <= rustFormatWidth
    ? appendToLastLine(conditionHeader, " {")
    : `${conditionHeader}\n${indent}{`;
  return body.length === 0
    ? `${header}}`
    : `${header}\n${body}\n${indent}}`;
}
