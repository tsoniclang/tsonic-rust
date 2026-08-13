import type {
  RustBlock,
  RustExpr,
  RustItem,
  RustPattern,
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

interface RustFunctionParameterPrint {
  readonly prefix: string;
  readonly type?: RustType;
}

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
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      return `${attrs}${printRustVisibility(item.visibility)}mod ${item.name};`;
    }
    case "use": {
      const visibility = printRustVisibility(item.visibility ?? "private");
      return item.alias === undefined
        ? `${visibility}use ${item.path};`
        : `${visibility}use ${item.path} as ${item.alias};`;
    }
    case "type-alias": {
      const generics = printRustTypeParameters(item.typeParams);
      return `${printRustVisibility(item.visibility)}type ${item.name}${generics} = ${printRustType(item.target)};`;
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
      const generics = printRustTypeParameters(item.typeParams);
      const header = `${structAttrs}${derives}${printRustVisibility(item.visibility)}struct ${item.name}${generics} {`;
      const fields = item.fields.map((field) => `    ${printRustVisibility(field.visibility)}${field.name}: ${printRustType(field.type)},`).join("\n");
      return fields.length === 0 ? `${header}}` : `${header}\n${fields}\n}`;
    }
    case "enum": {
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const variants = item.variants
        .map((variant) => {
          const fields = variant.fields === undefined
            ? ""
            : `(${variant.fields.map(printRustType).join(", ")})`;
          const discriminant = variant.discriminant === undefined
            ? ""
            : ` = ${variant.discriminant}`;
          return `    ${variant.name}${fields}${discriminant},`;
        })
        .join("\n");
      return `${attrs}${derives}${printRustVisibility(item.visibility)}enum ${item.name} {\n${variants}\n}`;
    }
    case "trait": {
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const generics = printRustTypeParameters(item.typeParams);
      const renderedSuperTraits = item.superTraits?.map(printRustType) ?? [];
      const superTraits = renderedSuperTraits.length === 0
        ? ""
        : `: ${renderedSuperTraits.join(" + ")}`;
      const functions = item.functions.map((fn) => {
        const selfParam = printRustSelfParam(fn.selfParam);
        const params = fn.params.map(rustFunctionParameter);
        const allParams = selfParam === undefined ? params : [selfParam, ...params];
        const fnAttrs = (fn.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
        return `${fnAttrs}${printRustFunctionSignature(
          `    ${fn.isUnsafe === true ? "unsafe " : ""}fn `,
          fn.name,
          "",
          allParams,
          rustFunctionReturnType(fn.returnType, fn.fallible === true),
          1,
        )}`;
      }).join("\n");
      const declaration = `${printRustVisibility(item.visibility)}trait ${item.name}${generics}`;
      const flatHeader = `${declaration}${superTraits}`;
      const expandedHeader = renderedSuperTraits.length > 0 &&
          (`${flatHeader} {`.length >= rustFormatWidth ||
            (renderedSuperTraits.length > 1 && flatHeader.length > 80) ||
            (functions.length > 0 && `${flatHeader} {`.length >= 86))
        ? `${declaration}:\n    ${renderedSuperTraits.join(" + ")}\n{`
        : `${flatHeader} {`;
      return functions.length === 0
        ? expandedHeader.includes("\n")
          ? `${attrs}${expandedHeader}\n}`
          : `${attrs}${flatHeader} {}`
        : `${attrs}${expandedHeader}\n${functions}\n}`;
    }
    case "impl": {
      const rendered = item.functions.map((fn) => {
        const selfPrefix = printRustSelfParam(fn.selfParam);
        const params = fn.params.map(rustFunctionParameter);
        const allParams = selfPrefix === undefined ? params : [selfPrefix, ...params];
        const fnAttrs = (fn.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
        const visibility = item.trait === undefined ? printRustVisibility(fn.visibility) : "";
        const generics = printRustTypeParameters(fn.typeParams);
        const header = `${fnAttrs}${printRustFunctionHeader(
          `    ${visibility}${fn.isAsync === true ? "async " : ""}${fn.isUnsafe === true ? "unsafe " : ""}fn `,
          fn.name,
          generics,
          allParams,
          rustFunctionReturnType(fn.returnType, fn.fallible === true),
          1,
        )}`;
        const body = printRustBlockStatements(fn.body, 2);
        return body.length === 0 ? `${header}}` : `${header}\n${body}\n    }`;
      }).join("\n\n");
      const generics = printRustTypeParameters(item.typeParams);
      const target = printRustType(item.target);
      const header = item.trait === undefined
        ? `impl${generics} ${target}`
        : `impl${generics} ${printRustType(item.trait)} for ${target}`;
      return rendered.length === 0 ? `${header} {}` : `${header} {\n${rendered}\n}`;
    }
    case "function": {
      const params = item.params.map(rustFunctionParameter);
      const generics = printRustTypeParameters(item.typeParams);
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const header = `${attrs}${printRustFunctionHeader(
        `${printRustVisibility(item.visibility)}${item.isAsync === true ? "async " : ""}${item.isUnsafe === true ? "unsafe " : ""}fn `,
        item.name,
        generics,
        params,
        rustFunctionReturnType(item.returnType, item.fallible === true),
        0,
      )}`;
      const body = printRustBlockStatements(item.body, 1);
      return body.length === 0 ? `${header}}` : `${header}\n${body}\n}`;
    }
  }
}

function printRustSelfParam(
  selfParam: import("../backend/rust-ast/nodes.js").RustSelfParam | undefined,
): RustFunctionParameterPrint | undefined {
  return selfParam === undefined
    ? undefined
    : selfParam === "ref"
      ? { prefix: "&self" }
      : selfParam === "mut-ref"
        ? { prefix: "&mut self" }
        : { prefix: "self: ", type: { kind: "named", path: "std::rc::Rc", typeArguments: [{ kind: "named", path: "Self" }] } };
}

function rustFunctionParameter(
  parameter: { readonly name: string; readonly mutable?: boolean; readonly type: RustType },
): RustFunctionParameterPrint {
  return {
    prefix: `${parameter.mutable === true ? "mut " : ""}${parameter.name}: `,
    type: parameter.type,
  };
}

function printRustFunctionParameterFlat(parameter: RustFunctionParameterPrint): string {
  return parameter.type === undefined
    ? parameter.prefix
    : `${parameter.prefix}${printRustType(parameter.type)}`;
}

function printRustFunctionParameterFitted(
  parameter: RustFunctionParameterPrint,
  depth: number,
): string {
  const indent = indentText(depth);
  if (parameter.type === undefined) {
    return `${indent}${parameter.prefix},`;
  }
  const renderedType = printRustTypeFitted(
    parameter.type,
    depth,
    indent.length + parameter.prefix.length,
  );
  return appendToLastLine(`${indent}${parameter.prefix}${renderedType}`, ",");
}

function printRustTypeParameters(parameters: readonly import("../backend/rust-ast/nodes.js").RustTypeParameter[] | undefined): string {
  return parameters === undefined || parameters.length === 0
    ? ""
    : `<${parameters.map(printRustTypeParameter).join(", ")}>`;
}

function rustFunctionReturnType(returnType: RustType | undefined, fallible: boolean): RustType | undefined {
  return !fallible
    ? returnType
    : {
        kind: "named",
        path: "rt::TsonicResult",
        typeArguments: [returnType ?? { kind: "unit" }],
      };
}

function printRustReturnSuffix(returnType: RustType | undefined): string {
  return returnType === undefined ? "" : ` -> ${printRustType(returnType)}`;
}

function printRustFittedReturnSuffix(
  returnType: RustType | undefined,
  depth: number,
  column: number,
): string {
  return returnType === undefined
    ? ""
    : ` -> ${printRustTypeFitted(returnType, depth, column + " -> ".length)}`;
}

