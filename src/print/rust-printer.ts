import type {
  RustBlock,
  RustExpr,
  RustItem,
  RustSourceFileModel,
  RustStmt,
  RustType,
} from "../backend/rust-ast/nodes.js";

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
        const params = fn.params.map((param) => `${param.mutable === true ? "mut " : ""}${param.name}: ${printRustType(param.type)}`).join(", ");
        const allParams = selfPrefix.length === 0 ? params : params.length === 0 ? selfPrefix : `${selfPrefix}, ${params}`;
        const returnSuffix = fn.fallible === true
          ? ` -> rt::TsonicResult<${fn.returnType === undefined ? "()" : printRustType(fn.returnType)}>`
          : fn.returnType === undefined ? "" : ` -> ${printRustType(fn.returnType)}`;
        const fnAttrs = (fn.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
        const header = `${fnAttrs}    ${fn.pub ? "pub " : ""}fn ${fn.name}(${allParams})${returnSuffix} {`;
        const body = printRustBlockStatements(fn.body, 2);
        return body.length === 0 ? `${header}}` : `${header}\n${body}\n    }`;
      }).join("\n\n");
      return `impl ${item.name} {\n${rendered}\n}`;
    }
    case "function": {
      const params = item.params.map((param) => `${param.mutable === true ? "mut " : ""}${param.name}: ${printRustType(param.type)}`).join(", ");
      const generics = item.typeParams === undefined || item.typeParams.length === 0 ? "" : `<${item.typeParams.join(", ")}>`;
      const returnSuffix = item.fallible === true
        ? ` -> rt::TsonicResult<${item.returnType === undefined ? "()" : printRustType(item.returnType)}>`
        : item.returnType === undefined ? "" : ` -> ${printRustType(item.returnType)}`;
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const header = `${attrs}${item.pub ? "pub " : ""}${item.isAsync === true ? "async " : ""}fn ${item.name}${generics}(${params})${returnSuffix} {`;
      const body = printRustBlockStatements(item.body, 1);
      return body.length === 0 ? `${header}}` : `${header}\n${body}\n}`;
    }
  }
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
      const args = type.typeArguments ?? [];
      return args.length === 0
        ? type.path
        : `${type.path}<${args.map(printRustType).join(", ")}>`;
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
      const target = printRustExprFitted(statement.target, depth, indent.length);
      const prefix = `${indent}${target} ${statement.operator} `;
      return `${prefix}${printRustExprFitted(statement.value, depth, lastLineLength(prefix) + 1)};`;
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
    case "while": {
      return printRustConditionalBlock("while", statement.condition, statement.body, depth);
    }
    case "for": {
      return printRustBlock(statement.body, depth, `for ${statement.binding} in ${printRustExpr(statement.iterable)}`);
    }
    case "index-assign": {
      const receiver = printOperand(statement.receiver, RustPrecedence.Postfix, false);
      const index = printRustExprFitted(statement.index, depth, indent.length + receiver.length + 1);
      const prefix = `${indent}${receiver}[${index}] = `;
      return `${prefix}${printRustExprFitted(statement.value, depth, lastLineLength(prefix) + 1)};`;
    }
    case "scope": {
      const body = printRustBlockStatements(statement.body, depth + 1);
      return body.length === 0 ? `${indent}{}` : `${indent}{\n${body}\n${indent}}`;
    }
    case "throw": {
      return [
        `${indent}return Err(rt::TsonicError::from(rt::JsError::new(`,
        `${indent}    rt::JsErrorKind::Error,`,
        `${indent}    ${printRustExpr(statement.message)},`,
        `${indent})));`,
      ].join("\n");
    }
    case "try-catch": {
      const tryBody = printRustBlockStatements(statement.body, depth + 1);
      const okTail = `${indentText(depth + 1)}Ok(())`;
      const catchBody = printRustBlockStatements(statement.catchBody, depth + 1);
      const lines = [
        `${indent}let __try: rt::TsonicResult<()> = (|| {`,
        ...(tryBody.length === 0 ? [] : [tryBody]),
        okTail,
        `${indent}})();`,
        `${indent}if let Err(${statement.catchBinding}) = __try {`,
        ...(catchBody.length === 0 ? [] : [catchBody]),
        `${indent}}`,
      ];
      return lines.join("\n");
    }
  }
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
    case "binary":
      return operatorPrecedence(expression.operator);
    case "unary":
    case "reference":
      return RustPrecedence.Unary;
    case "method-call":
    case "field":
    case "index":
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
    case "call": {
      return `${expression.path}(${expression.args.map(printRustExpr).join(", ")})`;
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
      return `|${params}| ${printRustExpr(expression.body)}`;
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
    case "try":
      return appendToLastLine(printRustExprFitted(expression.expr, depth, column + 1), "?");
    case "reference": {
      const prefix = expression.mutable === true ? "&mut " : "&";
      return `${prefix}${printRustExprFitted(expression.expr, depth, column + prefix.length)}`;
    }
    case "unary":
      return `${expression.operator}${printRustExprFitted(expression.operand, depth, column + 1)}`;
    case "binary": {
      if (renderedFits(flat, column)) {
        return flat;
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
    default:
      return flat;
  }
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
  if (!forceExpanded && arguments_.length === 1) {
    const prefix = `${callable}(`;
    const argument = arguments_[0]!;
    if (argument.kind === "call" || argument.kind === "method-call" || argument.kind === "try") {
      const nested = printNestedCallArgument(argument, depth, column + prefix.length, false);
      const nestedAtExpandedColumn = printNestedCallArgument(
        argument,
        depth + 1,
        indentText(depth + 1).length + 1,
        false,
      );
      const compact = appendToLastLine(`${prefix}${nested}`, ")");
      if (!rustMethodChainRequiresVerticalLayout(argument) &&
        !(argument.kind !== "call" && nested.includes("\n") &&
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
    } else if (renderedFits(flat, column)) {
      return flat;
    }
  } else if (!forceExpanded && renderedFits(flat, column)) {
    return flat;
  }
  const argumentIndent = indentText(depth + 1);
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
  argument: Extract<RustExpr, { readonly kind: "call" | "method-call" | "try" }>,
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
    return printRustExprFitted(argument, depth, column);
  }
  if (argument.kind === "call") {
    return printFittedCall(argument.path, argument.args, depth, column, true);
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
