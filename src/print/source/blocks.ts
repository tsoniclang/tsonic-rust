import { printRustExpr } from "./expressions/core.js";
import { indentText, printRustType } from "./types.js";
import type { RustBlock, RustExpr, RustStmt } from "../../backend/target-ast/nodes.js";

export function printRustBlockStatements(block: RustBlock, depth: number): string {
  return [
    ...(block.innerAttrs ?? []).map((attribute) => `${indentText(depth)}${attribute}`),
    ...block.statements.map((statement) => printRustStmt(statement, depth)),
  ].join("\n");
}

function printRustBlock(block: RustBlock, depth: number, header: string): string {
  const indent = indentText(depth);
  const body = printRustBlockStatements(block, depth + 1);
  return body.length === 0
    ? `${indent}${header} {}`
    : `${indent}${header} {\n${body}\n${indent}}`;
}

function printRustStmt(statement: RustStmt, depth: number): string {
  const indent = indentText(depth);
  switch (statement.kind) {
    case "let": {
      const attributes = printRustStatementAttributes(statement.attrs, depth);
      const type = statement.type === undefined ? "" : `: ${printRustType(statement.type)}`;
      const initializer = statement.init === undefined ? "" : ` = ${printRustExpr(statement.init)}`;
      return `${attributes}${indent}let ${statement.mutable ? "mut " : ""}${statement.name}${type}${initializer};`;
    }
    case "expr":
      return `${indent}${printRustExpr(statement.expr)};`;
    case "assign":
      return `${indent}${printRustExpr(statement.target)} ${statement.operator} ${printRustExpr(statement.value)};`;
    case "return":
      return statement.expr === undefined
        ? `${indent}return;`
        : `${indent}return ${printRustExpr(statement.expr)};`;
    case "tail":
      return `${indent}${printRustExpr(statement.expr)}`;
    case "if": {
      const attributes = printRustStatementAttributes(statement.attrs, depth);
      const rendered = printRustBlock(
        statement.then,
        depth,
        `if ${printRustExpr(statement.condition)}`,
      );
      if (statement.else === undefined) {
        return `${attributes}${rendered}`;
      }
      const nested = nestedMarkedElseIf(statement.elseIf, statement.else);
      if (nested !== undefined) {
        const nestedText = printRustStmt(nested, depth).slice(indent.length);
        return `${attributes}${rendered} else ${nestedText}`;
      }
      const otherwise = printRustBlockStatements(statement.else, depth + 1);
      return `${attributes}${rendered} else ${otherwise.length === 0
        ? "{}"
        : `{\n${otherwise}\n${indent}}`}`;
    }
    case "loop":
      return printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}loop`,
      );
    case "while": {
      const block = printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}while ${printRustExpr(statement.condition)}`,
      );
      return `${printRustStatementAttributes(statement.attrs, depth)}${block}`;
    }
    case "while-let-some":
      return printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}while let Some(${statement.bindingMutable === true ? "mut " : ""}${statement.binding}) = ${printRustExpr(statement.expression)}`,
      );
    case "for": {
      const block = printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}for ${statement.bindingMutable === true ? "mut " : ""}${statement.binding} in ${printRustExpr(statement.iterable)}`,
      );
      return `${printRustStatementAttributes(statement.attrs, depth)}${block}`;
    }
    case "if-let-some": {
      const rendered = printRustBlock(
        statement.body,
        depth,
        `if let Some(${statement.binding}) = ${printRustExpr(statement.expression)}`,
      );
      if (statement.else === undefined) {
        return rendered;
      }
      const nested = nestedMarkedElseIf(statement.elseIf, statement.else);
      if (nested !== undefined) {
        return `${rendered} else ${printRustStmt(nested, depth).slice(indent.length)}`;
      }
      const otherwise = printRustBlockStatements(statement.else, depth + 1);
      return `${rendered} else ${otherwise.length === 0
        ? "{}"
        : `{\n${otherwise}\n${indent}}`}`;
    }
    case "break":
      return `${indent}break${statement.label === undefined ? "" : ` '${statement.label}`};`;
    case "continue":
      return `${indent}continue${statement.label === undefined ? "" : ` '${statement.label}`};`;
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
      return statement.tail === true
        ? `${indent}${printRustExpr(value)}`
        : `${indent}return ${printRustExpr(value)};`;
    }
    case "resource-scope":
      return printRustResourceScope(statement, depth);
    case "index-assign":
      return `${indent}${printRustExpr(statement.receiver)}[${printRustExpr(statement.index)}] = ${printRustExpr(statement.value)};`;
    case "scope": {
      const body = printRustBlockStatements(statement.body, depth + 1);
      const label = statement.label === undefined ? "" : `'${statement.label}: `;
      return body.length === 0
        ? `${indent}${label}{}`
        : `${indent}${label}{\n${body}\n${indent}}`;
    }
    case "unsafe-scope":
      return printRustBlock(statement.body, depth, "unsafe");
    case "throw": {
      const result = `Err(${printRustExpr(statement.error)})`;
      return statement.tail === true ? `${indent}${result}` : `${indent}return ${result};`;
    }
    case "try-scope":
      return printRustTryScope(statement, depth);
  }
}