function printRustFunctionHeader(
  prefix: string,
  name: string,
  generics: string,
  parameters: readonly RustFunctionParameterPrint[],
  returnType: RustType | undefined,
  depth: number,
): string {
  const returnSuffix = printRustReturnSuffix(returnType);
  const flatParameters = parameters.map(printRustFunctionParameterFlat);
  const flat = `${prefix}${name}${generics}(${flatParameters.join(", ")})${returnSuffix} {`;
  if (flat.length <= rustFormatWidth) {
    return flat;
  }
  const closingIndent = indentText(depth);
  const closingPrefix = parameters.length === 0
    ? `${prefix}${name}${generics}()`
    : `${closingIndent})`;
  const fittedReturnSuffix = printRustFittedReturnSuffix(
    returnType,
    depth,
    closingPrefix.length + 1,
  );
  return [
    ...(parameters.length === 0
      ? []
      : [
          `${prefix}${name}${generics}(`,
          ...parameters.map((parameter) => printRustFunctionParameterFitted(parameter, depth + 1)),
        ]),
    `${closingPrefix}${fittedReturnSuffix} {`,
  ].join("\n");
}

function printRustFunctionSignature(
  prefix: string,
  name: string,
  generics: string,
  parameters: readonly RustFunctionParameterPrint[],
  returnType: RustType | undefined,
  depth: number,
): string {
  const returnSuffix = printRustReturnSuffix(returnType);
  const flatParameters = parameters.map(printRustFunctionParameterFlat);
  const invocation = `${prefix}${name}${generics}(${flatParameters.join(", ")})`;
  const flat = `${invocation}${returnSuffix};`;
  if (flat.length < rustFormatWidth) {
    return flat;
  }
  if (flat.length === rustFormatWidth && returnSuffix.length > 0) {
    return `${invocation}\n${indentText(depth + 1)}${returnSuffix.trimStart()};`;
  }
  const closingIndent = indentText(depth);
  const closingPrefix = parameters.length === 0
    ? `${prefix}${name}${generics}()`
    : `${closingIndent})`;
  const fittedReturnSuffix = printRustFittedReturnSuffix(
    returnType,
    depth,
    closingPrefix.length,
  );
  return [
    ...(parameters.length === 0
      ? []
      : [
          `${prefix}${name}${generics}(`,
          ...parameters.map((parameter) => printRustFunctionParameterFitted(parameter, depth + 1)),
        ]),
    `${closingPrefix}${fittedReturnSuffix};`,
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
    case "never": {
      return "!";
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
    case "trait-object": {
      return `dyn ${printRustType(type.trait)}`;
    }
    case "reference": {
      return `${type.mutable ? "&mut " : "&"}${printRustType(type.referent)}`;
    }
    case "raw-pointer": {
      return `${type.mutable ? "*mut " : "*const "}${printRustType(type.pointee)}`;
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
      return `${type.isUnsafe === true ? "unsafe " : ""}${abi}fn(${type.parameters.map(printRustType).join(", ")}) -> ${printRustType(type.result)}`;
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
      return `${indent}${statement.tail === true ? "" : "return "}Err(${printRustExpr(statement.error)})${statement.tail === true ? "" : ";"}`;
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
    const flowType = catchClause.fallible
      ? `rt::TsonicResult<${completionType}>`
      : completionType;
    const inlineFlowMatchPrefix = `${indent}let ${statement.flowName}: ${flowType} = match ${statement.bodyName}`;
    const catchUsesBlock = statement.asynchronous;
    const matchContinues = !renderedFits(`${inlineFlowMatchPrefix} {`, 0);
    const matchDepth = matchContinues ? depth + 1 : depth;
    const matchIndent = indentText(matchDepth);
    const armIndent = indentText(matchDepth + 1);
    const catchExpression = printRustCompletionCaptureExpression(
      completionType,
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
      ...(matchContinues
        ? [`${indent}let ${statement.flowName}: ${flowType} =`, `${matchIndent}match ${statement.bodyName} {`]
        : [`${inlineFlowMatchPrefix} {`]),
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
  const inlineExpression = printRustCompletionCaptureExpression(
    completionType,
    body,
    fallible,
    terminates,
    asynchronous,
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
      statement.kind === "for" || statement.kind === "if-let-some" ||
      statement.kind === "scope" || statement.kind === "unsafe-scope") {
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
  if (expression.kind === "try" &&
    (expression.expr.kind === "call" || expression.expr.kind === "associated-call")) {
    const callable = expression.expr.kind === "call"
      ? expression.expr.path
      : `${printRustAssociatedCallOwner(expression.expr)}::${expression.expr.method}`;
    const flat = printRustExpr(expression.expr);
    const forceExpanded = !renderedFits(flat, column) ||
      expression.expr.args.length > 1 && flat.length > rustNestedCallWidth &&
        expression.expr.args.filter((argument) =>
          argument.kind === "call" || argument.kind === "associated-call" ||
          argument.kind === "method-call" || argument.kind === "try").length > 1;
    return appendToLastLine(
      printFittedCall(
        callable,
        expression.expr.args,
        depth,
        column + 1,
        forceExpanded,
        true,
      ),
      "?",
    );
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
  const header = lastLine(renderedCondition).trim() === "}"
    ? appendToLastLine(conditionHeader, " {")
    : `${conditionHeader}\n${indent}{`;
  return body.length === 0
    ? `${header}}`
    : `${header}\n${body}\n${indent}}`;
}

const enum RustPrecedence {
  Assignment = 0,
  Or = 1,
  And = 2,
  Comparison = 3,
  BitOr = 4,
  BitXor = 5,
  BitAnd = 6,
  Shift = 7,
  Additive = 8,
  Multiplicative = 9,
  Unary = 10,
  Cast = 11,
  Postfix = 12,
  Atom = 13,
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
    case "|":
      return RustPrecedence.BitOr;
    case "^":
      return RustPrecedence.BitXor;
    case "&":
      return RustPrecedence.BitAnd;
    case "<<":
    case ">>":
      return RustPrecedence.Shift;
    case "+":
    case "-":
      return RustPrecedence.Additive;
    default:
      return RustPrecedence.Multiplicative;
  }
}

function expressionPrecedence(expression: RustExpr): RustPrecedence {
  switch (expression.kind) {
    case "bottom":
      return expressionPrecedence(expression.expression);
    case "assignment":
    case "return-expression":
    case "conditional":
    case "match":
    case "closure":
    case "closure-block":
      return RustPrecedence.Assignment;
    case "range":
      return RustPrecedence.Or;
    case "binary":
      return operatorPrecedence(expression.operator);
    case "unary":
    case "reference":
    case "dereference":
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
  const text = printRustExpr(operand);
  return expressionNeedsParentheses(operand, parent, isRightSide)
    ? `(${text})`
    : text;
}

function expressionNeedsParentheses(
  expression: RustExpr,
  parent: RustPrecedence,
  isRightSide: boolean,
): boolean {
  if (isRightSide && expression.kind !== "match" && expressionIsRightHandBlock(expression)) {
    return false;
  }
  const own = expressionPrecedence(expression);
  return own < parent ||
    (own === parent && (isRightSide || parent === RustPrecedence.Comparison));
}

function expressionIsRightHandBlock(expression: RustExpr): boolean {
  if (expression.kind === "bottom") {
    return expressionIsRightHandBlock(expression.expression);
  }
  return expression.kind === "conditional" ||
    expression.kind === "match" ||
    expression.kind === "block" ||
    expression.kind === "unsafe" ||
    expression.kind === "evaluate-then";
}

function expressionIsStatementBlockOperand(expression: RustExpr): boolean {
  if (expression.kind === "bottom") {
    return expressionIsStatementBlockOperand(expression.expression);
  }
  return expression.kind === "block" ||
    expression.kind === "unsafe" ||
    expression.kind === "evaluate-then";
}

type RustExpressionGrammarPosition = "expression" | "statement";

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

function printFittedBinaryOperand(
  operand: RustExpr,
  rendered: string,
  operator: string,
  isRightSide: boolean,
  forceParentheses = false,
): string {
  const grouped = forceParentheses || expressionNeedsParentheses(
    operand,
    operatorPrecedence(operator),
    isRightSide,
  )
    ? `(${rendered})`
    : rendered;
  return operand.kind === "numeric-cast" &&
      (operator === "<" || operator === "<=" || operator === ">" || operator === ">=")
    ? `(${grouped})`
    : grouped;
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
    case "bottom": {
      return printRustExpr(expression.expression);
    }
    case "unary": {
      return `${expression.operator}${printOperand(expression.operand, RustPrecedence.Unary, false)}`;
    }
    case "dereference": {
      return `*${printOperand(expression.pointer, RustPrecedence.Unary, false)}`;
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
    case "match": {
      return printRustMatchExpression(expression, 0);
    }
    case "matches": {
      return `matches!(${printRustExpr(expression.expression)}, ${printRustPattern(expression.pattern)})`;
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
      return `${printRustAssociatedCallOwner(expression)}::${expression.method}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "method-call": {
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      return `${receiver}.${expression.method}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "field": {
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      const nestedTupleField = /^[0-9]+$/u.test(expression.name) &&
        expression.receiver.kind === "field" && /^[0-9]+$/u.test(expression.receiver.name);
      return `${nestedTupleField ? `(${receiver})` : receiver}.${expression.name}`;
    }
    case "index": {
      return `${printOperand(expression.receiver, RustPrecedence.Postfix, false)}[${printRustExpr(expression.index)}]`;
    }
    case "block": {
      const bindings = expression.bindings
        .map((binding) => `${binding.attrs?.join(" ") ?? ""}${binding.attrs === undefined ? "" : " "}let ${binding.mutable === true ? "mut " : ""}${binding.name} = ${printRustExpr(binding.value)};`)
        .join(" ");
      return `{ ${bindings}${bindings.length === 0 ? "" : " "}${printRustExpr(expression.value)} }`;
    }
    case "unsafe": {
      return `unsafe { ${printRustExpr(expression.expression)} }`;
    }
    case "evaluate-then": {
      return `{ let _ = ${printRustExpr(expression.effect)}; ${printRustExpr(expression.value)} }`;
    }
    case "string-concat": {
      const placeholders = expression.parts.map(() => "{}").join("");
      return `format!("${placeholders}", ${expression.parts.map(printRustExpr).join(", ")})`;
    }
    case "format-write": {
      const args = expression.args.length === 0
        ? ""
        : `, ${expression.args.map(printRustExpr).join(", ")}`;
      return `write!(${printRustExpr(expression.writer)}, "${escapeRustString(expression.format)}"${args})`;
    }
    case "reference": {
      const prefix = expression.mutable === true ? "&mut " : "&";
      const operand = expressionIsRightHandBlock(expression.expr)
        ? printRustExpr(expression.expr)
        : printOperand(expression.expr, RustPrecedence.Unary, false);
      return `${prefix}${operand}`;
    }
    case "vec-literal": {
      return `vec![${expression.elements.map(printRustExpr).join(", ")}]`;
    }
    case "slice-literal": {
      return `[${expression.elements.map(printRustExpr).join(", ")}]`;
    }
    case "closure": {
      const params = printRustClosureParams(expression.params);
      return `${expression.move === true ? "move " : ""}|${params}| ${printRustExpr(expression.body)}`;
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
    case "return-expression": {
      return expression.expr === undefined ? "return" : `return ${printRustExpr(expression.expr)}`;
    }
    case "unreachable": {
      return `unreachable!("${escapeRustString(expression.message)}")`;
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
    case "match":
      return true;
    case "unary":
      return rustExpressionContainsStatementBlock(expression.operand);
    case "bottom":
      return rustExpressionContainsStatementBlock(expression.expression);
    case "dereference":
      return rustExpressionContainsStatementBlock(expression.pointer);
    case "unsafe":
      return rustExpressionContainsStatementBlock(expression.expression);
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
    case "matches":
      return rustExpressionContainsStatementBlock(expression.expression);
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
    case "return-expression":
      return expression.expr !== undefined && rustExpressionContainsStatementBlock(expression.expr);
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
    case "bottom":
      return rustExpressionContainsClosure(expression.expression);
    case "dereference":
      return rustExpressionContainsClosure(expression.pointer);
    case "unsafe":
      return rustExpressionContainsClosure(expression.expression);
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
    case "match":
      return rustExpressionContainsClosure(expression.expression) ||
        expression.arms.some((arm) => rustExpressionContainsClosure(arm.expression));
    case "matches":
      return rustExpressionContainsClosure(expression.expression);
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
    case "return-expression":
      return expression.expr !== undefined && rustExpressionContainsClosure(expression.expr);
    case "struct-literal":
      return expression.fields.some((field) => rustExpressionContainsClosure(field.value));
    default:
      return false;
  }
}

function rustExpressionContainsPreferredVerticalMethodChain(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "method-call":
      return rustMethodChainPrefersVerticalLayout(expression) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.receiver) ||
        expression.args.some(rustExpressionContainsPreferredVerticalMethodChain);
    case "unary":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.operand);
    case "bottom":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression);
    case "dereference":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.pointer);
    case "unsafe":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression);
    case "numeric-cast":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression);
    case "binary":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.left) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.right);
    case "range":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.start) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.end);
    case "conditional":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.condition) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.whenTrue) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.whenFalse);
    case "match":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression) ||
        expression.arms.some((arm) =>
          rustExpressionContainsPreferredVerticalMethodChain(arm.expression));
    case "matches":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression);
    case "assignment":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.target) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.value);
    case "call":
    case "associated-call":
      return expression.args.some(rustExpressionContainsPreferredVerticalMethodChain);
    case "invoke":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.callee) ||
        expression.args.some(rustExpressionContainsPreferredVerticalMethodChain);
    case "field":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.receiver);
    case "index":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.receiver) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.index);
    case "block":
      return expression.bindings.some((binding) =>
        rustExpressionContainsPreferredVerticalMethodChain(binding.value)) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.value);
    case "evaluate-then":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.effect) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.value);
    case "string-concat":
      return expression.parts.some(rustExpressionContainsPreferredVerticalMethodChain);
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements.some(rustExpressionContainsPreferredVerticalMethodChain);
    case "reference":
    case "await":
    case "try":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expr);
    case "return-expression":
      return expression.expr !== undefined &&
        rustExpressionContainsPreferredVerticalMethodChain(expression.expr);
    case "closure":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.body);
    case "struct-literal":
      return expression.fields.some((field) =>
        rustExpressionContainsPreferredVerticalMethodChain(field.value));
    default:
      return false;
  }
}

