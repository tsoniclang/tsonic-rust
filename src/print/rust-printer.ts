import type {
  RustBlock,
  RustExpr,
  RustItem,
  RustSourceFileModel,
  RustStmt,
  RustType,
} from "../backend/rust-ast/nodes.js";
import type { RustAssignmentOperator } from "../common/rust-syntax.js";

// Deterministic printer. Output must be `cargo fmt --check` clean for the
// supported construct set: 4-space indent, no trailing whitespace, one blank
// line between items, trailing newline.

const rustFormatWidth = 100;
const rustNestedCallWidth = 60;
const rustMethodChainWidth = 60;

export function printRustSourceFile(model: RustSourceFileModel): string {
  const parts: string[] = [`// ${model.headerComment}`];
  for (const item of model.items) {
    parts.push("");
    parts.push(printRustItem(item));
  }
  return `${parts.join("\n")}\n`;
}

export function printRustItem(item: RustItem): string {
  switch (item.kind) {
    case "mod-decl": {
      return `${item.pub ? "pub " : ""}mod ${item.name};`;
    }
    case "use": {
      return item.alias === undefined ? `use ${item.path};` : `use ${item.path} as ${item.alias};`;
    }
    case "const": {
      const constAttrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const prefix = `${constAttrs}${item.pub ? "pub " : ""}const ${item.name}: ${printRustType(item.type)} = `;
      return `${prefix}${printRustExprFitted(item.value, 0, lastLineLength(prefix) + 1)};`;
    }
    case "struct": {
      const structAttrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const header = `${structAttrs}${derives}${item.pub ? "pub " : ""}struct ${item.name} {`;
      const fields = item.fields.map((field) => `    ${field.pub ? "pub " : ""}${field.name}: ${printRustType(field.type)},`).join("\n");
      return fields.length === 0 ? `${header}}` : `${header}\n${fields}\n}`;
    }
    case "enum": {
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const variants = item.variants
        .map((variant) => `    ${variant.name}${variant.discriminant === undefined ? "" : ` = ${variant.discriminant}`},`)
        .join("\n");
      return `${derives}${item.pub ? "pub " : ""}enum ${item.name} {\n${variants}\n}`;
    }
    case "impl": {
      const rendered = item.functions.map((fn) => {
        const selfPrefix = fn.selfParam === undefined ? "" : fn.selfParam === "ref" ? "&self" : "&mut self";
        const params = fn.params.map((param) => `${param.mutable === true ? "mut " : ""}${param.name}: ${printRustType(param.type)}`);
        const allParams = selfPrefix.length === 0 ? params : [selfPrefix, ...params];
        const returnSuffix = fn.fallible === true
          ? ` -> rt::TsonicResult<${fn.returnType === undefined ? "()" : printRustType(fn.returnType)}>`
          : fn.returnType === undefined ? "" : ` -> ${printRustType(fn.returnType)}`;
        const fnAttrs = (fn.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
        const header = `${fnAttrs}${printRustFunctionHeader(`    ${fn.pub ? "pub " : ""}${fn.isAsync === true ? "async " : ""}fn `, fn.name, "", allParams, returnSuffix, 1)}`;
        const body = printRustBlockStatements(fn.body, 2);
        return body.length === 0 ? `${header}}` : `${header}\n${body}\n    }`;
      }).join("\n\n");
      return `impl ${item.name} {\n${rendered}\n}`;
    }
    case "function": {
      const params = item.params.map((param) => `${param.mutable === true ? "mut " : ""}${param.name}: ${printRustType(param.type)}`);
      const generics = item.typeParams === undefined || item.typeParams.length === 0
        ? ""
        : `<${item.typeParams.map(printRustTypeParameter).join(", ")}>`;
      const returnSuffix = item.fallible === true
        ? ` -> rt::TsonicResult<${item.returnType === undefined ? "()" : printRustType(item.returnType)}>`
        : item.returnType === undefined ? "" : ` -> ${printRustType(item.returnType)}`;
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const header = `${attrs}${printRustFunctionHeader(
        `${item.pub ? "pub " : ""}${item.isAsync === true ? "async " : ""}fn `,
        item.name,
        generics,
        params,
        returnSuffix,
        0,
      )}`;
      const body = printRustBlockStatements(item.body, 1);
      return body.length === 0 ? `${header}}` : `${header}\n${body}\n}`;
    }
  }
}

function printRustFunctionHeader(
  prefix: string,
  name: string,
  generics: string,
  parameters: readonly string[],
  returnSuffix: string,
  depth: number,
): string {
  const flat = `${prefix}${name}${generics}(${parameters.join(", ")})${returnSuffix} {`;
  if (flat.length <= rustFormatWidth || parameters.length === 0) {
    return flat;
  }
  const parameterIndent = indentText(depth + 1);
  const closingIndent = indentText(depth);
  return [
    `${prefix}${name}${generics}(`,
    ...parameters.map((parameter) => `${parameterIndent}${parameter},`),
    `${closingIndent})${returnSuffix} {`,
  ].join("\n");
}

function printRustTypeParameter(parameter: import("../backend/rust-ast/nodes.js").RustTypeParameter): string {
  if (parameter.bounds.length === 0) {
    return parameter.name;
  }
  const bounds = parameter.bounds.map((bound) =>
    bound.kind === "trait" ? bound.path : `'${bound.name}`);
  return `${parameter.name}: ${bounds.join(" + ")}`;
}

export function printRustType(type: RustType): string {
  switch (type.kind) {
    case "primitive": {
      return type.name;
    }
    case "string": {
      return "String";
    }
    case "str-ref": {
      return "&str";
    }
    case "unit": {
      return "()";
    }
    case "named": {
      const args = [
        ...(type.lifetimeArguments ?? []).map((lifetime) => `'${lifetime}`),
        ...(type.typeArguments ?? []).map(printRustType),
      ];
      return args.length === 0
        ? type.path
        : `${type.path}<${args.join(", ")}>`;
    }
    case "fixed-array": {
      return `[${printRustType(type.element)}; ${type.length}]`;
    }
    case "slice-ref": {
      return `${type.mutable ? "&mut " : "&"}[${printRustType(type.element)}]`;
    }
    case "tuple": {
      const elements = type.elements.map(printRustType).join(", ");
      return `(${elements}${type.elements.length === 1 ? "," : ""})`;
    }
  }
}

function indentText(depth: number): string {
  return "    ".repeat(depth);
}

function printRustBlockStatements(block: RustBlock, depth: number): string {
  return block.statements.map((statement) => printRustStmt(statement, depth)).join("\n");
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
      const typeSuffix = statement.type === undefined ? "" : `: ${printRustType(statement.type)}`;
      const prefix = `${indent}let ${mutability}${statement.name}${typeSuffix} = `;
      const flat = printRustExpr(statement.init);
      if (!renderedFits(flat, prefix.length + 1) &&
        renderedFits(flat, indent.length + 4 + 1)) {
        return `${prefix.trimEnd()}\n${indentText(depth + 1)}${flat};`;
      }
      return `${prefix}${printRustExprFitted(statement.init, depth, prefix.length + 1)};`;
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
      return `${indent}${printRustExprFitted(statement.expr, depth, indent.length)}`;
    }
    case "if": {
      const rendered = printRustConditionalBlock("if", statement.condition, statement.then, depth);
      if (statement.else === undefined) {
        return rendered;
      }
      const elseBody = printRustBlockStatements(statement.else, depth + 1);
      const indentStr = indentText(depth);
      const withoutTrailing = rendered.endsWith("{}") ? `${rendered.slice(0, -2)}{\n${indentStr}}` : rendered;
      return elseBody.length === 0
        ? `${withoutTrailing} else {}`
        : `${withoutTrailing} else {\n${elseBody}\n${indentStr}}`;
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
      return statement.label === undefined
        ? rendered
        : `${indent}'${statement.label}: ${rendered.slice(indent.length)}`;
    }
    case "while-let-some": {
      return printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}while let Some(${statement.bindingMutable === true ? "mut " : ""}${statement.binding}) = ${printRustExpr(statement.expression)}`,
      );
    }
    case "for": {
      return printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}for ${statement.bindingMutable === true ? "mut " : ""}${statement.binding} in ${printRustExpr(statement.iterable)}`,
      );
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
      const completion = statement.completion === "return"
        ? `rt::Completion::Return(${statement.expr === undefined ? "()" : printRustExpr(statement.expr)})`
        : statement.completion === "break"
          ? `rt::Completion::Break(${statement.loopId ?? 0})`
          : `rt::Completion::Continue(${statement.loopId ?? 0})`;
      const value = statement.resultWrapped ? `Ok(${completion})` : completion;
      return statement.tail === true
        ? `${indent}${value}`
        : `${indent}return ${value};`;
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
      return body.length === 0 ? `${indent}{}` : `${indent}{\n${body}\n${indent}}`;
    }
    case "throw": {
      return [
        `${indent}${statement.tail === true ? "" : "return "}Err(rt::TsonicError::from(rt::JsError::new(`,
        `${indent}    rt::JsErrorKind::Error,`,
        `${indent}    ${printRustExpr(statement.message)},`,
        `${indent})))${statement.tail === true ? "" : ";"}`,
      ].join("\n");
    }
    case "try-catch": {
      const tryBody = printRustBlockStatements(statement.body, depth + 1);
      const okTail = `${indentText(depth + 1)}Ok(())`;
      const catchBody = printRustBlockStatements(statement.catchBody, depth + 1);
      const catchClause = catchBody.length === 0
        ? `${indent}let _ = __try;`
        : [
            `${indent}if let Err(${statement.catchBinding}) = __try {`,
            catchBody,
            `${indent}}`,
          ].join("\n");
      const lines = [
        `${indent}let __try: rt::TsonicResult<()> = (|| {`,
        ...(tryBody.length === 0 ? [] : [tryBody]),
        okTail,
        `${indent}})();`,
        catchClause,
      ];
      return lines.join("\n");
    }
  }
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
  const lines = body.length === 0
    ? [`${indent}let ${statement.flowName}: ${bodyType} = ${bodyTail.trim()};`]
    : directBody !== undefined
      ? [
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
    lines.push(
      `${indent}let ${statement.flowName} =`,
      `${nested}rt::finish_resource(${statement.flowName}, ${statement.cleanupName})?;`,
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
    if (statement.kind === "resource-scope") {
      return statement.propagate;
    }
    if (statement.kind === "if") {
      return rustBlockHasCompletionExit(statement.then) ||
        (statement.else !== undefined && rustBlockHasCompletionExit(statement.else));
    }
    if (statement.kind === "loop" || statement.kind === "while" || statement.kind === "while-let-some" ||
      statement.kind === "for" || statement.kind === "if-let-some" || statement.kind === "scope") {
      return rustBlockHasCompletionExit(statement.body);
    }
    if (statement.kind === "try-catch") {
      return rustBlockHasCompletionExit(statement.body) ||
        rustBlockHasCompletionExit(statement.catchBody);
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
  if (!isTail) {
    return undefined;
  }
  return `${printRustStmt(statement, depth)};`;
}

function printCompletionDispatch(
  statement: Extract<RustStmt, { readonly kind: "resource-scope" }>,
  depth: number,
): readonly string[] {
  const indent = indentText(depth);
  const armIndent = indentText(depth + 1);
  const arms: string[] = statement.terminates
    ? [
        `${armIndent}rt::Completion::Normal => {`,
        `${indentText(depth + 2)}unreachable!("terminating Tsonic resource scope completed normally")`,
        `${armIndent}}`,
      ]
    : [`${armIndent}rt::Completion::Normal => {}`];
  if (statement.propagate) {
    arms.push(
      `${armIndent}completion => ${statement.terminates ? "" : "return "}${statement.fallible ? "Ok(completion)" : "completion"},`,
    );
  } else {
    if (statement.dispatchReturn) {
      arms.push(
        `${armIndent}rt::Completion::Return(value) => ${statement.terminates ? "" : "return "}${statement.fallible ? "Ok(value)" : "value"},`,
      );
    }
    for (const target of statement.dispatchLoops) {
      arms.push(
        `${armIndent}rt::Completion::Break(${target.id}) => break '${target.label},`,
      );
      if (target.continuePrelude.length === 0) {
        arms.push(`${armIndent}rt::Completion::Continue(${target.id}) => continue '${target.label},`);
      } else {
        const prelude = printRustBlockStatements(
          { statements: target.continuePrelude },
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
  operator: RustAssignmentOperator,
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
  if (!renderedTarget.includes("\n") &&
    inlinePrefix.length + firstLine(inlineValue).length <= rustFormatWidth) {
    return `${inlinePrefix}${inlineValue};`;
  }
  const continuationIndent = indentText(depth + 1);
  const renderedValue = printRustExprFitted(value, depth + 1, continuationIndent.length);
  return `${indent}${renderedTarget} ${operator}\n${continuationIndent}${renderedValue};`;
}

function printRustStatementExpr(
  expression: RustExpr,
  depth: number,
  column: number,
): string {
  if (expression.kind === "try" && expression.expr.kind === "call") {
    return appendToLastLine(
      printFittedCall(
        expression.expr.path,
        expression.expr.args,
        depth,
        column + 1,
        false,
        true,
      ),
      "?",
    );
  }
  return printRustExprFitted(expression, depth, column);
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
  );
  if (!renderedCondition.includes("\n")) {
    return printRustBlock(block, depth, `${prefix}${renderedCondition}`);
  }
  const body = printRustBlockStatements(block, depth + 1);
  const header = `${indent}${prefix}${renderedCondition}\n${indent}{`;
  return body.length === 0
    ? `${header}}`
    : `${header}\n${body}\n${indent}}`;
}

const enum RustPrecedence {
  Assignment = 0,
  Or = 1,
  And = 2,
  Comparison = 3,
  Additive = 4,
  Multiplicative = 5,
  Unary = 6,
  Postfix = 7,
  Atom = 8,
}

function operatorPrecedence(operator: string): RustPrecedence {
  switch (operator) {
    case "||":
      return RustPrecedence.Or;
    case "&&":
      return RustPrecedence.And;
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return RustPrecedence.Comparison;
    case "+":
    case "-":
      return RustPrecedence.Additive;
    default:
      return RustPrecedence.Multiplicative;
  }
}

function expressionPrecedence(expression: RustExpr): RustPrecedence {
  switch (expression.kind) {
    case "assignment":
      return RustPrecedence.Assignment;
    case "binary":
      return operatorPrecedence(expression.operator);
    case "unary":
    case "reference":
      return RustPrecedence.Unary;
    case "method-call":
    case "field":
    case "index":
    case "await":
      return RustPrecedence.Postfix;
    default:
      return RustPrecedence.Atom;
  }
}

function printOperand(operand: RustExpr, parent: RustPrecedence, isRightSide: boolean): string {
  const own = expressionPrecedence(operand);
  const needsParens =
    own < parent ||
    (own === parent && (isRightSide || parent === RustPrecedence.Comparison));
  const text = printRustExpr(operand);
  return needsParens ? `(${text})` : text;
}

export function printRustExpr(expression: RustExpr): string {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal": {
      return expression.text;
    }
    case "bool-literal": {
      return expression.value ? "true" : "false";
    }
    case "none": {
      return "None";
    }
    case "string-literal": {
      return `String::from("${escapeRustString(expression.value)}")`;
    }
    case "str-literal": {
      return `"${escapeRustString(expression.value)}"`;
    }
    case "path": {
      return expression.path;
    }
    case "unary": {
      return `${expression.operator}${printOperand(expression.operand, RustPrecedence.Unary, false)}`;
    }
    case "binary": {
      const precedence = operatorPrecedence(expression.operator);
      const left = printOperand(expression.left, precedence, false);
      const right = printOperand(expression.right, precedence, true);
      return `${left} ${expression.operator} ${right}`;
    }
    case "conditional": {
      return `if ${printRustExpr(expression.condition)} { ${printRustExpr(expression.whenTrue)} } else { ${printRustExpr(expression.whenFalse)} }`;
    }
    case "assignment": {
      return `${printRustExpr(expression.target)} ${expression.operator} ${printRustExpr(expression.value)}`;
    }
    case "call": {
      return `${expression.path}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "associated-call": {
      return `${printRustAssociatedOwner(expression.owner)}::${expression.method}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "method-call": {
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      return `${receiver}.${expression.method}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "field": {
      return `${printOperand(expression.receiver, RustPrecedence.Postfix, false)}.${expression.name}`;
    }
    case "index": {
      return `${printOperand(expression.receiver, RustPrecedence.Postfix, false)}[${printRustExpr(expression.index)}]`;
    }
    case "block": {
      const bindings = expression.bindings
        .map((binding) => `let ${binding.name} = ${printRustExpr(binding.value)};`)
        .join(" ");
      return `{ ${bindings}${bindings.length === 0 ? "" : " "}${printRustExpr(expression.value)} }`;
    }
    case "evaluate-then": {
      return `{ let _ = ${printRustExpr(expression.effect)}; ${printRustExpr(expression.value)} }`;
    }
    case "string-concat": {
      const placeholders = expression.parts.map(() => "{}").join("");
      return `format!("${placeholders}", ${expression.parts.map(printRustExpr).join(", ")})`;
    }
    case "reference": {
      const prefix = expression.mutable === true ? "&mut " : "&";
      return `${prefix}${printOperand(expression.expr, RustPrecedence.Unary, false)}`;
    }
    case "vec-literal": {
      return `vec![${expression.elements.map(printRustExpr).join(", ")}]`;
    }
    case "slice-literal": {
      return `[${expression.elements.map(printRustExpr).join(", ")}]`;
    }
    case "closure": {
      const params = expression.params
        .map((param) => (param.byRefCopy ? `&${param.name}` : param.name))
        .join(", ");
      return expression.body.kind === "assignment"
        ? `|${params}| { ${printRustExpr(expression.body)} }`
        : `|${params}| ${printRustExpr(expression.body)}`;
    }
    case "closure-block": {
      const params = expression.params
        .map((param) => `${param.mutable ? "mut " : ""}${param.name}`)
        .join(", ");
      const prefix = `${expression.move ? "move " : ""}|${params}| ${expression.async ? "async move " : ""}{`;
      const body = printRustBlockStatements(expression.body, 1);
      return body.length === 0 ? `${prefix}}` : `${prefix}\n${body}\n}`;
    }
    case "await": {
      return `${printOperand(expression.expr, RustPrecedence.Postfix, false)}.await`;
    }
    case "try": {
      return `${printOperand(expression.expr, RustPrecedence.Postfix, false)}?`;
    }
    case "tuple-literal": {
      const elements = expression.elements.map(printRustExpr).join(", ");
      return `(${elements}${expression.elements.length === 1 ? "," : ""})`;
    }
    case "struct-literal": {
      if (expression.fields.length === 0) {
        return `${expression.path} {}`;
      }
      const fields = expression.fields
        .map((field) => {
          const value = printRustExpr(field.value);
          return value === field.name ? field.name : `${field.name}: ${value}`;
        })
        .join(", ");
      return `${expression.path} { ${fields} }`;
    }

  }
}

function printRustExprFitted(expression: RustExpr, depth: number, column: number): string {
  const flat = printRustExpr(expression);
  switch (expression.kind) {
    case "conditional": {
      const branchIndent = indentText(depth + 1);
      const condition = printRustExprFitted(
        expression.condition,
        depth,
        column + "if ".length,
      );
      const whenTrue = printRustExprFitted(
        expression.whenTrue,
        depth + 1,
        branchIndent.length,
      );
      const whenFalse = printRustExprFitted(
        expression.whenFalse,
        depth + 1,
        branchIndent.length,
      );
      return [
        `if ${condition} {`,
        `${branchIndent}${whenTrue}`,
        `${indentText(depth)}} else {`,
        `${branchIndent}${whenFalse}`,
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "block": {
      const statementIndent = indentText(depth + 1);
      const bindings = expression.bindings.map((binding) => {
        const prefix = `${statementIndent}let ${binding.name} = `;
        return appendToLastLine(
          `${prefix}${printRustExprFitted(binding.value, depth + 1, prefix.length)}`,
          ";",
        );
      });
      const value = printRustExprFitted(
        expression.value,
        depth + 1,
        statementIndent.length,
      );
      return [
        "{",
        ...bindings,
        `${statementIndent}${value}`,
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "evaluate-then": {
      const statementIndent = indentText(depth + 1);
      const effectPrefix = `${statementIndent}let _ = `;
      const effect = printRustExprFitted(expression.effect, depth + 1, effectPrefix.length);
      const value = printRustExprFitted(expression.value, depth + 1, statementIndent.length);
      return [
        "{",
        `${effectPrefix}${effect};`,
        `${statementIndent}${value}`,
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "call":
      return printFittedCall(expression.path, expression.args, depth, column);
    case "associated-call":
      return printFittedCall(
        `${printRustAssociatedOwner(expression.owner)}::${expression.method}`,
        expression.args,
        depth,
        column,
      );
    case "method-call": {
      const chain = rustMethodChain(expression);
      if (renderedFits(flat, column) && !rustMethodChainRequiresVerticalLayout(expression)) {
        return flat;
      }
      if (chain !== undefined &&
        (rustMethodChainRequiresVerticalLayout(expression) ||
          rustMethodChainBreaksReceiverWhenExpanded(chain))) {
        return printFittedMethodChain(chain, depth, column);
      }
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      return printFittedCall(`${receiver}.${expression.method}`, expression.args, depth, column);
    }
    case "closure": {
      if (renderedFits(flat, column)) {
        return flat;
      }
      const params = expression.params
        .map((param) => (param.byRefCopy ? `&${param.name}` : param.name))
        .join(", ");
      const indent = indentText(depth + 1);
      const body = printRustExprFitted(
        expression.body,
        depth + 1,
        indent.length,
      );
      return [`|${params}| {`, `${indent}${body}`, `${indentText(depth)}}`].join("\n");
    }
    case "closure-block": {
      const params = expression.params
        .map((param) => `${param.mutable ? "mut " : ""}${param.name}`)
        .join(", ");
      const prefix = `${expression.move ? "move " : ""}|${params}| ${expression.async ? "async move " : ""}{`;
      const body = printRustBlockStatements(expression.body, depth + 1);
      return body.length === 0
        ? `${prefix}}`
        : `${prefix}\n${body}\n${indentText(depth)}}`;
    }
    case "await":
      return appendToLastLine(
        printRustExprFitted(expression.expr, depth, column),
        ".await",
      );
    case "try":
      return appendToLastLine(printRustExprFitted(expression.expr, depth, column + 1), "?");
    case "reference": {
      const prefix = expression.mutable === true ? "&mut " : "&";
      return `${prefix}${printRustExprFitted(expression.expr, depth, column + prefix.length)}`;
    }
    case "unary": {
      const operand = printRustExprFitted(expression.operand, depth, column + 1);
      return expressionPrecedence(expression.operand) < RustPrecedence.Unary
        ? `${expression.operator}(${operand})`
        : `${expression.operator}${operand}`;
    }
    case "binary": {
      if (renderedFits(flat, column)) {
        return flat;
      }
      if (expression.operator === "||" || expression.operator === "&&") {
        return printFittedLogicalChain(expression, expression.operator, depth, column);
      }
      const left = printRustExprFitted(expression.left, depth, column);
      const joined = appendToLastLine(
        left,
        ` ${expression.operator} ${printOperand(expression.right, operatorPrecedence(expression.operator), true)}`,
      );
      if (!rustMethodChainRequiresVerticalLayout(expression.left) && renderedFits(joined, column)) {
        return joined;
      }
      const continuationIndent = indentText(depth + 1);
      const right = printRustExprFitted(
        expression.right,
        depth + 1,
        continuationIndent.length + expression.operator.length + 1,
      );
      const continuation = `${continuationIndent}${expression.operator} ${firstLine(right)}`;
      return remainingLines(right).length === 0
        ? `${left}\n${continuation}`
        : `${left}\n${continuation}\n${remainingLines(right).join("\n")}`;
    }
    case "vec-literal":
    case "slice-literal": {
      if (renderedFits(flat, column)) {
        return flat;
      }
      const elementIndent = indentText(depth + 1);
      const elements = expression.elements.map((element) => {
        const rendered = printRustExprFitted(element, depth + 1, elementIndent.length);
        return appendToLastLine(`${elementIndent}${rendered}`, ",");
      });
      return [
        expression.kind === "vec-literal" ? "vec![" : "[",
        ...elements,
        `${indentText(depth)}]`,
      ].join("\n");
    }
    case "struct-literal": {
      if (expression.fields.length <= 2 && renderedFits(flat, column)) {
        return flat;
      }
      const fieldIndent = indentText(depth + 1);
      const fields = expression.fields.map((field) => {
        const flatValue = printRustExpr(field.value);
        if (flatValue === field.name) {
          return `${fieldIndent}${field.name},`;
        }
        const prefix = `${fieldIndent}${field.name}: `;
        const value = printRustExprFitted(
          field.value,
          depth + 1,
          prefix.length,
        );
        return appendToLastLine(`${prefix}${value}`, ",");
      });
      return [
        `${expression.path} {`,
        ...fields,
        `${indentText(depth)}}`,
      ].join("\n");
    }
    default:
      return flat;
  }
}

function printRustAssociatedOwner(owner: RustType): string {
  if (owner.kind !== "named" || owner.typeArguments === undefined || owner.typeArguments.length === 0) {
    return printRustType(owner);
  }
  return `${owner.path}::<${owner.typeArguments.map(printRustType).join(", ")}>`;
}

function printFittedLogicalChain(
  expression: Extract<RustExpr, { readonly kind: "binary" }>,
  operator: "||" | "&&",
  depth: number,
  column: number,
): string {
  const operands: RustExpr[] = [];
  collectLogicalOperands(expression, operator, operands);
  const first = operands[0];
  if (first === undefined) {
    return printRustExpr(expression);
  }
  let rendered = printRustExprFitted(first, depth, column);
  const continuationIndent = indentText(depth + 1);
  for (const operand of operands.slice(1)) {
    const right = printRustExprFitted(
      operand,
      depth + 1,
      continuationIndent.length + operator.length + 1,
    );
    rendered += `\n${continuationIndent}${operator} ${firstLine(right)}`;
    const rest = remainingLines(right);
    if (rest.length > 0) {
      rendered += `\n${rest.join("\n")}`;
    }
  }
  return rendered;
}

function collectLogicalOperands(
  expression: RustExpr,
  operator: "||" | "&&",
  operands: RustExpr[],
): void {
  if (expression.kind === "binary" && expression.operator === operator) {
    collectLogicalOperands(expression.left, operator, operands);
    collectLogicalOperands(expression.right, operator, operands);
    return;
  }
  operands.push(expression);
}

interface RustMethodChain {
  readonly base: RustExpr;
  readonly steps: readonly RustMethodChainStep[];
}

type RustMethodChainStep =
  | { readonly kind: "method"; readonly name: string; readonly args: readonly RustExpr[] }
  | { readonly kind: "try" };

function rustMethodChain(expression: RustExpr): RustMethodChain | undefined {
  const steps: RustMethodChainStep[] = [];
  const base = collectRustMethodChain(expression, steps);
  return steps.some((step) => step.kind === "method") ? { base, steps } : undefined;
}

function rustMethodChainRequiresVerticalLayout(expression: RustExpr): boolean {
  const chain = rustMethodChain(expression);
  return chain !== undefined &&
    printRustExpr(expression).length > rustMethodChainWidth &&
    chain.steps.filter((step) => step.kind === "method").length > 1;
}

function rustMethodChainBreaksReceiverWhenExpanded(chain: RustMethodChain): boolean {
  return chain.steps.filter((step) => step.kind === "method").length > 1 ||
    chain.steps.some((step, index) =>
      step.kind === "try" && chain.steps[index + 1]?.kind === "method");
}

function collectRustMethodChain(expression: RustExpr, steps: RustMethodChainStep[]): RustExpr {
  if (expression.kind === "method-call") {
    const base = collectRustMethodChain(expression.receiver, steps);
    steps.push({ kind: "method", name: expression.method, args: expression.args });
    return base;
  }
  if (expression.kind === "try") {
    const base = collectRustMethodChain(expression.expr, steps);
    steps.push({ kind: "try" });
    return base;
  }
  return expression;
}

function printFittedMethodChain(
  chain: RustMethodChain,
  depth: number,
  column: number,
): string {
  const flatBase = printRustExpr(chain.base);
  let rendered = renderedFits(flatBase, column)
    ? flatBase
    : printRustExprFitted(chain.base, depth, column);
  const continuationIndent = indentText(depth + 1);
  for (const step of chain.steps) {
    if (step.kind === "try") {
      rendered = appendToLastLine(rendered, "?");
      continue;
    }
    const method = printFittedCall(
      `.${step.name}`,
      step.args,
      depth + 1,
      continuationIndent.length,
    );
    rendered = `${rendered}\n${continuationIndent}${method}`;
  }
  return rendered;
}

function printFittedCall(
  callable: string,
  arguments_: readonly RustExpr[],
  depth: number,
  column: number,
  forceExpanded = false,
  preferNestedBreak = false,
): string {
  const flat = `${callable}(${arguments_.map(printRustExpr).join(", ")})`;
  if (arguments_.length === 0) {
    return flat;
  }
  if (arguments_.length === 1 && arguments_[0]?.kind === "block") {
    const prefix = `${callable}(`;
    return appendToLastLine(
      `${prefix}${printRustExprFitted(
        arguments_[0],
        depth,
        column + prefix.length,
      )}`,
      ")",
    );
  }
  if (!forceExpanded && arguments_.length === 1) {
    const prefix = `${callable}(`;
    const argument = arguments_[0]!;
    if (argument.kind === "call" || argument.kind === "associated-call" ||
      argument.kind === "method-call" || argument.kind === "try") {
      const nested = printNestedCallArgument(argument, depth, column + prefix.length, false);
      const nestedAtExpandedColumn = printNestedCallArgument(
        argument,
        depth + 1,
        indentText(depth + 1).length + 1,
        false,
      );
      const compact = appendToLastLine(`${prefix}${nested}`, ")");
      if (!rustMethodChainRequiresVerticalLayout(argument) &&
        !(argument.kind !== "call" && argument.kind !== "associated-call" &&
          nested.includes("\n") &&
          !nestedAtExpandedColumn.includes("\n")) &&
        renderedFits(compact, column)) {
        return compact;
      }
      if (preferNestedBreak && !rustMethodChainRequiresVerticalLayout(argument)) {
        const forcedNested = printNestedCallArgument(
          argument,
          depth,
          column + prefix.length,
          true,
        );
        const forcedCompact = appendToLastLine(`${prefix}${forcedNested}`, ")");
        if (renderedFits(forcedCompact, column)) {
          return forcedCompact;
        }
      }
    } else if (argument.kind === "unary" &&
      argument.operand.kind === "associated-call") {
      const nested = printNestedCallArgument(
        argument.operand,
        depth,
        column + prefix.length + argument.operator.length,
        false,
      );
      const compact = appendToLastLine(
        `${prefix}${argument.operator}${nested}`,
        ")",
      );
      if (renderedFits(compact, column)) {
        return compact;
      }
    } else if (argument.kind === "closure" || argument.kind === "closure-block") {
      const rendered = printRustExprFitted(
        argument,
        depth,
        column + prefix.length,
      );
      const compact = appendToLastLine(`${prefix}${rendered}`, ")");
      if (argument.kind === "closure-block" || renderedFits(compact, column)) {
        return compact;
      }
    } else if (argument.kind === "reference" &&
      (argument.expr.kind === "slice-literal" || argument.expr.kind === "vec-literal")) {
      const rendered = printRustExprFitted(
        argument,
        depth,
        column + prefix.length,
      );
      const compact = appendToLastLine(`${prefix}${rendered}`, ")");
      if (renderedFits(compact, column)) {
        return compact;
      }
    } else if (renderedFits(flat, column)) {
      return flat;
    }
  } else if (!forceExpanded && renderedFits(flat, column)) {
    return flat;
  }
  const argumentIndent = indentText(depth + 1);
  if (forceExpanded && arguments_.length > 1 && flat.length <= rustNestedCallWidth) {
    const compactArguments = arguments_.map(printRustExpr).join(", ");
    if (!compactArguments.includes("\n") && renderedFits(`${compactArguments},`, argumentIndent.length)) {
      return [
        `${callable}(`,
        `${argumentIndent}${compactArguments},`,
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  const renderedArguments = arguments_.map((argument) => {
    const rendered = printRustExprFitted(argument, depth + 1, argumentIndent.length + 1);
    return appendToLastLine(`${argumentIndent}${rendered}`, ",");
  });
  return [
    `${callable}(`,
    ...renderedArguments,
    `${indentText(depth)})`,
  ].join("\n");
}

function printNestedCallArgument(
  argument: Extract<RustExpr, { readonly kind: "call" | "associated-call" | "method-call" | "try" }>,
  depth: number,
  column: number,
  forceExpanded: boolean,
): string {
  if (argument.kind === "try") {
    const inner = argument.expr;
    if (inner.kind === "call" && (forceExpanded || printRustExpr(inner).length > rustNestedCallWidth)) {
      return appendToLastLine(
        printFittedCall(inner.path, inner.args, depth, column + 1, true),
        "?",
      );
    }
    if (inner.kind === "associated-call" &&
      (forceExpanded || printRustExpr(inner).length > rustNestedCallWidth)) {
      return appendToLastLine(
        printFittedCall(
          `${printRustAssociatedOwner(inner.owner)}::${inner.method}`,
          inner.args,
          depth,
          column + 1,
          true,
        ),
        "?",
      );
    }
    if (inner.kind === "method-call" &&
      (forceExpanded || rustMethodChainRequiresVerticalLayout(inner))) {
      const receiver = printOperand(inner.receiver, RustPrecedence.Postfix, false);
      return appendToLastLine(
        printFittedCall(`${receiver}.${inner.method}`, inner.args, depth, column + 1, true),
        "?",
      );
    }
    return printRustExprFitted(argument, depth, column);
  }
  if (!forceExpanded && printRustExpr(argument).length <= rustNestedCallWidth) {
    const flat = printRustExpr(argument);
    if (renderedFits(flat, column)) {
      return flat;
    }
    if (argument.kind === "call" || argument.kind === "associated-call") {
      return printFittedCall(
        argument.kind === "call"
          ? argument.path
          : `${printRustAssociatedOwner(argument.owner)}::${argument.method}`,
        argument.args,
        depth,
        column,
        true,
      );
    }
    const receiver = printOperand(argument.receiver, RustPrecedence.Postfix, false);
    return printFittedCall(`${receiver}.${argument.method}`, argument.args, depth, column, true);
  }
  if (argument.kind === "call" || argument.kind === "associated-call") {
    return printFittedCall(
      argument.kind === "call"
        ? argument.path
        : `${printRustAssociatedOwner(argument.owner)}::${argument.method}`,
      argument.args,
      depth,
      column,
      true,
    );
  }
  const receiver = printOperand(argument.receiver, RustPrecedence.Postfix, false);
  return printFittedCall(`${receiver}.${argument.method}`, argument.args, depth, column, true);
}

function renderedFits(rendered: string, firstColumn: number): boolean {
  const lines = rendered.split("\n");
  return lines.every((line, index) => (index === 0 ? firstColumn : 0) + line.length <= rustFormatWidth);
}

function appendToLastLine(rendered: string, suffix: string): string {
  const lines = rendered.split("\n");
  const lastIndex = lines.length - 1;
  lines[lastIndex] = `${lines[lastIndex] ?? ""}${suffix}`;
  return lines.join("\n");
}

function firstLine(rendered: string): string {
  return rendered.split("\n", 1)[0] ?? "";
}

function remainingLines(rendered: string): readonly string[] {
  return rendered.split("\n").slice(1);
}

function lastLineLength(rendered: string): number {
  const lines = rendered.split("\n");
  return lines[lines.length - 1]?.length ?? 0;
}

export function escapeRustString(value: string): string {
  let escaped = "";
  for (const character of value) {
    switch (character) {
      case "\\":
        escaped += "\\\\";
        break;
      case '"':
        escaped += '\\"';
        break;
      case "\n":
        escaped += "\\n";
        break;
      case "\r":
        escaped += "\\r";
        break;
      case "\t":
        escaped += "\\t";
        break;
      case "\0":
        escaped += "\\0";
        break;
      default:
        escaped += character;
    }
  }
  return escaped;
}