function printRustStatementAttributes(
  attrs: readonly string[] | undefined,
  depth: number,
): string {
  const indent = indentText(depth);
  return attrs?.map((attribute) => `${indent}${attribute}\n`).join("") ?? "";
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

function printRustTryScope(
  statement: Extract<RustStmt, { readonly kind: "try-scope" }>,
  depth: number,
): string {
  const indent = indentText(depth);
  const nested = indentText(depth + 1);
  const completionType = `rt::Completion<${printRustType(statement.returnType)}>`;
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
      ? `rt::TsonicResult<${completionType}>`
      : completionType;
    const catchExpression = printRustCompletionCaptureExpression(
      catchClause.body,
      catchClause.fallible,
      catchClause.terminates,
      statement.asynchronous,
      depth + (statement.asynchronous ? 2 : 1),
    );
    const armIndent = indentText(depth + 1);
    const catchArm = catchExpression.length === 1
      ? [`${armIndent}Err(${catchClause.binding}) => ${catchExpression[0]},`]
      : statement.asynchronous
        ? [
            `${armIndent}Err(${catchClause.binding}) => {`,
            `${indentText(depth + 2)}${catchExpression[0]}`,
            ...catchExpression.slice(1),
            `${armIndent}}`,
          ]
        : [
            `${armIndent}Err(${catchClause.binding}) => ${catchExpression[0]}`,
            ...catchExpression.slice(1, -1),
            `${catchExpression[catchExpression.length - 1]},`,
          ];
    lines.push(
      `${indent}let ${statement.flowName}: ${flowType} = match ${statement.bodyName} {`,
      `${armIndent}Ok(completion) => ${catchClause.fallible ? "Ok(completion)" : "completion"},`,
      ...catchArm,
      `${indent}};`,
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
    lines.push(`${indent}let ${statement.flowName} = ${statement.flowName}?;`);
  }
  lines.push(...printCompletionDispatch(statement, depth));
  return lines.join("\n");
}

function printRustCompletionCapture(
  name: string,
  completionType: string,
  body: RustBlock,
  fallible: boolean,
  terminates: boolean,
  asynchronous: boolean,
  depth: number,
): string[] {
  const indent = indentText(depth);
  const captureType = fallible
    ? `rt::TsonicResult<${completionType}>`
    : completionType;
  const expression = printRustCompletionCaptureExpression(
    body,
    fallible,
    terminates,
    asynchronous,
    depth,
  );
  const prefix = `${indent}let ${name}: ${captureType} = `;
  return expression.length === 1
    ? [`${prefix}${expression[0]};`]
    : [
        `${prefix}${expression[0]}`,
        ...expression.slice(1, -1),
        `${expression[expression.length - 1]};`,
      ];
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
  if (!terminates && body.statements.length === 0) {
    if (asynchronous) {
      return [fallible
        ? "(async { Ok(rt::Completion::Normal) }).await"
        : "(async { rt::Completion::Normal }).await"];
    }
    return [fallible
      ? "rt::completion_region(|| Ok(rt::Completion::Normal))"
      : "rt::completion_region(|| rt::Completion::Normal)"];
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
  const bodyType = statement.fallible
    ? `rt::TsonicResult<${completionType}>`
    : completionType;
  const directBody = printDirectResourceBody(statement.body, depth + 1);
  const requiresBoundary = statement.fallible || rustBlockHasCompletionExit(statement.body);
  const lines = body.length === 0
    ? [`${indent}let ${statement.flowName}: ${bodyType} = ${bodyTail.trim()};`]
    : directBody !== undefined
      ? [`${indent}let ${statement.flowName}: ${bodyType} = ${directBody.trimStart()}`]
      : !requiresBoundary
        ? [
            `${indent}let ${statement.flowName}: ${bodyType} = {`,
            body,
            ...(!statement.terminates ? [bodyTail] : []),
            `${indent}};`,
          ]
        : [
            `${indent}let ${statement.flowName}: ${bodyType} = ${statement.asynchronous ? "(async {" : "(|| {"}`,
            body,
            ...(!statement.terminates ? [bodyTail] : []),
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
        `${nested}Ok(())`,
        statement.asynchronous ? `${indent}})\n${indent}.await;` : `${indent}})();`,
      );
    }
    lines.push(
      `${indent}let ${statement.flowName} = rt::finish_resource(${statement.flowName}, ${statement.cleanupName})?;`,
    );
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
    if (statement.kind === "resource-scope" || statement.kind === "try-scope") {
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
    if (statement.kind === "loop" || statement.kind === "while" ||
      statement.kind === "while-let-some" || statement.kind === "for" ||
      statement.kind === "scope" || statement.kind === "unsafe-scope") {
      return rustBlockHasCompletionExit(statement.body);
    }
    return false;
  });
}

function printDirectResourceBody(body: RustBlock, depth: number): string | undefined {
  if (body.statements.length !== 1) {
    return undefined;
  }
  const statement = body.statements[0]!;
  const isTail = statement.kind === "tail" ||
    (statement.kind === "throw" && statement.tail === true) ||
    (statement.kind === "completion-exit" && statement.tail === true);
  return isTail ? `${printRustStmt(statement, depth)};` : undefined;
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
      arms.push(`${armIndent}rt::Completion::Break(${target.id}) => break '${target.label},`);
      if (target.kind !== "loop") {
        continue;
      }
      const prelude = target.continuePrelude ?? [];
      if (prelude.length === 0) {
        arms.push(`${armIndent}rt::Completion::Continue(${target.id}) => continue '${target.label},`);
      } else {
        arms.push(
          `${armIndent}rt::Completion::Continue(${target.id}) => {`,
          printRustBlockStatements({ statements: prelude }, depth + 2),
          `${indentText(depth + 2)}continue '${target.label};`,
          `${armIndent}}`,
        );
      }
    }
    const unmatched = [
      ...(statement.dispatchReturn ? [] : ["rt::Completion::Return(_)"]),
      "rt::Completion::Break(_)",
      "rt::Completion::Continue(_)",
    ].join(" | ");
    arms.push(
      `${armIndent}${unmatched} => {`,
      `${indentText(depth + 2)}unreachable!("invalid finalized Tsonic completion target")`,
      `${armIndent}}`,
    );
  }
  return [`${indent}match ${statement.flowName} {`, ...arms, `${indent}}`];
}