function printRustExprFitted(
  expression: RustExpr,
  depth: number,
  column: number,
  methodChainContinuationIndent?: string,
  grammarPosition: RustExpressionGrammarPosition = "expression",
): string {
  const flat = printRustExpr(expression);
  switch (expression.kind) {
    case "bottom":
      return printRustExprFitted(
        expression.expression,
        depth,
        column,
        methodChainContinuationIndent,
        grammarPosition,
      );
    case "match":
      return printRustMatchExpression(expression, depth, column);
    case "matches": {
      if (!flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const argumentIndent = indentText(depth + 1);
      const matched = printRustExprFitted(
        expression.expression,
        depth + 1,
        argumentIndent.length,
      );
      return [
        "matches!(",
        appendToLastLine(`${argumentIndent}${matched}`, ","),
        `${argumentIndent}${printRustPattern(expression.pattern)},`,
        `${indentText(depth)})`,
      ].join("\n");
    }
    case "unreachable": {
      if (renderedFits(flat, column)) {
        return flat;
      }
      return [
        "unreachable!(",
        `${indentText(depth + 1)}"${escapeRustString(expression.message)}"`,
        `${indentText(depth)})`,
      ].join("\n");
    }
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
        undefined,
        "statement",
      );
      const whenFalse = printRustExprFitted(
        expression.whenFalse,
        depth + 1,
        branchIndent.length,
        undefined,
        "statement",
      );
      const header = condition.includes("\n") && lastLine(condition).trim() !== "}"
        ? `if ${condition}\n${indentText(depth)}{`
        : `if ${condition} {`;
      return [
        header,
        `${branchIndent}${whenTrue}`,
        `${indentText(depth)}} else {`,
        `${branchIndent}${whenFalse}`,
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "format-write": {
      if (expression.args.length <= 1 && !flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const argumentIndent = indentText(depth + 1);
      const flatFormatArguments = expression.args.map(printRustExpr).join(", ");
      const fittedFormatArguments = expression.args.length === 0
        ? []
        : !flatFormatArguments.includes("\n") && renderedFits(flatFormatArguments, argumentIndent.length)
        ? [`${argumentIndent}${flatFormatArguments}`]
        : expression.args.map((argument, index) =>
          appendToLastLine(
            `${argumentIndent}${printRustExprFitted(argument, depth + 1, argumentIndent.length)}`,
            index + 1 === expression.args.length ? "" : ",",
          ));
      return [
        "write!(",
        `${argumentIndent}${printRustExpr(expression.writer)},`,
        `${argumentIndent}"${escapeRustString(expression.format)}"${expression.args.length === 0 ? "" : ","}`,
        ...fittedFormatArguments,
        `${indentText(depth)})`,
      ].join("\n");
    }
    case "block": {
      const statementIndent = indentText(depth + 1);
      const bindings = expression.bindings.flatMap((binding) => {
        const prefix = `${statementIndent}let ${binding.mutable === true ? "mut " : ""}${binding.name} = `;
        return [
          ...(binding.attrs ?? []).map((attribute) => `${statementIndent}${attribute}`),
          printRustLetInitializer(prefix, binding.value, depth + 1),
        ];
      });
      const value = printRustExprFitted(
        expression.value,
        depth + 1,
        statementIndent.length,
        undefined,
        "statement",
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
      const value = printRustExprFitted(
        expression.value,
        depth + 1,
        statementIndent.length,
        undefined,
        "statement",
      );
      return [
        "{",
        `${effectPrefix}${effect};`,
        `${statementIndent}${value}`,
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "unsafe": {
      if (!rustExpressionContainsStatementBlock(expression.expression) &&
        !flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const expressionIndent = indentText(depth + 1);
      const selected = printRustExprFitted(
        expression.expression,
        depth + 1,
        expressionIndent.length,
        undefined,
        "statement",
      );
      return [
        "unsafe {",
        `${expressionIndent}${selected}`,
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "string-concat": {
      if (expression.parts.length <= rustFormatMacroInlineArgumentLimit &&
        !flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const trailingPart = expression.parts[expression.parts.length - 1];
      const leadingParts = expression.parts.slice(0, -1).map(printRustExpr);
      if (trailingPart !== undefined && leadingParts.every((part) => !part.includes("\n"))) {
        const prefix = `format!("${expression.parts.map(() => "{}").join("")}", ${
          leadingParts.length === 0 ? "" : `${leadingParts.join(", ")}, `
        }`;
        const trailing = printRustExprFitted(
          trailingPart,
          depth,
          column + prefix.length,
        );
        if (trailing.includes("\n") &&
          column + prefix.length + firstLine(trailing).length <= rustFormatWidth) {
          return appendToLastLine(`${prefix}${trailing}`, ",)");
        }
      }
      const argumentIndent = indentText(depth + 1);
      const placeholders = expression.parts.map(() => "{}").join("");
      const renderedParts = expression.parts.map((part) => {
        const rendered = printRustFormatArgument(
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
      {
        const trailingArgument = expression.args[expression.args.length - 1];
        const flatOwner = printRustAssociatedCallOwner(expression);
        const trailingClosureWidth = flatOwner.length > rustNestedCallWidth &&
            (trailingArgument?.kind === "closure" || trailingArgument?.kind === "closure-block")
          ? firstLine(printRustExpr(trailingArgument)).length
          : 0;
        const owner = printRustAssociatedCallOwnerFitted(
          expression,
          depth,
          column + `::${expression.method}(`.length + trailingClosureWidth,
        );
        if (owner.includes("\n") && expression.args.length === 1 &&
          (expression.args[0]?.kind === "closure" || expression.args[0]?.kind === "closure-block")) {
          const callable = appendToLastLine(owner, `::${expression.method}(`);
          const argument = printRustExprFitted(
            expression.args[0],
            depth,
            lastLineLength(callable),
          );
          return appendToLastLine(`${callable}${argument}`, ")");
        }
        return printFittedCall(
          appendToLastLine(owner, `::${expression.method}`),
          expression.args,
          depth,
          column,
          owner.includes("\n"),
        );
      }
    case "method-call": {
      const chain = rustMethodChain(expression);
      const verticalLayout = rustMethodChainPrefersVerticalLayout(expression);
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      const singleSelectorFits = chain !== undefined &&
        chain.steps.filter((step) => step.kind === "method" || step.kind === "field").length === 1 &&
        expression.receiver.kind === "path" &&
        expression.args.some((argument) => argument.kind === "try") &&
        !rustExpressionContainsExpandedStructLiteral(expression.receiver) &&
        column + receiver.length + expression.method.length + 2 <= rustFormatWidth;
      if (!flat.includes("\n") && renderedFits(flat, column) && !verticalLayout &&
        !rustExpressionContainsExpandedStructLiteral(expression)) {
        return flat;
      }
      const hasClosure = expression.args.some((argument) =>
        argument.kind === "closure" || argument.kind === "closure-block");
      if (hasClosure && rustMethodCallKeepsTrailingClosureAttached(expression, depth, column)) {
        return printFittedCall(`${receiver}.${expression.method}`, expression.args, depth, column);
      }
      if (chain !== undefined && hasClosure && !renderedFits(flat, column)) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          rustMethodChainBreaksReceiverWhenExpanded(chain),
          methodChainContinuationIndent,
        );
      }
      if (chain !== undefined && verticalLayout) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          chain.steps[0]?.kind === "field" || rustMethodChainContainsClosure(chain) ||
            column > indentText(depth + 1).length,
          methodChainContinuationIndent,
        );
      }
      if (chain !== undefined && rustMethodChainBreaksReceiverWhenExpanded(chain) &&
        !singleSelectorFits) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          hasClosure,
          methodChainContinuationIndent,
        );
      }
      if (hasClosure) {
        return printFittedCall(`${receiver}.${expression.method}`, expression.args, depth, column);
      }
      return printFittedCall(`${receiver}.${expression.method}`, expression.args, depth, column);
    }
    case "closure": {
      if (!flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const params = printRustClosureParams(expression.params);
      const prefix = `${expression.move === true ? "move " : ""}|${params}|`;
      const indent = indentText(depth + 1);
      if (expression.body.kind === "block") {
        const bindings = expression.body.bindings.flatMap((binding) => {
          const prefix = `${indent}let ${binding.mutable === true ? "mut " : ""}${binding.name} = `;
          return [
            ...(binding.attrs ?? []).map((attribute) => `${indent}${attribute}`),
            printRustLetInitializer(prefix, binding.value, depth + 1),
          ];
        });
        const value = printRustExprFitted(
          expression.body.value,
          depth + 1,
          indent.length,
          undefined,
          "statement",
        );
        return [
          `${prefix} {`,
          ...bindings,
          `${indent}${value}`,
          `${indentText(depth)}}`,
        ].join("\n");
      }
      const body = printRustExprFitted(
        expression.body,
        depth + 1,
        indent.length,
      );
      return [`${prefix} {`, `${indent}${body}`, `${indentText(depth)}}`].join("\n");
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
    case "try": {
      if ((expression.expr.kind === "call" || expression.expr.kind === "associated-call") &&
        !renderedFits(flat, column)) {
        return printNestedCallArgument(expression, depth, column, true);
      }
      if (expression.expr.kind === "method-call" &&
        rustMethodCallKeepsTrailingClosureAttached(expression.expr, depth, column + 1)) {
        const receiver = printOperand(expression.expr.receiver, RustPrecedence.Postfix, false);
        return appendToLastLine(printFittedCall(
          `${receiver}.${expression.expr.method}`,
          expression.expr.args,
          depth,
          column + 1,
        ), "?");
      }
      return appendToLastLine(printRustExprFitted(expression.expr, depth, column + 1), "?");
    }
    case "return-expression": {
      if (expression.expr === undefined) {
        return "return";
      }
      const prefix = "return ";
      return `${prefix}${printRustExprFitted(expression.expr, depth, column + prefix.length)}`;
    }
    case "reference": {
      const prefix = expression.mutable === true ? "&mut " : "&";
      const parenthesized = !expressionIsRightHandBlock(expression.expr) &&
        expressionNeedsParentheses(expression.expr, RustPrecedence.Unary, false);
      const rendered = printRustExprFitted(
        expression.expr,
        depth,
        column + prefix.length + (parenthesized ? 1 : 0),
      );
      return `${prefix}${parenthesized ? `(${rendered})` : rendered}`;
    }
    case "index": {
      if (!flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const receiver = printRustExprFitted(expression.receiver, depth, column);
      if (!receiver.includes("\n")) {
        const continuation = indentText(depth + 1);
        const index = printRustExprFitted(
          expression.index,
          depth + 1,
          continuation.length + 1,
        );
        return `${receiver}\n${continuation}[${index}]`;
      }
      const opening = appendToLastLine(receiver, "[");
      const index = printRustExprFitted(
        expression.index,
        depth,
        lastLineLength(opening),
      );
      return appendToLastLine(`${opening}${index}`, "]");
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
        return printFittedLogicalChain(
          expression,
          expression.operator,
          depth,
          column,
          grammarPosition,
        );
      }
      if (expression.left.kind === "binary" &&
        expression.left.operator === expression.operator) {
        return printFittedLeftAssociativeBinaryChain(
          expression,
          expression.operator,
          depth,
          column,
          grammarPosition,
        );
      }
      const expandedLeftCall = expression.left.kind === "call" &&
          expression.left.args.length > 1 &&
          !rustExpressionContainsStatementBlock(expression.left)
        ? printFittedCall(
            expression.left.path,
            expression.left.args,
            depth,
            column,
            true,
          )
        : expression.left.kind === "associated-call" &&
            expression.left.args.length > 1 &&
            !rustExpressionContainsStatementBlock(expression.left)
          ? printFittedCall(
              `${printRustAssociatedCallOwner(expression.left)}::${expression.left.method}`,
              expression.left.args,
              depth,
              column,
              true,
            )
          : undefined;
      const renderedLeft = expandedLeftCall ?? (expression.left.kind === "try" &&
          (expression.left.expr.kind === "call" || expression.left.expr.kind === "associated-call") &&
          expression.left.expr.args.length > 1
        ? printNestedCallArgument(expression.left, depth, column, true)
        : printRustExprFitted(
            expression.left,
            depth,
            column,
            methodChainContinuationIndent ??
              (column > indentText(depth).length ? indentText(depth + 1) : undefined),
            grammarPosition,
          ));
      const left = printFittedBinaryOperand(
        expression.left,
        renderedLeft,
        expression.operator,
        false,
        grammarPosition === "statement" && expressionIsStatementBlockOperand(expression.left),
      );
      if (expression.right.kind === "match") {
        if (expression.left.kind === "match" && left.includes("\n")) {
          const renderedRight = printFittedBinaryOperand(
            expression.right,
            printRustExprFitted(
              expression.right,
              depth,
              lastLineLength(left) + expression.operator.length + 2,
            ),
            expression.operator,
            true,
          );
          const attached = appendToLastLine(
            left,
            ` ${expression.operator} ${firstLine(renderedRight)}`,
          );
          const rest = remainingLines(renderedRight);
          return rest.length === 0 ? attached : `${attached}\n${rest.join("\n")}`;
        }
        const continuationIndent = indentText(depth + 1);
        const continuedRight = printFittedBinaryOperand(
          expression.right,
          printRustExprFitted(
            expression.right,
            depth + 1,
            continuationIndent.length + expression.operator.length + 1,
          ),
          expression.operator,
          true,
        );
        const continuation = `${continuationIndent}${expression.operator} ${firstLine(continuedRight)}`;
        return remainingLines(continuedRight).length === 0
          ? `${left}\n${continuation}`
          : `${left}\n${continuation}\n${remainingLines(continuedRight).join("\n")}`;
      }
      if (!left.includes("\n") && expressionIsRightHandBlock(expression.right)) {
        const separator = ` ${expression.operator} `;
        const renderedRight = printRustExprFitted(
          expression.right,
          depth,
          column + left.length + separator.length,
        );
        return `${left}${separator}${renderedRight}`;
      }
      if (left.includes("\n") &&
        (expression.left.kind === "call" || expression.left.kind === "associated-call") &&
        (expression.right.kind === "call" || expression.right.kind === "associated-call")) {
        const separator = ` ${expression.operator} `;
        const renderedRight = printRustExprFitted(
          expression.right,
          depth,
          lastLineLength(left) + separator.length,
        );
        const attached = appendToLastLine(left, `${separator}${renderedRight}`);
        if (renderedFits(attached, column)) {
          return attached;
        }
      }
      const joined = appendToLastLine(
        left,
        ` ${expression.operator} ${printBinaryOperand(expression.right, expression.operator, true)}`,
      );
      if (left.includes("\n") && expressionIsStatementBlockOperand(expression.left) &&
        !rustExpressionContainsStatementBlock(expression.right)) {
        const renderedRight = printRustExprFitted(
          expression.right,
          depth,
          lastLineLength(left) + expression.operator.length + 2,
        );
        return appendToLastLine(left, ` ${expression.operator} ${renderedRight}`);
      }
      const multilineLeftRequiresOwnOperator = left.includes("\n") &&
        (expression.left.kind === "binary" || expression.left.kind === "index" ||
          rustMethodChain(expression.left) !== undefined);
      if (!multilineLeftRequiresOwnOperator && renderedFits(joined, column)) {
        return joined;
      }
      const continuationIndent = indentText(depth + 1);
      const renderedRight = printRustExprFitted(
        expression.right,
        depth + 1,
        continuationIndent.length + expression.operator.length + 1,
      );
      const right = printFittedBinaryOperand(
        expression.right,
        renderedRight,
        expression.operator,
        true,
      );
      const continuation = `${continuationIndent}${expression.operator} ${firstLine(right)}`;
      return remainingLines(right).length === 0
        ? `${left}\n${continuation}`
        : `${left}\n${continuation}\n${remainingLines(right).join("\n")}`;
    }
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal": {
      if (!flat.includes("\n") && flat.length <= rustNestedCallWidth &&
        renderedFits(flat, column)) {
        return flat;
      }
      const onlyElement = expression.elements[0];
      if (expression.kind === "tuple-literal" && expression.elements.length === 1 &&
        onlyElement !== undefined) {
        const rendered = printRustExprFitted(onlyElement, depth, column + 1);
        return appendToLastLine(`(${rendered}`, ",)");
      }
      if (expression.kind !== "tuple-literal" && expression.elements.length === 1 &&
        onlyElement !== undefined && rustExpressionContainsStatementBlock(onlyElement)) {
        const opening = expression.kind === "vec-literal" ? "vec![" : "[";
        const rendered = printRustExprFitted(
          onlyElement,
          depth,
          column + opening.length,
        );
        return appendToLastLine(`${opening}${rendered}`, "]");
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

function printRustAssociatedCallOwner(
  expression: Extract<RustExpr, { readonly kind: "associated-call" }>,
): string {
  return expression.trait === undefined
    ? printRustAssociatedOwner(expression.owner)
    : `<${printRustType(expression.owner)} as ${printRustType(expression.trait)}>`;
}

function printRustAssociatedCallOwnerFitted(
  expression: Extract<RustExpr, { readonly kind: "associated-call" }>,
  depth: number,
  column: number,
): string {
  if (expression.trait !== undefined) {
    return printRustAssociatedCallOwner(expression);
  }
  return printRustAssociatedOwnerFitted(expression.owner, depth, column);
}

function printRustAssociatedOwnerFitted(
  owner: RustType,
  depth: number,
  column: number,
): string {
  if (owner.kind !== "named" || owner.typeArguments === undefined || owner.typeArguments.length === 0) {
    return printRustType(owner);
  }
  const flat = printRustAssociatedOwner(owner);
  if (renderedFits(flat, column) && column + flat.length + 1 < rustFormatWidth) {
    return flat;
  }
  const argumentIndent = indentText(depth + 1);
  const arguments_ = owner.typeArguments.map((argument) => {
    const rendered = printRustTypeFitted(argument, depth + 1, argumentIndent.length);
    return appendToLastLine(`${argumentIndent}${rendered}`, ",");
  });
  return [
    `${owner.path}::<`,
    ...arguments_,
    `${indentText(depth)}>`,
  ].join("\n");
}

function printRustTypeFitted(
  type: RustType,
  depth: number,
  column: number,
): string {
  const flat = printRustType(type);
  if (renderedFits(flat, column) && column + flat.length + 1 < rustFormatWidth) {
    return flat;
  }
  if (type.kind === "tuple") {
    const elementIndent = indentText(depth + 1);
    return [
      "(",
      ...type.elements.map((element) =>
        appendToLastLine(
          `${elementIndent}${printRustTypeFitted(element, depth + 1, elementIndent.length)}`,
          ",",
        )),
      `${indentText(depth)})`,
    ].join("\n");
  }
  if (type.kind === "named" && type.typeArguments !== undefined && type.typeArguments.length > 0) {
    const argumentIndent = indentText(depth + 1);
    return [
      `${type.path}<`,
      ...type.typeArguments.map((argument) => {
        const rendered = printRustTypeFitted(argument, depth + 1, argumentIndent.length);
        return appendToLastLine(`${argumentIndent}${rendered}`, ",");
      }),
      `${indentText(depth)}>`,
    ].join("\n");
  }
  return flat;
}

function printRustLetInitializer(
  prefix: string,
  initializer: RustExpr,
  depth: number,
): string {
  const flat = printRustExpr(initializer);
  const trailingClosure = initializer.kind === "call" || initializer.kind === "associated-call" ||
      initializer.kind === "method-call"
    ? initializer.args[initializer.args.length - 1]
    : undefined;
  if (trailingClosure?.kind === "closure" || trailingClosure?.kind === "closure-block") {
    const continuationIndent = indentText(depth + 1);
    const continuation = printRustExprFitted(
      initializer,
      depth + 1,
      continuationIndent.length,
    );
    if (prefix.length + firstLine(continuation).length + 1 > rustFormatWidth &&
      renderedFits(continuation, continuationIndent.length)) {
      return `${prefix.trimEnd()}\n${continuationIndent}${continuation};`;
    }
  }
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
    initializer.kind !== "struct-literal" &&
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
  grammarPosition: RustExpressionGrammarPosition,
): string {
  const operands: RustExpr[] = [];
  collectLogicalOperands(expression, operator, operands);
  const first = operands[0];
  if (first === undefined) {
    return printRustExpr(expression);
  }
  let rendered = printFittedLogicalOperand(
    first,
    operator,
    depth,
    column,
    grammarPosition,
  );
  const continuationIndent = indentText(depth + 1);
  for (const operand of operands.slice(1)) {
    const attachedToClosingBlock = lastLine(rendered).trim() === "}";
    const operandDepth = rustExpressionContainsStatementBlock(operand) && attachedToClosingBlock
      ? depth
      : depth + 1;
    const right = printFittedLogicalOperand(
      operand,
      operator,
      operandDepth,
      continuationIndent.length + operator.length + 1,
      "expression",
    );
    const continuation = `${operator} ${firstLine(right)}`;
    rendered = attachedToClosingBlock
      ? appendToLastLine(rendered, ` ${continuation}`)
      : `${rendered}\n${continuationIndent}${continuation}`;
    const rest = remainingLines(right);
    if (rest.length > 0) {
      rendered += `\n${rest.join("\n")}`;
    }
  }
  return rendered;
}

function printFittedLeftAssociativeBinaryChain(
  expression: Extract<RustExpr, { readonly kind: "binary" }>,
  operator: string,
  depth: number,
  column: number,
  grammarPosition: RustExpressionGrammarPosition,
): string {
  const operands: RustExpr[] = [];
  collectLeftAssociativeBinaryOperands(expression, operator, operands);
  const first = operands[0];
  if (first === undefined) {
    return printRustExpr(expression);
  }
  let rendered = printRustExprFitted(first, depth, column, undefined, grammarPosition);
  const continuationIndent = indentText(depth + 1);
  for (const operand of operands.slice(1)) {
    const right = printFittedBinaryOperand(
      operand,
      printRustExprFitted(
        operand,
        depth + 1,
        continuationIndent.length + operator.length + 1,
      ),
      operator,
      true,
    );
    rendered += `\n${continuationIndent}${operator} ${firstLine(right)}`;
    const rest = remainingLines(right);
    if (rest.length > 0) {
      rendered += `\n${rest.join("\n")}`;
    }
  }
  return rendered;
}

function collectLeftAssociativeBinaryOperands(
  expression: RustExpr,
  operator: string,
  operands: RustExpr[],
): void {
  if (expression.kind === "binary" && expression.operator === operator) {
    collectLeftAssociativeBinaryOperands(expression.left, operator, operands);
    operands.push(expression.right);
    return;
  }
  operands.push(expression);
}

function printRustFormatArgument(
  expression: RustExpr,
  depth: number,
  column: number,
): string {
  if ((expression.kind === "call" || expression.kind === "associated-call") &&
    expression.args.length === 1) {
    const argument = expression.args[0]!;
    const callable = expression.kind === "call"
      ? expression.path
      : `${printRustAssociatedCallOwner(expression)}::${expression.method}`;
    const prefix = `${callable}(`;
    const renderedArgument = printRustExprFitted(
      argument,
      depth,
      column + prefix.length,
    );
    if (renderedArgument.includes("\n")) {
      const attached = appendToLastLine(`${prefix}${renderedArgument}`, ",)");
      if (firstLine(attached).length <= rustNestedCallWidth &&
        (renderedFits(attached, column) || rustExpressionContainsStatementBlock(argument))) {
        return attached;
      }
      return printFittedCall(callable, [argument], depth, column, true);
    }
    const borrowedNested = printBorrowedNestedRustFormatArgument(
      callable,
      argument,
      expression,
      depth,
      column,
    );
    if (borrowedNested !== undefined) {
      return borrowedNested;
    }
  }
  return printRustExprFitted(expression, depth, column);
}

function printBorrowedNestedRustFormatArgument(
  outerCallable: string,
  argument: RustExpr,
  expression: RustExpr,
  depth: number,
  column: number,
): string | undefined {
  if (argument.kind !== "reference" || renderedFits(printRustExpr(expression), column)) {
    return undefined;
  }
  const nested = argument.expr;
  const nestedCall = nested.kind === "call"
    ? { callable: nested.path, arguments: nested.args }
    : nested.kind === "associated-call"
      ? {
          callable: `${printRustAssociatedCallOwner(nested)}::${nested.method}`,
          arguments: nested.args,
        }
      : nested.kind === "method-call"
        ? {
            callable: `${printOperand(nested.receiver, RustPrecedence.Postfix, false)}.${nested.method}`,
            arguments: nested.args,
          }
        : undefined;
  const nestedArgument = nestedCall?.arguments[0];
  if (nestedCall === undefined || nestedCall.arguments.length !== 1 ||
    nestedArgument === undefined || rustExpressionContainsStatementBlock(nestedArgument) ||
    rustExpressionContainsExpandedStructLiteral(nestedArgument) ||
    rustExpressionContainsPreferredVerticalMethodChain(nestedArgument)) {
    return undefined;
  }
  const referencePrefix = argument.mutable === true ? "&mut " : "&";
  const opening = `${outerCallable}(${referencePrefix}${nestedCall.callable}(`;
  const renderedArgument = printRustExpr(nestedArgument);
  const argumentIndent = indentText(depth + 1);
  if (!renderedFits(opening, column) || renderedArgument.includes("\n") ||
    !renderedFits(renderedArgument, argumentIndent.length)) {
    return undefined;
  }
  return [
    opening,
    `${argumentIndent}${renderedArgument}`,
    `${indentText(depth)}),)`,
  ].join("\n");
}

function printFittedLogicalOperand(
  operand: RustExpr,
  operator: "||" | "&&",
  depth: number,
  column: number,
  grammarPosition: RustExpressionGrammarPosition,
): string {
  const parenthesized = expressionPrecedence(operand) < operatorPrecedence(operator) ||
    grammarPosition === "statement" && expressionIsStatementBlockOperand(operand);
  const rendered = printRustExprFitted(
    operand,
    depth,
    column + (parenthesized ? 1 : 0),
    undefined,
    grammarPosition,
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
    !rustMethodCallKeepsTrailingClosureAttached(expression, 0, 0) &&
    printRustExpr(expression).length > rustMethodChainWidth &&
    chain.steps.filter((step) => step.kind === "method" || step.kind === "field").length > 1;
}

function rustMethodCallKeepsTrailingClosureAttached(
  expression: RustExpr,
  depth: number,
  column: number,
): boolean {
  if (expression.kind !== "method-call") {
    return false;
  }
  const trailing = expression.args[expression.args.length - 1];
  if (trailing?.kind !== "closure" && trailing?.kind !== "closure-block") {
    return false;
  }
  const preceding = expression.args.slice(0, -1).map(printRustExpr);
  if (preceding.some((argument) => argument.includes("\n"))) {
    return false;
  }
  const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
  const prefix = `${receiver}.${expression.method}(${preceding.length === 0 ? "" : `${preceding.join(", ")}, `}`;
  const renderedClosure = printRustExprFitted(
    trailing,
    depth,
    column + prefix.length,
  );
  if (trailing.kind === "closure" && renderedClosure.includes("\n")) {
    const flatClosure = printRustExpr(trailing);
    const continuationWidth = indentText(depth + 1).length + expression.method.length +
      (preceding.length === 0 ? 3 : preceding.join(", ").length + 5) + flatClosure.length;
    if (!flatClosure.includes("\n") && continuationWidth <= rustFormatWidth) {
      return false;
    }
  }
  const closureOpening = firstLine(renderedClosure);
  const openingWidth = prefix.length + closureOpening.length + 1;
  const selectorCount = rustMethodChain(expression)?.steps.filter((step) =>
    step.kind === "method" || step.kind === "field").length ?? 1;
  return column + openingWidth <= rustFormatWidth &&
    (selectorCount === 1 || openingWidth <= rustMethodChainWidth);
}

function rustMethodChainPrefersVerticalLayout(expression: RustExpr): boolean {
  const chain = rustMethodChain(expression);
  return rustMethodChainRequiresVerticalLayout(expression) ||
    chain !== undefined && printRustExpr(expression).length > rustNestedCallWidth &&
    chain.steps.some((step) => step.kind === "method" && step.args.some((argument) =>
      argument.kind !== "closure" && argument.kind !== "closure-block" && argument.kind !== "block" &&
      rustExpressionContainsClosure(argument)));
}

function rustMethodChainBreaksReceiverWhenExpanded(chain: RustMethodChain): boolean {
  const first = chain.steps[0];
  const firstSelectorWidth = first?.kind === "method" || first?.kind === "field"
    ? first.name.length + 1
    : first?.kind === "try" ? 1 : 0;
  return chain.steps.filter((step) => step.kind === "method" || step.kind === "field").length > 1 ||
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
  breakBeforeFirstSelector = false,
  continuationIndent = indentText(depth + 1),
): string {
  const flatBase = printRustExpr(chain.base);
  let rendered = !flatBase.includes("\n") && renderedFits(flatBase, column) &&
      !rustExpressionContainsExpandedStructLiteral(chain.base)
    ? flatBase
    : printRustExprFitted(chain.base, depth, column);
  const selectedContinuationIndent = rendered.includes("\n")
    ? indentText(depth)
    : continuationIndent;
  const breakBeforeFirstField = breakBeforeFirstSelector && !rustMethodChainContainsClosure(chain);
  let emittedCall = false;
  for (const step of chain.steps) {
    if (step.kind === "try") {
      rendered = appendToLastLine(rendered, "?");
      continue;
    }
    if (step.kind === "field") {
      rendered = breakBeforeFirstField || emittedCall || rendered.includes("\n") ||
          lastLineLength(rendered) + step.name.length + 1 > rustInlineFieldReceiverWidth
        ? `${rendered}\n${selectedContinuationIndent}.${step.name}`
        : appendToLastLine(rendered, `.${step.name}`);
      continue;
    }
    const inlineMethod = printFittedCall(
      `.${step.name}`,
      step.args,
      depth,
      selectedContinuationIndent.length + 1,
      false,
      false,
      depth,
    );
    const inlineFirstMethod = !breakBeforeFirstSelector && !emittedCall &&
      !rendered.includes("\n") &&
      lastLineLength(rendered) + firstLine(inlineMethod).length <= rustInlineFieldReceiverWidth;
    const method = inlineFirstMethod
      ? inlineMethod
      : printFittedCall(
          `.${step.name}`,
          step.args,
          depth + 1,
          selectedContinuationIndent.length + 1,
          false,
          false,
          depth,
        );
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
  inlineArgumentDepth = depth,
): string {
  const flatArguments = arguments_.map(printRustExpr).join(", ");
  const flat = `${callable}(${flatArguments})`;
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
  if (!forceExpanded && arguments_.length > 1 &&
    (trailingClosure?.kind === "block" || trailingClosure?.kind === "match" ||
      trailingClosure?.kind === "conditional")) {
    const preceding = arguments_.slice(0, -1).map(printRustExpr);
    if (preceding.every((argument) => !argument.includes("\n"))) {
      const prefix = `${callable}(${preceding.join(", ")}, `;
      if (column + prefix.length <= rustFormatWidth) {
        return appendToLastLine(
          `${prefix}${printRustExprFitted(
            trailingClosure,
            inlineArgumentDepth,
            column + prefix.length,
          )}`,
          ")",
        );
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
  if (arguments_.length === 1 &&
    (arguments_[0]?.kind === "block" || arguments_[0]?.kind === "match" ||
      arguments_[0]?.kind === "conditional")) {
    const prefix = `${callable}(`;
    const renderedArgument = printRustExprFitted(
      arguments_[0],
      inlineArgumentDepth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${renderedArgument}`, ")");
    if (renderedFits(attached, column) &&
      !(arguments_[0].kind === "match" &&
        (firstLine(attached).length > rustNestedCallWidth ||
          !firstLine(renderedArgument).trimEnd().endsWith("{")))) {
      return attached;
    }
    const argumentIndent = indentText(depth + 1);
    const expanded = printRustExprFitted(
      arguments_[0],
      depth + 1,
      argumentIndent.length,
    );
    return [
      `${callable}(`,
      appendToLastLine(`${argumentIndent}${expanded}`, ","),
      `${indentText(depth)})`,
    ].join("\n");
  }
  if (!forceExpanded && arguments_.length === 1 && arguments_[0]?.kind === "reference" &&
    rustExpressionContainsStatementBlock(arguments_[0])) {
    const prefix = `${callable}(`;
    const rendered = printRustExprFitted(
      arguments_[0],
      inlineArgumentDepth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    if (renderedFits(attached, column)) {
      return attached;
    }
  }
  if (arguments_.length === 1 && arguments_[0]?.kind === "binary" &&
    (arguments_[0].operator === "+" || arguments_[0].operator === "-" ||
      arguments_[0].operator === "*" || arguments_[0].operator === "/" ||
      arguments_[0].operator === "%") &&
    !rustExpressionContainsStatementBlock(arguments_[0])) {
    const prefix = `${callable}(`;
    const rendered = printRustExprFitted(
      arguments_[0],
      inlineArgumentDepth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    if (renderedFits(attached, column)) {
      return attached;
    }
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
  if (arguments_.length === 1 && arguments_[0]?.kind === "method-call") {
    const prefix = `${callable}(`;
    const directChain = rustMethodChain(arguments_[0]);
    const expandedAggregateArgument = arguments_[0].args.some((argument) =>
      (argument.kind === "slice-literal" || argument.kind === "vec-literal") &&
      (argument.elements.length > 1 || rustExpressionContainsStatementBlock(argument)));
    if (directChain?.steps.length === 1 && expandedAggregateArgument) {
      const nested = printRustExprFitted(
        arguments_[0],
        depth,
        column + prefix.length,
      );
      const nestedAtExpandedColumn = printRustExprFitted(
        arguments_[0],
        depth + 1,
        indentText(depth + 1).length,
      );
      const attached = appendToLastLine(`${prefix}${nested}`, ")");
      if (nested.includes("\n") && nestedAtExpandedColumn.includes("\n") &&
        renderedFits(attached, column)) {
        return attached;
      }
    }
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
  if (forceExpanded && arguments_.length === 1 && arguments_[0]?.kind === "method-call") {
    const chain = rustMethodChain(arguments_[0]);
    if (chain !== undefined && chain.steps.length > 1 &&
      printRustExpr(arguments_[0]).length > rustMethodChainWidth) {
      const argumentIndent = indentText(depth + 1);
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
  if (forceExpanded && arguments_.length === 1) {
    const argument = arguments_[0]!;
    if (argument.kind === "call" || argument.kind === "associated-call" ||
      argument.kind === "method-call" || argument.kind === "try") {
      if (argument.kind === "call" || argument.kind === "associated-call") {
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
        if (!(argument.kind === "method-call" && nested.includes("\n")) &&
          renderedFits(compact, column)) {
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
      (argument.operand.kind === "call" ||
        argument.operand.kind === "associated-call" ||
        argument.operand.kind === "method-call") &&
      printRustExpr(argument.operand).length > rustNestedCallWidth) {
      const nested = printNestedCallArgument(
        argument.operand,
        depth,
        column + prefix.length + argument.operator.length,
        true,
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
    } else if (argument.kind === "reference" &&
      (argument.expr.kind === "call" || argument.expr.kind === "associated-call" ||
        argument.expr.kind === "method-call" || argument.expr.kind === "try")) {
      const nested = printNestedCallArgument(
        argument.expr,
        depth,
        column + prefix.length + 1,
        false,
      );
      const compact = appendToLastLine(`${prefix}&${nested}`, ")");
      if (renderedFits(compact, column)) {
        return compact;
      }
    } else if (!rustExpressionContainsStatementBlock(argument) &&
      !rustExpressionContainsPreferredVerticalMethodChain(argument) &&
      !rustExpressionContainsExpandedStructLiteral(argument) && renderedFits(flat, column)) {
      return flat;
    }
  } else if (!forceExpanded && !arguments_.some(rustExpressionContainsStatementBlock) &&
    !arguments_.some(rustExpressionContainsPreferredVerticalMethodChain) &&
    !arguments_.some(rustExpressionContainsExpandedStructLiteral) &&
    !flat.includes("\n") && renderedFits(flat, column) &&
    (arguments_.length <= 1 || flatArguments.length <= rustNestedCallWidth)) {
    return flat;
  }
  const argumentIndent = indentText(depth + 1);
  if (forceExpanded && arguments_.length > 1 && flat.length <= rustNestedCallWidth) {
    const compactArguments = arguments_.map(printRustExpr).join(", ");
    if (!compactArguments.includes("\n") &&
      compactArguments.length <= rustInlineFieldReceiverWidth &&
      renderedFits(`${compactArguments},`, argumentIndent.length)) {
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
  if (nested.kind === "associated-call" && nested.args.length === 1 &&
    (nested.args[0]?.kind === "closure" || nested.args[0]?.kind === "closure-block")) {
    const owner = printRustAssociatedCallOwnerFitted(
      nested,
      depth,
      column + outerCallable.length + 1,
    );
    if (owner.includes("\n")) {
      const opening = appendToLastLine(
        `${outerCallable}(${owner}`,
        `::${nested.method}(`,
      );
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
  }
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
  if (nested.args.length === 0 || nested.args.some(rustExpressionContainsStatementBlock)) {
    return undefined;
  }
  const opening = `${outerCallable}(${nestedCallable}(`;
  if (renderedFits(opening, column)) {
    const nestedRendered = printFittedCall(
      nestedCallable,
      nested.args,
      depth,
      column + outerCallable.length + 1,
      true,
    );
    const attached = appendToLastLine(`${outerCallable}(${nestedRendered}`, ")");
    if (nestedRendered.includes("\n") && renderedFits(attached, column)) {
      return attached;
    }
  }
  const argumentIndent = indentText(depth + 1);
  const nestedRendered = printFittedCall(
    nestedCallable,
    nested.args,
    depth + 1,
    argumentIndent.length,
  );
  const expanded = [
    `${outerCallable}(`,
    appendToLastLine(`${argumentIndent}${nestedRendered}`, ","),
    `${indentText(depth)})`,
  ].join("\n");
  return renderedFits(expanded, column) ? expanded : undefined;
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
    rustMethodCallKeepsTrailingClosureAttached(argument, depth, column)) {
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
    case "bottom":
      return rustExpressionContainsExpandedStructLiteral(expression.expression);
    case "unary":
      return rustExpressionContainsExpandedStructLiteral(expression.operand);
    case "dereference":
      return rustExpressionContainsExpandedStructLiteral(expression.pointer);
    case "unsafe":
      return rustExpressionContainsExpandedStructLiteral(expression.expression);
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
    case "match":
      return rustExpressionContainsExpandedStructLiteral(expression.expression) ||
        expression.arms.some((arm) =>
          rustExpressionContainsExpandedStructLiteral(arm.expression));
    case "matches":
      return rustExpressionContainsExpandedStructLiteral(expression.expression);
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
    case "return-expression":
      return expression.expr !== undefined &&
        rustExpressionContainsExpandedStructLiteral(expression.expr);
    case "closure":
      return rustExpressionContainsExpandedStructLiteral(expression.body);
    default:
      return false;
  }
}

function printRustPattern(pattern: RustPattern): string {
  switch (pattern.kind) {
    case "wildcard":
      return "_";
    case "binding":
      return pattern.name;
    case "path":
      return pattern.path;
    case "tuple": {
      const elements = pattern.elements.map(printRustPattern).join(", ");
      return `(${elements}${pattern.elements.length === 1 ? "," : ""})`;
    }
    case "tuple-variant":
      return `${pattern.path}(${pattern.elements.map(printRustPattern).join(", ")})`;
  }
}

function printRustMatchExpression(
  expression: Extract<RustExpr, { readonly kind: "match" }>,
  depth: number,
  column = 0,
): string {
  const matched = printRustExprFitted(
    expression.expression,
    depth,
    column + "match ".length,
  );
  const inlineHeader = `match ${matched} {`;
  const header = matched.includes("\n") || !renderedFits(inlineHeader, column)
    ? `match ${matched}\n${indentText(depth)}{`
    : inlineHeader;
  const armIndent = indentText(depth + 1);
  const arms = expression.arms.flatMap((arm) => {
    const pattern = printRustPattern(arm.pattern);
    if (arm.expression.kind === "return-expression" || arm.expression.kind === "try") {
      const valueIndent = indentText(depth + 2);
      const value = printRustExprFitted(arm.expression, depth + 2, valueIndent.length);
      const statement = arm.expression.kind === "return-expression"
        ? appendToLastLine(value, ";")
        : value;
      return [
        `${armIndent}${pattern} => {`,
        `${valueIndent}${statement}`,
        `${armIndent}}`,
      ];
    }
    const prefix = `${armIndent}${pattern} => `;
    const flatValue = printRustExpr(arm.expression);
    if (flatValue.includes("\n") || !renderedFits(`${prefix}${flatValue},`, 0)) {
      if (arm.expression.kind === "call" || arm.expression.kind === "associated-call" ||
        arm.expression.kind === "invoke") {
        const directValue = printRustExprFitted(
          arm.expression,
          depth + 1,
          prefix.length,
        );
        return [appendToLastLine(`${prefix}${directValue}`, ",")];
      }
      const valueIndent = indentText(depth + 2);
      const value = printRustExprFitted(arm.expression, depth + 2, valueIndent.length);
      return [
        `${armIndent}${pattern} => {`,
        `${valueIndent}${value}`,
        `${armIndent}}`,
      ];
    }
    const value = printRustExprFitted(arm.expression, depth + 1, prefix.length);
    return [appendToLastLine(`${prefix}${value}`, ",")];
  });
  return [header, ...arms, `${indentText(depth)}}`].join("\n");
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

function lastLine(rendered: string): string {
  const lines = rendered.split("\n");
  return lines[lines.length - 1] ?? rendered;
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
