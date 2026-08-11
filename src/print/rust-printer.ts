import type {
  RustBlock,
  RustExpr,
  RustItem,
  RustSourceFileModel,
  RustStmt,
  RustType,
  RustVisibility,
} from "../backend/rust-ast/nodes.js";
import type { RustAssignmentOperator } from "../common/rust-syntax.js";

// Deterministic printer. Output must be `cargo fmt --check` clean for the
// supported construct set: 4-space indent, no trailing whitespace, one blank
// line between items, trailing newline.

const rustFormatWidth = 100;
const rustStructLiteralWidth = 18;
const rustNestedCallWidth = 60;
const rustMethodChainWidth = 60;
const rustInlineFieldReceiverWidth = 28;
const rustFormatMacroInlineArgumentLimit = 4;

function printRustVisibility(visibility: RustVisibility): string {
  return visibility === "public" ? "pub " : visibility === "crate" ? "pub(crate) " : "";
}

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
      return `${printRustVisibility(item.visibility)}mod ${item.name};`;
    }
    case "use": {
      return item.alias === undefined ? `use ${item.path};` : `use ${item.path} as ${item.alias};`;
    }
    case "const": {
      const constAttrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const prefix = `${constAttrs}${printRustVisibility(item.visibility)}const ${item.name}: ${printRustType(item.type)} = `;
      return `${prefix}${printRustExprFitted(item.value, 0, lastLineLength(prefix) + 1)};`;
    }
    case "thread-local": {
      const attrs = (item.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
      const declaration = `${printRustVisibility(item.visibility)}static ${item.name}: ${printRustType(item.type)} = const { ${printRustExpr(item.value)} };`;
      return `std::thread_local! {\n${attrs}    ${declaration}\n}`;
    }
    case "struct": {
      const structAttrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const header = `${structAttrs}${derives}${printRustVisibility(item.visibility)}struct ${item.name} {`;
      const fields = item.fields.map((field) => `    ${printRustVisibility(field.visibility)}${field.name}: ${printRustType(field.type)},`).join("\n");
      return fields.length === 0 ? `${header}}` : `${header}\n${fields}\n}`;
    }
    case "enum": {
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const variants = item.variants
        .map((variant) => `    ${variant.name}${variant.discriminant === undefined ? "" : ` = ${variant.discriminant}`},`)
        .join("\n");
      return `${derives}${printRustVisibility(item.visibility)}enum ${item.name} {\n${variants}\n}`;
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
        const header = `${fnAttrs}${printRustFunctionHeader(`    ${printRustVisibility(fn.visibility)}${fn.isAsync === true ? "async " : ""}fn `, fn.name, "", allParams, returnSuffix, 1)}`;
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
        `${printRustVisibility(item.visibility)}${item.isAsync === true ? "async " : ""}fn `,
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
    case "function-pointer": {
      const abiName = type.abi?.length === 1 && type.abi[0] !== "target-default"
        ? type.abi[0]
        : undefined;
      const abi = abiName === undefined ? "" : `extern ${JSON.stringify(abiName)} `;
      return `${abi}fn(${type.parameters.map(printRustType).join(", ")}) -> ${printRustType(type.result)}`;
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
      const typeSuffix = statement.type === undefined ? "" : `: ${printRustType(statement.type)}`;
      const attributes = statement.attrs?.map((attribute) => `${indent}${attribute}\n`).join("") ?? "";
      if (statement.init === undefined) {
        return `${attributes}${indent}let ${mutability}${statement.name}${typeSuffix};`;
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
      return printRustForBlock(statement, depth);
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
      const prefix = statement.label === undefined ? "" : `'${statement.label}: `;
      return body.length === 0
        ? `${indent}${prefix}{}`
        : `${indent}${prefix}{\n${body}\n${indent}}`;
    }
    case "throw": {
      return [
        `${indent}${statement.tail === true ? "" : "return "}Err(rt::TsonicError::from(rt::JsError::new(`,
        `${indent}    rt::JsErrorKind::Error,`,
        `${indent}    ${printRustExpr(statement.message)},`,
        `${indent})))${statement.tail === true ? "" : ";"}`,
      ].join("\n");
    }
    case "try-scope": {
      return printRustTryScope(statement, depth);
    }
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
    const catchExpression = printRustCompletionCaptureExpression(
      completionType,
      catchClause.body,
      catchClause.fallible,
      catchClause.terminates,
      statement.asynchronous,
      depth + 1,
    );
    const flowType = catchClause.fallible
      ? `rt::TsonicResult<${completionType}>`
      : completionType;
    const catchArm = catchExpression.length === 1
      ? [`${nested}Err(${catchClause.binding}) => ${catchExpression[0]},`]
      : [
          `${nested}Err(${catchClause.binding}) => ${catchExpression[0]}`,
          ...catchExpression.slice(1, -1),
          `${catchExpression[catchExpression.length - 1]},`,
        ];
    lines.push(
      `${indent}let ${statement.flowName}: ${flowType} = match ${statement.bodyName} {`,
      `${nested}Ok(completion) => ${catchClause.fallible ? "Ok(completion)" : "completion"},`,
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
    completionType,
    body,
    fallible,
    terminates,
    asynchronous,
    depth,
  );
  if (expression.length === 1) {
    const assignment = `${indent}let ${name}: ${captureType} = ${expression[0]};`;
    return renderedFits(assignment, 0)
      ? [assignment]
      : [`${indent}let ${name}: ${captureType} =`, `${indentText(depth + 1)}${expression[0]};`];
  }
  return [
    `${indent}let ${name}: ${captureType} = ${expression[0]}`,
    ...expression.slice(1, -1),
    `${expression[expression.length - 1]};`,
  ];
}

function printRustCompletionCaptureExpression(
  _completionType: string,
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
    if (statement.kind === "try-scope") {
      return statement.propagate;
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
  statement: {
    readonly flowName: string;
    readonly fallible: boolean;
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
  const arms: string[] = statement.terminates
    ? [
        `${armIndent}rt::Completion::Normal => {`,
        `${indentText(depth + 2)}unreachable!("terminating Tsonic completion scope completed normally")`,
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
  const multilineValueCanFollowAssignment = value.kind !== "binary" ||
    value.operator === "&&" || value.operator === "||";
  if (!renderedTarget.includes("\n") &&
    (!inlineValue.includes("\n") || multilineValueCanFollowAssignment) &&
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
  Cast = 7,
  Postfix = 8,
  Atom = 9,
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
    case "range":
      return RustPrecedence.Or;
    case "binary":
      return operatorPrecedence(expression.operator);
    case "unary":
    case "reference":
      return RustPrecedence.Unary;
    case "numeric-cast":
      return RustPrecedence.Cast;
    case "method-call":
    case "invoke":
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

function printBinaryOperand(
  operand: RustExpr,
  operator: string,
  isRightSide: boolean,
): string {
  const rendered = printOperand(operand, operatorPrecedence(operator), isRightSide);
  return operand.kind === "numeric-cast" &&
      (operator === "<" || operator === "<=" || operator === ">" || operator === ">=")
    ? `(${rendered})`
    : rendered;
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
    case "numeric-cast": {
      return `${printOperand(expression.expression, RustPrecedence.Cast, false)} as ${expression.target}`;
    }
    case "binary": {
      const left = printBinaryOperand(expression.left, expression.operator, false);
      const right = printBinaryOperand(expression.right, expression.operator, true);
      return `${left} ${expression.operator} ${right}`;
    }
    case "range": {
      return `${printOperand(expression.start, RustPrecedence.Or, false)}..${printOperand(expression.end, RustPrecedence.Or, true)}`;
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
    case "invoke": {
      return `${printOperand(expression.callee, RustPrecedence.Postfix, false)}(${expression.args.map(printRustExpr).join(", ")})`;
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
        .map((binding) => `${binding.attrs?.join(" ") ?? ""}${binding.attrs === undefined ? "" : " "}let ${binding.name} = ${printRustExpr(binding.value)};`)
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
      const params = printRustClosureParams(expression.params);
      return `|${params}| ${printRustExpr(expression.body)}`;
    }
    case "closure-block": {
      const params = printRustClosureParams(expression.params);
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

function rustExpressionContainsStatementBlock(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "block":
    case "evaluate-then":
      return true;
    case "unary":
      return rustExpressionContainsStatementBlock(expression.operand);
    case "numeric-cast":
      return rustExpressionContainsStatementBlock(expression.expression);
    case "binary":
      return rustExpressionContainsStatementBlock(expression.left) ||
        rustExpressionContainsStatementBlock(expression.right);
    case "range":
      return rustExpressionContainsStatementBlock(expression.start) ||
        rustExpressionContainsStatementBlock(expression.end);
    case "conditional":
      return rustExpressionContainsStatementBlock(expression.condition) ||
        rustExpressionContainsStatementBlock(expression.whenTrue) ||
        rustExpressionContainsStatementBlock(expression.whenFalse);
    case "assignment":
      return rustExpressionContainsStatementBlock(expression.target) ||
        rustExpressionContainsStatementBlock(expression.value);
    case "call":
    case "invoke":
    case "associated-call":
      return (expression.kind === "invoke" && rustExpressionContainsStatementBlock(expression.callee)) ||
        expression.args.some(rustExpressionContainsStatementBlock);
    case "method-call":
      return rustExpressionContainsStatementBlock(expression.receiver) ||
        expression.args.some(rustExpressionContainsStatementBlock);
    case "field":
      return rustExpressionContainsStatementBlock(expression.receiver);
    case "index":
      return rustExpressionContainsStatementBlock(expression.receiver) ||
        rustExpressionContainsStatementBlock(expression.index);
    case "string-concat":
      return expression.parts.some(rustExpressionContainsStatementBlock);
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements.some(rustExpressionContainsStatementBlock);
    case "reference":
    case "await":
    case "try":
      return rustExpressionContainsStatementBlock(expression.expr);
    case "closure":
      return rustExpressionContainsStatementBlock(expression.body);
    case "struct-literal":
      return expression.fields.some((field) => rustExpressionContainsStatementBlock(field.value));
    default:
      return false;
  }
}

function rustExpressionContainsClosure(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "closure":
    case "closure-block":
      return true;
    case "unary":
      return rustExpressionContainsClosure(expression.operand);
    case "numeric-cast":
      return rustExpressionContainsClosure(expression.expression);
    case "binary":
      return rustExpressionContainsClosure(expression.left) || rustExpressionContainsClosure(expression.right);
    case "range":
      return rustExpressionContainsClosure(expression.start) || rustExpressionContainsClosure(expression.end);
    case "conditional":
      return rustExpressionContainsClosure(expression.condition) ||
        rustExpressionContainsClosure(expression.whenTrue) ||
        rustExpressionContainsClosure(expression.whenFalse);
    case "assignment":
      return rustExpressionContainsClosure(expression.target) || rustExpressionContainsClosure(expression.value);
    case "call":
    case "invoke":
    case "associated-call":
      return (expression.kind === "invoke" && rustExpressionContainsClosure(expression.callee)) ||
        expression.args.some(rustExpressionContainsClosure);
    case "method-call":
      return rustExpressionContainsClosure(expression.receiver) ||
        expression.args.some(rustExpressionContainsClosure);
    case "field":
      return rustExpressionContainsClosure(expression.receiver);
    case "index":
      return rustExpressionContainsClosure(expression.receiver) || rustExpressionContainsClosure(expression.index);
    case "block":
      return expression.bindings.some((binding) => rustExpressionContainsClosure(binding.value)) ||
        rustExpressionContainsClosure(expression.value);
    case "evaluate-then":
      return rustExpressionContainsClosure(expression.effect) || rustExpressionContainsClosure(expression.value);
    case "string-concat":
      return expression.parts.some(rustExpressionContainsClosure);
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements.some(rustExpressionContainsClosure);
    case "reference":
    case "await":
    case "try":
      return rustExpressionContainsClosure(expression.expr);
    case "struct-literal":
      return expression.fields.some((field) => rustExpressionContainsClosure(field.value));
    default:
      return false;
  }
}

function printRustExprFitted(
  expression: RustExpr,
  depth: number,
  column: number,
  methodChainContinuationIndent?: string,
): string {
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
      const bindings = expression.bindings.flatMap((binding) => {
        const prefix = `${statementIndent}let ${binding.name} = `;
        return [
          ...(binding.attrs ?? []).map((attribute) => `${statementIndent}${attribute}`),
          printRustLetInitializer(prefix, binding.value, depth + 1),
        ];
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
      const effectPrefix = expression.discard === "unit"
        ? statementIndent
        : `${statementIndent}let _ = `;
      const effect = printRustExprFitted(expression.effect, depth + 1, effectPrefix.length);
      const value = printRustExprFitted(expression.value, depth + 1, statementIndent.length);
      return [
        "{",
        `${effectPrefix}${effect};`,
        `${statementIndent}${value}`,
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "string-concat": {
      if (expression.parts.length <= rustFormatMacroInlineArgumentLimit &&
        renderedFits(flat, column)) {
        return flat;
      }
      const argumentIndent = indentText(depth + 1);
      const placeholders = expression.parts.map(() => "{}").join("");
      const compactParts = expression.parts.map(printRustExpr).join(", ");
      const renderedParts = !compactParts.includes("\n") &&
          renderedFits(`${compactParts},`, argumentIndent.length)
        ? [`${argumentIndent}${compactParts},`]
        : expression.parts.map((part) => {
            const rendered = printRustExprFitted(
              part,
              depth + 1,
              argumentIndent.length,
            );
            return appendToLastLine(`${argumentIndent}${rendered}`, ",");
          });
      return [
        "format!(",
        `${argumentIndent}\"${placeholders}\",`,
        ...renderedParts,
        `${indentText(depth)})`,
      ].join("\n");
    }
    case "call":
      return printFittedCall(expression.path, expression.args, depth, column);
    case "invoke":
      return printFittedCall(
        printOperand(expression.callee, RustPrecedence.Postfix, false),
        expression.args,
        depth,
        column,
      );
    case "associated-call":
      return printFittedCall(
        `${printRustAssociatedOwner(expression.owner)}::${expression.method}`,
        expression.args,
        depth,
        column,
      );
    case "method-call": {
      const chain = rustMethodChain(expression);
      const verticalLayout = rustMethodChainPrefersVerticalLayout(expression);
      if (!flat.includes("\n") && renderedFits(flat, column) && !verticalLayout &&
        !rustExpressionContainsExpandedStructLiteral(expression)) {
        return flat;
      }
      const hasClosure = expression.args.some((argument) =>
        argument.kind === "closure" || argument.kind === "closure-block");
      if (hasClosure && rustMethodCallKeepsTrailingClosureAttached(expression)) {
        const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
        return printFittedCall(`${receiver}.${expression.method}`, expression.args, depth, column);
      }
      if (chain !== undefined && verticalLayout) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          rustMethodChainContainsClosure(chain) || column > indentText(depth + 1).length,
          methodChainContinuationIndent,
        );
      }
      if (chain !== undefined && rustMethodChainBreaksReceiverWhenExpanded(chain)) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          hasClosure,
          methodChainContinuationIndent,
        );
      }
      if (hasClosure) {
        const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
        return printFittedCall(`${receiver}.${expression.method}`, expression.args, depth, column);
      }
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      return printFittedCall(`${receiver}.${expression.method}`, expression.args, depth, column);
    }
    case "closure": {
      if (!flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const params = printRustClosureParams(expression.params);
      const indent = indentText(depth + 1);
      const body = printRustExprFitted(
        expression.body,
        depth + 1,
        indent.length,
      );
      return [`|${params}| {`, `${indent}${body}`, `${indentText(depth)}}`].join("\n");
    }
    case "closure-block": {
      const params = printRustClosureParams(expression.params);
      const prefix = `${expression.move ? "move " : ""}|${params}| ${expression.async ? "async move " : ""}{`;
      const body = printRustBlockStatements(expression.body, depth + 1);
      return body.length === 0
        ? `${prefix}}`
        : `${prefix}\n${body}\n${indentText(depth)}}`;
    }
    case "await": {
      const rendered = printRustExprFitted(expression.expr, depth, column + ".await".length);
      return rendered.includes("\n") && rustMethodChain(expression.expr) !== undefined
        ? `${rendered}\n${indentText(depth + 1)}.await`
        : appendToLastLine(rendered, ".await");
    }
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
      if (!rustExpressionContainsStatementBlock(expression) &&
        !rustExpressionContainsExpandedStructLiteral(expression) &&
        !rustMethodChainPrefersVerticalLayout(expression.left) &&
        !rustMethodChainPrefersVerticalLayout(expression.right) &&
        !flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      if (expression.operator === "||" || expression.operator === "&&") {
        return printFittedLogicalChain(expression, expression.operator, depth, column);
      }
      const renderedLeft = printRustExprFitted(
        expression.left,
        depth,
        column,
        methodChainContinuationIndent ??
          (column > indentText(depth).length ? indentText(depth) : undefined),
      );
      const left = expression.left.kind === "numeric-cast" &&
          (expression.operator === "<" || expression.operator === "<=" ||
            expression.operator === ">" || expression.operator === ">=")
        ? `(${renderedLeft})`
        : renderedLeft;
      const joined = appendToLastLine(
        left,
        ` ${expression.operator} ${printBinaryOperand(expression.right, expression.operator, true)}`,
      );
      const multilineLeftRequiresOwnOperator = left.includes("\n") &&
        (expression.left.kind === "binary" || expression.left.kind === "method-call");
      if (!multilineLeftRequiresOwnOperator && renderedFits(joined, column)) {
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
    case "slice-literal":
    case "tuple-literal": {
      if (!flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const elementIndent = indentText(depth + 1);
      const elements = expression.elements.map((element) => {
        const rendered = printRustExprFitted(element, depth + 1, elementIndent.length);
        return appendToLastLine(`${elementIndent}${rendered}`, ",");
      });
      return [
        expression.kind === "vec-literal" ? "vec![" : expression.kind === "slice-literal" ? "[" : "(",
        ...elements,
        `${indentText(depth)}${expression.kind === "tuple-literal" ? ")" : "]"}`,
      ].join("\n");
    }
    case "struct-literal": {
      const compactFields = expression.fields
        .map((field) => {
          const value = printRustExpr(field.value);
          return value === field.name ? field.name : `${field.name}: ${value}`;
        })
        .join(", ");
      if (expression.fields.length <= 2 && compactFields.length <= rustStructLiteralWidth &&
        !flat.includes("\n") && renderedFits(flat, column)) {
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
          prefix.length + 1,
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

function printRustLetInitializer(
  prefix: string,
  initializer: RustExpr,
  depth: number,
): string {
  const flat = printRustExpr(initializer);
  if (flat.includes("\n")) {
    const continuationIndent = indentText(depth + 1);
    const authoredOpening = firstLine(flat);
    if (prefix.length + authoredOpening.length + 1 > rustFormatWidth &&
      continuationIndent.length + authoredOpening.length <= rustFormatWidth) {
      const continuation = printRustExprFitted(
        initializer,
        depth + 1,
        continuationIndent.length,
      );
      return `${prefix.trimEnd()}\n${continuationIndent}${continuation};`;
    }
  }
  if (!flat.includes("\n") && !renderedFits(flat, prefix.length + 1) &&
    renderedFits(flat, indentText(depth + 1).length + 1) &&
    !rustMethodChainPrefersVerticalLayout(initializer)) {
    return `${prefix.trimEnd()}\n${indentText(depth + 1)}${flat};`;
  }
  return `${prefix}${printRustExprFitted(initializer, depth, prefix.length + 1)};`;
}

function printRustFlatLetInitializer(
  prefix: string,
  initializer: string,
  depth: number,
): string {
  const assignment = `${prefix}${initializer};`;
  return renderedFits(assignment, 0)
    ? assignment
    : `${prefix.trimEnd()}\n${indentText(depth + 1)}${initializer};`;
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
  let rendered = printFittedLogicalOperand(first, operator, depth, column);
  const continuationIndent = indentText(depth + 1);
  for (const operand of operands.slice(1)) {
    const right = printFittedLogicalOperand(
      operand,
      operator,
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

function printFittedLogicalOperand(
  operand: RustExpr,
  operator: "||" | "&&",
  depth: number,
  column: number,
): string {
  const parenthesized = expressionPrecedence(operand) < operatorPrecedence(operator);
  const rendered = printRustExprFitted(
    operand,
    depth,
    column + (parenthesized ? 1 : 0),
  );
  return parenthesized ? `(${rendered})` : rendered;
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
  | { readonly kind: "field"; readonly name: string }
  | { readonly kind: "try" };

function rustMethodChain(expression: RustExpr): RustMethodChain | undefined {
  const steps: RustMethodChainStep[] = [];
  const base = collectRustMethodChain(expression, steps);
  return steps.some((step) => step.kind === "method") ? { base, steps } : undefined;
}

function rustMethodChainRequiresVerticalLayout(expression: RustExpr): boolean {
  const chain = rustMethodChain(expression);
  return chain !== undefined &&
    !rustMethodCallKeepsTrailingClosureAttached(expression) &&
    printRustExpr(expression).length > rustMethodChainWidth &&
    chain.steps.filter((step) => step.kind === "method" || step.kind === "field").length > 1;
}

function rustMethodCallKeepsTrailingClosureAttached(expression: RustExpr): boolean {
  if (expression.kind !== "method-call") {
    return false;
  }
  const trailing = expression.args[expression.args.length - 1];
  return trailing?.kind === "closure" &&
    printRustExpr(trailing.body).length > rustMethodChainWidth &&
    printRustExpr(expression.receiver).length + expression.method.length + 3 <=
      rustInlineFieldReceiverWidth;
}

function rustMethodChainPrefersVerticalLayout(expression: RustExpr): boolean {
  const chain = rustMethodChain(expression);
  return rustMethodChainRequiresVerticalLayout(expression) ||
    chain !== undefined && printRustExpr(expression).length > rustNestedCallWidth &&
    chain.steps.some((step) => step.kind === "method" && step.args.some((argument) =>
      argument.kind !== "closure" && argument.kind !== "closure-block" &&
      rustExpressionContainsClosure(argument)));
}

function rustMethodChainBreaksReceiverWhenExpanded(chain: RustMethodChain): boolean {
  const first = chain.steps[0];
  const firstSelectorWidth = first?.kind === "method" || first?.kind === "field"
    ? first.name.length + 1
    : first?.kind === "try" ? 1 : 0;
  return chain.steps.length > 1 ||
    printRustExpr(chain.base).length + firstSelectorWidth > rustInlineFieldReceiverWidth ||
    chain.steps.some((step, index) =>
      step.kind === "try" && chain.steps[index + 1]?.kind === "method");
}

function rustMethodChainContainsClosure(chain: RustMethodChain): boolean {
  return chain.steps.some((step) => step.kind === "method" && step.args.some((argument) =>
    argument.kind === "closure" || argument.kind === "closure-block"));
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
  if (expression.kind === "field") {
    const base = collectRustMethodChain(expression.receiver, steps);
    steps.push({ kind: "field", name: expression.name });
    return base;
  }
  return expression;
}

function printFittedMethodChain(
  chain: RustMethodChain,
  depth: number,
  column: number,
  breakBeforeFirstMethod = false,
  continuationIndent = indentText(depth + 1),
): string {
  const flatBase = printRustExpr(chain.base);
  let rendered = renderedFits(flatBase, column) && !rustExpressionContainsExpandedStructLiteral(chain.base)
    ? flatBase
    : printRustExprFitted(chain.base, depth, column);
  const selectedContinuationIndent = rendered.includes("\n")
    ? indentText(depth)
    : continuationIndent;
  let emittedCall = false;
  for (const step of chain.steps) {
    if (step.kind === "try") {
      rendered = appendToLastLine(rendered, "?");
      continue;
    }
    if (step.kind === "field") {
      rendered = emittedCall || lastLineLength(rendered) + step.name.length + 1 > rustInlineFieldReceiverWidth
        ? `${rendered}\n${selectedContinuationIndent}.${step.name}`
        : appendToLastLine(rendered, `.${step.name}`);
      continue;
    }
    const method = printFittedCall(
      `.${step.name}`,
      step.args,
      depth + 1,
      selectedContinuationIndent.length + 1,
    );
    const inlineFirstMethod = !breakBeforeFirstMethod && !emittedCall &&
      !rendered.includes("\n") &&
      lastLineLength(rendered) + firstLine(method).length <= rustInlineFieldReceiverWidth;
    rendered = inlineFirstMethod
      ? appendToLastLine(rendered, method)
      : `${rendered}\n${selectedContinuationIndent}${method}`;
    emittedCall = true;
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
  const trailingClosure = arguments_[arguments_.length - 1];
  if (!forceExpanded &&
    (trailingClosure?.kind === "closure" || trailingClosure?.kind === "closure-block")) {
    const preceding = arguments_.slice(0, -1).map(printRustExpr);
    if (preceding.every((argument) => !argument.includes("\n"))) {
      const prefix = `${callable}(${preceding.length === 0 ? "" : `${preceding.join(", ")}, `}`;
      const renderedClosure = printRustExprFitted(
        trailingClosure,
        depth,
        column + prefix.length,
      );
      if (firstLine(renderedClosure).length + column + prefix.length <= rustFormatWidth) {
        return appendToLastLine(`${prefix}${renderedClosure}`, ")");
      }
    }
  }
  if (arguments_.length === 1 &&
    (arguments_[0]?.kind === "slice-literal" || arguments_[0]?.kind === "vec-literal" ||
      arguments_[0]?.kind === "tuple-literal")) {
    const prefix = `${callable}(`;
    return appendToLastLine(
      `${prefix}${printRustExprFitted(
        arguments_[0],
        depth,
        column + prefix.length + 1,
      )}`,
      ")",
    );
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
  if (arguments_.length === 1 && arguments_[0]?.kind === "struct-literal") {
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
  if (!forceExpanded && arguments_.length === 1 && arguments_[0]?.kind === "method-call") {
    if (!flat.includes("\n") && renderedFits(flat, column) &&
      !rustMethodChainPrefersVerticalLayout(arguments_[0]) &&
      !rustExpressionContainsStatementBlock(arguments_[0]) &&
      !rustExpressionContainsExpandedStructLiteral(arguments_[0])) {
      return flat;
    }
    const chain = rustMethodChain(arguments_[0]);
    const outerCallMustOwnBreak = chain !== undefined &&
      chain.steps.length === 1 &&
      callable.length > rustInlineFieldReceiverWidth &&
      rustMethodChainBreaksReceiverWhenExpanded(chain);
    if (rustMethodChainPrefersVerticalLayout(arguments_[0]) || outerCallMustOwnBreak) {
      const inlinePrefix = `${callable}(`;
      if (chain !== undefined && rustMethodChainContainsClosure(chain) &&
        callable.length <= rustInlineFieldReceiverWidth) {
        const inline = appendToLastLine(
          `${inlinePrefix}${printFittedMethodChain(
            chain,
            depth,
            column + inlinePrefix.length,
            rustMethodChainContainsClosure(chain),
          )}`,
          ")",
        );
        if (renderedFits(inline, column)) {
          return inline;
        }
      }
      const argumentIndent = indentText(depth + 1);
      const rendered = chain === undefined
        ? printRustExprFitted(arguments_[0], depth + 1, argumentIndent.length)
        : printFittedMethodChain(chain, depth + 1, argumentIndent.length, true);
      return [
        `${callable}(`,
        appendToLastLine(`${argumentIndent}${rendered}`, ","),
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  if (forceExpanded && arguments_.length === 1) {
    const argument = arguments_[0]!;
    if (argument.kind === "call" || argument.kind === "associated-call" ||
      argument.kind === "method-call" || argument.kind === "try") {
      const prefix = `${callable}(`;
      const expandedArgumentColumn = indentText(depth + 1).length;
      const compactSingleInputCall = (argument.kind === "call" ||
          argument.kind === "associated-call" || argument.kind === "method-call") &&
        argument.args.length === 1 && renderedFits(printRustExpr(argument), expandedArgumentColumn);
      if (!compactSingleInputCall) {
        const nested = printNestedCallArgument(
          argument,
          depth,
          column + prefix.length,
          true,
        );
        const compact = appendToLastLine(`${prefix}${nested}`, ")");
        if (renderedFits(compact, column)) {
          return compact;
        }
      }
    }
  }
  if (preferNestedBreak && !forceExpanded && arguments_.length === 1 &&
    arguments_[0]?.kind === "method-call" && !renderedFits(flat, column)) {
    const chain = rustMethodChain(arguments_[0]);
    const argumentIndent = indentText(depth + 1);
    if (chain !== undefined && chain.steps.length > 1 &&
      !renderedFits(printRustExpr(arguments_[0]), argumentIndent.length)) {
      const rendered = printFittedMethodChain(
        chain,
        depth + 1,
        argumentIndent.length,
        true,
      );
      return [
        `${callable}(`,
        appendToLastLine(`${argumentIndent}${rendered}`, ","),
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  if (!forceExpanded && arguments_.length === 1) {
    const argument = arguments_[0]!;
    if (argument.kind === "call" || argument.kind === "associated-call" ||
      argument.kind === "method-call" || argument.kind === "try") {
      const argumentIndent = indentText(depth + 1);
      const flatArgument = printRustExpr(argument);
      const nestedInvocationArguments = argument.kind === "call" || argument.kind === "associated-call"
        ? argument.args
        : argument.kind === "try" &&
            (argument.expr.kind === "call" || argument.expr.kind === "associated-call")
          ? argument.expr.args
          : undefined;
      if ((argument.kind === "call" || argument.kind === "associated-call") &&
        (flat.includes("\n") || !renderedFits(flat, column))) {
        const nestedWrapper = printFittedNestedCallWrapper(
          callable,
          argument,
          depth,
          column,
        );
        if (nestedWrapper !== undefined) {
          return nestedWrapper;
        }
      }
      if (nestedInvocationArguments !== undefined &&
        (nestedInvocationArguments.length === 1 || flatArgument.length > rustNestedCallWidth) &&
        !renderedFits(flat, column)) {
        const prefix = `${callable}(`;
        const expandedNested = printNestedCallArgument(
          argument,
          depth,
          column + prefix.length,
          true,
        );
        const compact = appendToLastLine(`${prefix}${expandedNested}`, ")");
        if (expandedNested.includes("\n") && renderedFits(compact, column)) {
          return compact;
        }
      }
      if (!flatArgument.includes("\n") &&
        renderedFits(flatArgument, argumentIndent.length) &&
        !renderedFits(flat, column)) {
        return [
          `${callable}(`,
          `${argumentIndent}${flatArgument},`,
          `${indentText(depth)})`,
        ].join("\n");
      }
    }
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
      if (!(argument.kind !== "call" && argument.kind !== "associated-call" &&
          nested.includes("\n") &&
          !nestedAtExpandedColumn.includes("\n")) &&
        renderedFits(compact, column)) {
        return compact;
      }
      if (preferNestedBreak) {
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
      if (renderedFits(compact, column)) {
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
    } else if (!rustExpressionContainsStatementBlock(argument) &&
      !rustExpressionContainsExpandedStructLiteral(argument) && renderedFits(flat, column)) {
      return flat;
    }
  } else if (!forceExpanded && !arguments_.some(rustExpressionContainsStatementBlock) &&
    !arguments_.some(rustExpressionContainsExpandedStructLiteral) &&
    !flat.includes("\n") && renderedFits(flat, column)) {
    return flat;
  }
  const argumentIndent = indentText(depth + 1);
  if (forceExpanded && arguments_.length > 1 && flat.length <= rustNestedCallWidth &&
    renderedFits(flat, column)) {
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
    const rendered = printRustExprFitted(
      argument,
      depth + 1,
      argumentIndent.length + 1,
      indentText(depth + 2),
    );
    return appendToLastLine(`${argumentIndent}${rendered}`, ",");
  });
  return [
    `${callable}(`,
    ...renderedArguments,
    `${indentText(depth)})`,
  ].join("\n");
}

function printFittedNestedCallWrapper(
  outerCallable: string,
  nested: Extract<RustExpr, { readonly kind: "call" | "associated-call" }>,
  depth: number,
  column: number,
): string | undefined {
  const nestedCallable = nested.kind === "call"
    ? nested.path
    : `${printRustAssociatedOwner(nested.owner)}::${nested.method}`;
  const nestedClosureChain = collectNestedClosureCallChain(nested);
  if (nestedClosureChain !== undefined) {
    const opening = `${outerCallable}(${nestedClosureChain.callables.map((callable) => `${callable}(`).join("")}`;
    if (renderedFits(opening, column)) {
      const argumentIndent = indentText(depth + 1);
      const renderedArgument = printRustExprFitted(
        nestedClosureChain.closure,
        depth + 1,
        argumentIndent.length,
      );
      return [
        opening,
        appendToLastLine(`${argumentIndent}${renderedArgument}`, ","),
        `${indentText(depth)}${")".repeat(nestedClosureChain.callables.length + 1)}`,
      ].join("\n");
    }
  }
  if (nested.args.length === 1 &&
    (nested.args[0]?.kind === "closure" || nested.args[0]?.kind === "closure-block")) {
    const opening = `${outerCallable}(${nestedCallable}(`;
    if (!renderedFits(opening, column)) {
      return undefined;
    }
    const argumentIndent = indentText(depth + 1);
    const renderedArgument = printRustExprFitted(
      nested.args[0],
      depth + 1,
      argumentIndent.length,
    );
    return [
      opening,
      appendToLastLine(`${argumentIndent}${renderedArgument}`, ","),
      `${indentText(depth)}))`,
    ].join("\n");
  }
  if (nested.args.length !== 2 || printRustExpr(nested).length > rustNestedCallWidth ||
    nested.args.some(rustExpressionContainsStatementBlock)) {
    return undefined;
  }
  const opening = `${outerCallable}(${nestedCallable}(`;
  if (!renderedFits(opening, column)) {
    return undefined;
  }
  const argumentIndent = indentText(depth + 1);
  const arguments_ = nested.args.map(printRustExpr).join(", ");
  if (arguments_.includes("\n") || !renderedFits(`${arguments_},`, argumentIndent.length)) {
    return undefined;
  }
  const rendered = [
    opening,
    `${argumentIndent}${arguments_},`,
    `${indentText(depth)}))`,
  ].join("\n");
  return renderedFits(rendered, column) ? rendered : undefined;
}

function collectNestedClosureCallChain(
  expression: Extract<RustExpr, { readonly kind: "call" | "associated-call" }>,
): {
  readonly callables: readonly string[];
  readonly closure: Extract<RustExpr, { readonly kind: "closure" | "closure-block" }>;
} | undefined {
  const callables: string[] = [];
  let current = expression;
  for (;;) {
    callables.push(current.kind === "call"
      ? current.path
      : `${printRustAssociatedOwner(current.owner)}::${current.method}`);
    if (current.args.length !== 1) {
      return undefined;
    }
    const argument = current.args[0];
    if (argument?.kind === "closure" || argument?.kind === "closure-block") {
      return { callables, closure: argument };
    }
    if (argument?.kind !== "call" && argument?.kind !== "associated-call") {
      return undefined;
    }
    current = argument;
  }
}

function printRustClosureParams(
  params: readonly { readonly name: string; readonly mutable?: boolean; readonly byRefCopy?: boolean }[],
): string {
  return params
    .map((param) => param.byRefCopy === true
      ? param.mutable === true ? `&(mut ${param.name})` : `&${param.name}`
      : `${param.mutable === true ? "mut " : ""}${param.name}`)
    .join(", ");
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
      (forceExpanded || !renderedFits(printRustExpr(inner), column + 1))) {
      const chain = rustMethodChain(inner);
      return appendToLastLine(
        chain === undefined
          ? printRustExprFitted(inner, depth, column + 1)
          : printFittedMethodChain(chain, depth, column + 1, true),
        "?",
      );
    }
    return printRustExprFitted(argument, depth, column);
  }
  const flatArgument = printRustExpr(argument);
  if (!forceExpanded && argument.kind === "method-call" &&
    rustMethodCallKeepsTrailingClosureAttached(argument)) {
    return printRustExprFitted(argument, depth, column);
  }
  if (!forceExpanded && argument.kind === "method-call" &&
    rustMethodChainPrefersVerticalLayout(argument)) {
    const chain = rustMethodChain(argument);
    if (chain !== undefined) {
      return printFittedMethodChain(chain, depth, column, true);
    }
  }
  if (!forceExpanded && argument.kind === "method-call" &&
    (!renderedFits(flatArgument, column) || flatArgument.length > rustMethodChainWidth)) {
    const chain = rustMethodChain(argument);
    if (chain !== undefined && rustMethodChainBreaksReceiverWhenExpanded(chain)) {
      return printFittedMethodChain(chain, depth, column);
    }
  }
  const compactNestedCall = !rustExpressionContainsExpandedStructLiteral(argument) &&
    (argument.kind === "method-call"
    ? renderedFits(flatArgument, column)
    : flatArgument.length <= rustNestedCallWidth);
  if (!forceExpanded && compactNestedCall) {
    const flat = flatArgument;
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
  if (forceExpanded) {
    const chain = rustMethodChain(argument);
    if (chain !== undefined) {
      return printFittedMethodChain(chain, depth, column, true);
    }
  }
  const receiver = printOperand(argument.receiver, RustPrecedence.Postfix, false);
  return printFittedCall(`${receiver}.${argument.method}`, argument.args, depth, column, true);
}

function rustExpressionContainsExpandedStructLiteral(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "unary":
      return rustExpressionContainsExpandedStructLiteral(expression.operand);
    case "numeric-cast":
      return rustExpressionContainsExpandedStructLiteral(expression.expression);
    case "binary":
      return rustExpressionContainsExpandedStructLiteral(expression.left) ||
        rustExpressionContainsExpandedStructLiteral(expression.right);
    case "range":
      return rustExpressionContainsExpandedStructLiteral(expression.start) ||
        rustExpressionContainsExpandedStructLiteral(expression.end);
    case "conditional":
      return rustExpressionContainsExpandedStructLiteral(expression.condition) ||
        rustExpressionContainsExpandedStructLiteral(expression.whenTrue) ||
        rustExpressionContainsExpandedStructLiteral(expression.whenFalse);
    case "assignment":
      return rustExpressionContainsExpandedStructLiteral(expression.target) ||
        rustExpressionContainsExpandedStructLiteral(expression.value);
    case "struct-literal": {
      const compactFields = expression.fields.map((field) => {
        const value = printRustExpr(field.value);
        return value === field.name ? field.name : `${field.name}: ${value}`;
      }).join(", ");
      return expression.fields.length > 2 || compactFields.length > rustStructLiteralWidth ||
        expression.fields.some((field) => rustExpressionContainsExpandedStructLiteral(field.value));
    }
    case "call":
    case "invoke":
    case "associated-call":
      return (expression.kind === "invoke" &&
          rustExpressionContainsExpandedStructLiteral(expression.callee)) ||
        expression.args.some(rustExpressionContainsExpandedStructLiteral);
    case "method-call":
      return rustExpressionContainsExpandedStructLiteral(expression.receiver) ||
        expression.args.some(rustExpressionContainsExpandedStructLiteral);
    case "field":
      return rustExpressionContainsExpandedStructLiteral(expression.receiver);
    case "index":
      return rustExpressionContainsExpandedStructLiteral(expression.receiver) ||
        rustExpressionContainsExpandedStructLiteral(expression.index);
    case "block":
      return expression.bindings.some((binding) =>
        rustExpressionContainsExpandedStructLiteral(binding.value)) ||
        rustExpressionContainsExpandedStructLiteral(expression.value);
    case "evaluate-then":
      return rustExpressionContainsExpandedStructLiteral(expression.effect) ||
        rustExpressionContainsExpandedStructLiteral(expression.value);
    case "string-concat":
      return expression.parts.some(rustExpressionContainsExpandedStructLiteral);
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements.some(rustExpressionContainsExpandedStructLiteral);
    case "reference":
    case "await":
    case "try":
      return rustExpressionContainsExpandedStructLiteral(expression.expr);
    case "closure":
      return rustExpressionContainsExpandedStructLiteral(expression.body);
    default:
      return false;
  }
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
