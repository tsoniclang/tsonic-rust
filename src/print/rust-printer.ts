import type {
  RustBlock,
  RustExpr,
  RustItem,
  RustPattern,
  RustSourceFileModel,
  RustStmt,
  RustStructField,
  RustType,
  RustVisibility,
} from "../backend/rust-ast/nodes.js";
import type { RustAssignmentOperator } from "../common/rust-syntax.js";
import { finalizeRustSourceStyle } from "../backend/rust-ast/source-style.js";
import { rustExpressionContainsStatementBlock } from "../backend/rust-ast/expressions.js";
import { rustExpressionChildren } from "../backend/rust-ast/source-usage.js";

// Deterministic printer. Output must be `cargo fmt --check` clean for the
// supported construct set: 4-space indent, no trailing whitespace, one blank
// line between items, trailing newline.

const rustFormatWidth = 100;
const rustSingleLineConditionalWidth = 50;
const rustStructLiteralWidth = 18;
const rustNestedCallWidth = 60;
const rustNestedClosureOpeningWidth = 80;
const rustInlineFormatArgumentWidth = 40;
const rustMethodChainWidth = 60;
const rustNestedMethodFirstSegmentWidth = 64;
const rustInlineFieldReceiverWidth = 28;
const rustInlineClosureFieldReceiverWidth = 10;

interface RustFunctionParameterPrint {
  readonly prefix: string;
  readonly type?: RustType;
}

function printRustVisibility(visibility: RustVisibility): string {
  return visibility === "public" ? "pub " : visibility === "crate" ? "pub(crate) " : "";
}

export function printRustSourceFile(model: RustSourceFileModel): string {
  const finalized = finalizeRustSourceStyle(model);
  const parts: string[] = [`// ${finalized.headerComment}`];
  if (finalized.innerAttrs !== undefined) {
    parts.push(...finalized.innerAttrs);
  }
  for (const item of finalized.items) {
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
      const prefix = `${printRustVisibility(item.visibility)}type ${item.name}${generics} =`;
      const target = printRustType(item.target);
      if (renderedFits(`${prefix} ${target};`, 0)) {
        return `${prefix} ${target};`;
      }
      return `${prefix}\n${appendToLastLine(`${indentText(1)}${printRustTypeFitted(item.target, 1, indentText(1).length)}`, ";")}`;
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
      const fields = item.fields.map(printRustStructField).join("\n");
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

function printRustStructField(field: RustStructField): string {
  const prefix = `    ${printRustVisibility(field.visibility)}${field.name}:`;
  const flatType = printRustType(field.type);
  const flat = `${prefix} ${flatType},`;
  if (!flatType.includes("\n") && renderedFits(flat, 0)) {
    return flat;
  }
  const typeIndent = indentText(2);
  return [
    prefix,
    appendToLastLine(
      `${typeIndent}${printRustTypeFitted(field.type, 2, typeIndent.length)}`,
      ",",
    ),
  ].join("\n");
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
    case "slice": {
      return `[${printRustType(type.element)}]`;
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
          `${indent}${")".repeat(callChain.callables.length + 1)}${statement.tail === true ? "" : ";"}`,
        ].join("\n");
      }
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
        `${indent})${statement.tail === true ? "" : ";"}`,
      ].join("\n");
    }
    case "try-scope": {
      return printRustTryScope(statement, depth);
    }
  }
}

function printRustStatementAttributes(
  attrs: readonly string[] | undefined,
  depth: number,
): string {
  const indent = indentText(depth);
  return attrs?.map((attribute) => `${indent}${attribute}\n`).join("") ?? "";
}

function collectNestedCallExpressionChain(
  expression: Extract<RustExpr, { readonly kind: "call" | "associated-call" }>,
): {
  readonly callables: readonly string[];
  readonly arguments: readonly RustExpr[];
} | undefined {
  const callables: string[] = [];
  let current = expression;
  for (;;) {
    callables.push(current.kind === "call"
      ? current.path
      : `${printRustAssociatedOwner(current.owner)}::${current.method}`);
    if (current.args.length !== 1 ||
      (current.args[0]?.kind !== "call" && current.args[0]?.kind !== "associated-call")) {
      if (current.args.length === 1 && current.args[0]?.kind === "string-literal") {
        callables.push("String::from");
        return {
          callables,
          arguments: [{ kind: "str-literal", value: current.args[0].value }],
        };
      }
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
    const flowAssignment = `${indent}let ${statement.flowName}: ${flowType} =`;
    const inlineFlowMatchPrefix = `${flowAssignment} match ${statement.bodyName}`;
    const catchUsesBlock = statement.asynchronous;
    const matchWithBraceFits = renderedFits(`${inlineFlowMatchPrefix} {`, 0);
    const matchHeaderFits = renderedFits(inlineFlowMatchPrefix, 0);
    const matchDepth = matchHeaderFits ? depth : depth + 1;
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
  const header = (conditionEnding === "}" || conditionEnding.endsWith("})")) &&
      lastLine(conditionHeader).length + 2 <= rustFormatWidth
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

type RustExpressionGrammarPosition = "condition" | "expression" | "statement";

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
    case "owned-string-from-borrowed-str": {
      return `String::from(${printRustExpr(expression.expression)})`;
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
      return `${printOperand(expression.start, RustPrecedence.Or, false)}..${expression.inclusive === true ? "=" : ""}${printOperand(expression.end, RustPrecedence.Or, true)}`;
    }
    case "conditional": {
      return `if ${printRustExpr(expression.condition)} { ${printRustConditionalArmInline(expression.whenTrue)} } else { ${printRustConditionalArmInline(expression.whenFalse)} }`;
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
      return `${expression.path}${printRustCallTypeArguments(expression.typeArguments)}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "invoke": {
      return `${printOperand(expression.callee, RustPrecedence.Postfix, false)}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "associated-value": {
      const owner = expression.trait === undefined
        ? printRustAssociatedOwner(expression.owner)
        : `<${printRustType(expression.owner)} as ${printRustType(expression.trait)}>`;
      return `${owner}::${expression.name}`;
    }
    case "associated-call": {
      return `${printRustAssociatedCallOwner(expression)}::${expression.method}${printRustCallTypeArguments(expression.typeArguments)}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "method-call": {
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      return `${receiver}.${expression.method}${printRustCallTypeArguments(expression.typeArguments)}(${expression.args.map(printRustExpr).join(", ")})`;
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
      return `{ ${printRustBlockExpressionInlineContents(expression)} }`;
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

function rustExpressionContainsClosure(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "closure":
    case "closure-block":
      return true;
    case "unary":
      return rustExpressionContainsClosure(expression.operand);
    case "bottom":
      return rustExpressionContainsClosure(expression.expression);
    case "owned-string-from-borrowed-str":
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
    case "owned-string-from-borrowed-str":
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
    case "owned-string-from-borrowed-str":
      return printFittedCall("String::from", [expression.expression], depth, column);
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
      if (grammarPosition === "expression" && !flat.includes("\n") &&
        flat.length <= rustSingleLineConditionalWidth &&
        renderedFits(flat, column)) {
        return flat;
      }
      const condition = printRustExprFitted(
        expression.condition,
        depth,
        column + "if ".length,
      );
      const header = condition.includes("\n") && lastLine(condition).trim() !== "}"
        ? `if ${condition}\n${indentText(depth)}{`
        : `if ${condition} {`;
      return [
        header,
        ...printRustConditionalArmLines(expression.whenTrue, depth + 1),
        `${indentText(depth)}} else {`,
        ...printRustConditionalArmLines(expression.whenFalse, depth + 1),
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
        : expression.args.every(rustFormatArgumentIsAtomic) &&
            !flatFormatArguments.includes("\n") &&
            renderedFits(flatFormatArguments, argumentIndent.length)
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
      return [
        "{",
        ...printRustBlockExpressionLines(expression, depth + 1),
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
      const allPartsCanShareLine = expression.parts.every(rustFormatArgumentCanShareLine);
      if (expression.parts.length <= 4 &&
        (flat.length <= rustNestedCallWidth ||
          allPartsCanShareLine && flat.length < rustInlineFormatArgumentWidth * 2) &&
        !flat.includes("\n") &&
        renderedFits(flat, column)) {
        return flat;
      }
      const trailingPart = expression.parts[expression.parts.length - 1];
      const leadingParts = expression.parts.slice(0, -1).map(printRustExpr);
      if (trailingPart !== undefined &&
        (trailingPart.kind === "block" ||
          printRustExpr(trailingPart).length <= rustInlineFormatArgumentWidth) &&
        leadingParts.every((part) => !part.includes("\n"))) {
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
      const flatParts = expression.parts.map(printRustExpr).join(", ");
      const renderedParts = expression.parts.every(rustFormatArgumentIsAtomic) &&
          renderedFits(`${flatParts},`, argumentIndent.length)
        ? [`${argumentIndent}${flatParts},`]
        : expression.parts.map((part) => {
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
    case "associated-value": {
      if (expression.trait !== undefined) {
        return flat;
      }
      return appendToLastLine(
        printRustAssociatedOwnerFitted(
          expression.owner,
          depth,
          column + `::${expression.name}`.length,
        ),
        `::${expression.name}`,
      );
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
      const selectorCount = chain?.steps.filter((step) =>
        step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
      const columnRequiresVerticalLayout = chain !== undefined && selectorCount > 1 &&
        !renderedFits(flat, column);
      const verticalLayout = rustMethodChainPrefersVerticalLayout(expression) ||
        columnRequiresVerticalLayout;
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      if (!flat.includes("\n") && renderedFits(flat, column) && !verticalLayout &&
        !expression.args.some((argument) =>
          argument.kind === "tuple-literal" &&
          rustExpressionContainsTry(argument) &&
          column + flat.length > rustNestedCallWidth) &&
        !rustExpressionContainsExpandedStructLiteral(expression)) {
        return flat;
      }
      const hasClosure = expression.args.some((argument) =>
        argument.kind === "closure" || argument.kind === "closure-block");
      const attachedCallable = `${receiver}.${expression.method}`;
      const attachedArgumentsPreferExpansion = expression.args.some((argument) =>
        argument.kind === "binary" || argument.kind === "tuple-literal" ||
        rustExpressionContainsClosure(argument) ||
        rustExpressionContainsStatementBlock(argument));
      const firstStep = chain?.steps[0];
      const secondStep = chain?.steps[1];
      const firstMethodRequiresExpansion = chain === undefined
        ? false
        : rustMethodChainFirstMethodRequiresExpansion(chain, depth);
      const fieldLedCallPrefersSelectorBreak = firstStep?.kind === "field" &&
        secondStep?.kind === "method" &&
        selectorCount === 2 &&
        !firstMethodRequiresExpansion;
      const attachFirstMethodAfterField = chain !== undefined &&
        firstStep?.kind === "field" &&
        secondStep?.kind === "method" &&
        selectorCount === 2 &&
        firstMethodRequiresExpansion &&
        renderedFits(
          `${printRustExpr(chain.base)}.${firstStep.name}.${secondStep.name}(`,
          column,
        );
      if (chain !== undefined && selectorCount === 1 && !hasClosure &&
        !flat.includes("\n") && !renderedFits(flat, column)) {
        const brokenSelector = printFittedMethodChain(
          chain,
          depth,
          column,
          true,
          methodChainContinuationIndent,
        );
        if (remainingLines(brokenSelector).length === 1 &&
          renderedFits(brokenSelector, column)) {
          return brokenSelector;
        }
      }
      if (!hasClosure && !receiver.includes("\n") && expression.args.length > 0 &&
        renderedFits(`${attachedCallable}(`, column)) {
        const attached = printFittedCall(
          attachedCallable,
          expression.args,
          depth,
          column,
        );
        if (attached.includes("\n") &&
          !fieldLedCallPrefersSelectorBreak &&
          !attachFirstMethodAfterField &&
          (chain === undefined || attachedArgumentsPreferExpansion ||
            !rustMethodChainBreaksReceiverWhenExpanded(chain)) &&
          (!columnRequiresVerticalLayout || attachedArgumentsPreferExpansion) &&
          (!verticalLayout ||
          chain !== undefined && (!rustMethodChainContainsClosure(chain) ||
            expression.args.length === 1 && expression.args[0]?.kind === "tuple-literal"))) {
          return attached;
        }
      }
      const expandedClosureOpening = rustExpandedMethodClosureOpeningWidth(
        expression,
        depth,
        column,
      );
      if (hasClosure && (!verticalLayout ||
          (expandedClosureOpening !== undefined &&
            expandedClosureOpening <= rustMethodChainWidth)) &&
        rustMethodCallKeepsTrailingClosureAttached(expression, depth, column)) {
        return printFittedCall(`${receiver}.${expression.method}`, expression.args, depth, column);
      }
      if (chain !== undefined && hasClosure && !renderedFits(flat, column)) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          rustMethodChainBreaksReceiverForClosure(chain, flat, column),
          methodChainContinuationIndent,
        );
      }
      if (chain !== undefined && verticalLayout) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          firstStep?.kind === "field" && !attachFirstMethodAfterField ||
            rustMethodChainBreaksReceiverForClosure(chain, flat, column) ||
            column > indentText(depth + 1).length,
          methodChainContinuationIndent,
          attachFirstMethodAfterField,
        );
      }
      if (chain !== undefined && rustMethodChainBreaksReceiverWhenExpanded(chain) &&
        !renderedFits(flat, column) &&
        (selectorCount > 1 || !renderedFits(`${attachedCallable}(`, column))) {
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
      const bodyChain = rustMethodChain(expression.body);
      const bodySelectorCount = bodyChain?.steps.filter((step) =>
        step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
      const bodyHasLongMethodChain = bodyChain !== undefined &&
        bodySelectorCount >= 3 &&
        flat.length > rustNestedCallWidth;
      if (!flat.includes("\n") && renderedFits(flat, column) && !bodyHasLongMethodChain &&
        !rustMethodChainPrefersVerticalLayout(expression.body) &&
        !rustExpressionContainsStatementBlock(expression.body)) {
        return flat;
      }
      const params = printRustClosureParams(expression.params);
      const prefix = `${expression.move === true ? "move " : ""}|${params}|`;
      const indent = indentText(depth + 1);
      if (expression.body.kind === "block") {
        const bindings = expression.body.bindings.flatMap((binding) => {
          const prefix = `${indent}let ${binding.mutable === true ? "mut " : ""}${binding.name}${binding.type === undefined ? "" : `: ${printRustType(binding.type)}`} = `;
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
      const chain = rustMethodChain(expression);
      if (chain !== undefined && flat.length > rustMethodChainWidth) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          true,
          methodChainContinuationIndent,
        );
      }
      const rendered = printRustExprFitted(expression.expr, depth, column);
      const attached = appendToLastLine(rendered, ".await");
      return !rendered.includes("\n") && renderedFits(attached, column) &&
          flat.length <= rustMethodChainWidth
        ? attached
        : `${rendered}\n${indentText(depth + 1)}.await`;
    }
    case "try": {
      const chain = rustMethodChain(expression);
      if (chain !== undefined && expression.expr.kind === "method-call" &&
        expression.expr.args.length === 0 && rustMethodChainRequiresVerticalLayout(expression)) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          true,
          methodChainContinuationIndent,
        );
      }
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
      const rendered = printRustExprFitted(expression.expr, depth, column);
      const attempted = appendToLastLine(rendered, "?");
      return renderedFits(attempted, column)
        ? attempted
        : appendToLastLine(printRustExprFitted(expression.expr, depth, column + 1), "?");
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
      const referencedChain = rustMethodChain(expression.expr);
      const referencedSelectorCount = referencedChain?.steps.filter((step) =>
        step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
      if (!parenthesized && referencedSelectorCount <= 1 && !flat.includes("\n") &&
        renderedFits(flat, column)) {
        return flat;
      }
      const rendered = printRustExprFitted(
        expression.expr,
        depth,
        column + prefix.length + (parenthesized ? 1 : 0),
      );
      if (!parenthesized && rendered.includes("\n") &&
        expression.expr.kind === "try" && expression.expr.expr.kind === "method-call") {
        const chain = rustMethodChain(expression.expr.expr);
        if (chain !== undefined) {
          const expanded = appendToLastLine(
            printFittedMethodChain(
              chain,
              depth,
              column + prefix.length + 1,
              true,
              indentText(depth + 1),
            ),
            "?",
          );
          return `${prefix}${expanded}`;
        }
      }
      return `${prefix}${parenthesized ? `(${rendered})` : rendered}`;
    }
    case "index": {
      if (!flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const receiver = printRustExprFitted(expression.receiver, depth, column);
      const flatIndex = printRustExpr(expression.index);
      const continuation = indentText(depth + 1);
      if (!receiver.includes("\n") && !flatIndex.includes("\n") &&
        !renderedFits(`${receiver}[${flatIndex}]`, column) &&
        renderedFits(`[${flatIndex}]`, continuation.length)) {
        return `${receiver}\n${continuation}[${flatIndex}]`;
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
      if (operand.includes("\n") && expression.operand.kind === "try" &&
        expression.operand.expr.kind === "method-call") {
        const chain = rustMethodChain(expression.operand.expr);
        if (chain !== undefined) {
          return `${expression.operator}${appendToLastLine(
            printFittedMethodChain(
              chain,
              depth,
              column + 2,
              true,
              indentText(depth + 1),
            ),
            "?",
          )}`;
        }
      }
      return expressionPrecedence(expression.operand) < RustPrecedence.Unary
        ? `${expression.operator}(${operand})`
        : `${expression.operator}${operand}`;
    }
    case "binary": {
      if (!rustExpressionContainsStatementBlock(expression) &&
        !rustExpressionContainsExpandedStructLiteral(expression) &&
        !rustBinaryOperandPrefersExpandedCall(expression.left) &&
        !rustBinaryOperandPrefersExpandedCall(expression.right) &&
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
          !rustExpressionContainsStatementBlock(expression.left) &&
          (rustBinaryOperandPrefersExpandedCall(expression.left) ||
            !renderedFits(printRustExpr(expression.left), column))
        ? printFittedCall(
            expression.left.path,
            expression.left.args,
            depth,
            column,
            true,
          )
        : expression.left.kind === "associated-call" &&
            expression.left.args.length > 1 &&
            !rustExpressionContainsStatementBlock(expression.left) &&
            (rustBinaryOperandPrefersExpandedCall(expression.left) ||
              !renderedFits(printRustExpr(expression.left), column))
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
      let left = printFittedBinaryOperand(
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
      if ((left.includes("\n") || column + left.length >= rustFormatWidth - 1) &&
        expression.left.kind === "try" && expression.left.expr.kind === "method-call" &&
        !(expression.left.expr.args.length === 1 &&
          expression.left.expr.args[0]?.kind === "tuple-literal")) {
        const chain = rustMethodChain(expression.left.expr);
        if (chain !== undefined) {
          left = printFittedBinaryOperand(
            expression.left,
            appendToLastLine(printFittedMethodChain(
              chain,
              depth,
              column + 1,
              true,
              methodChainContinuationIndent ?? indentText(depth + 1),
            ), "?"),
            expression.operator,
            false,
          );
        }
      }
      const joined = appendToLastLine(
        left,
        ` ${expression.operator} ${printBinaryOperand(expression.right, expression.operator, true)}`,
      );
      if (left.includes("\n") && expressionIsStatementBlockOperand(expression.left)) {
        const renderedRight = printRustExprFitted(
          expression.right,
          depth,
          lastLineLength(left) + expression.operator.length + 2,
        );
        return appendToLastLine(left, ` ${expression.operator} ${renderedRight}`);
      }
      const multilineLeftChain = rustMethodChain(expression.left);
      const multilineLeftClosureStartsOnFirstLine = multilineLeftChain !== undefined &&
        rustMethodChainContainsClosure(multilineLeftChain) &&
        firstLine(left).trimEnd().endsWith("{");
      const multilineLeftRequiresOwnOperator = left.includes("\n") &&
        (expression.left.kind === "binary" || expression.left.kind === "index" ||
          multilineLeftChain !== undefined &&
            (multilineLeftChain.base.kind === "match" ||
              !multilineLeftClosureStartsOnFirstLine &&
                !firstLine(left).trimEnd().endsWith("(")));
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
      if (!flat.includes("\n") &&
        !rustExpressionContainsExpandedStructLiteral(expression) &&
        !(expression.kind === "tuple-literal" &&
          rustExpressionContainsTry(expression) &&
          column + flat.length > rustNestedCallWidth) &&
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
      const compactElements = expression.elements.map(printRustExpr).join(", ");
      const elements = expression.kind !== "tuple-literal" &&
          !rustExpressionContainsExpandedStructLiteral(expression) &&
          expression.elements.every(rustFormatArgumentIsAtomic) &&
          compactElements.length <= rustNestedCallWidth &&
          renderedFits(`${compactElements},`, elementIndent.length)
        ? [`${elementIndent}${compactElements},`]
        : expression.elements.map((element) => {
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

function printRustConditionalArmInline(expression: RustExpr): string {
  return expression.kind === "block"
    ? printRustBlockExpressionInlineContents(expression)
    : printRustExpr(expression);
}

function printRustBlockExpressionInlineContents(
  expression: Extract<RustExpr, { readonly kind: "block" }>,
): string {
  const bindings = expression.bindings.map((binding) => {
    const attributes = binding.attrs?.join(" ") ?? "";
    const declaration = `let ${binding.mutable === true ? "mut " : ""}${binding.name}${binding.type === undefined ? "" : `: ${printRustType(binding.type)}`} = ${printRustExpr(binding.value)};`;
    return attributes.length === 0 ? declaration : `${attributes} ${declaration}`;
  });
  return [
    ...(expression.innerAttrs ?? []),
    ...bindings,
    printRustExpr(expression.value),
  ].join(" ");
}

function printRustConditionalArmLines(
  expression: RustExpr,
  depth: number,
): readonly string[] {
  if (expression.kind === "block") {
    return printRustBlockExpressionLines(expression, depth);
  }
  const indent = indentText(depth);
  return [`${indent}${printRustExprFitted(
    expression,
    depth,
    indent.length,
    undefined,
    "statement",
  )}`];
}

function printRustBlockExpressionLines(
  expression: Extract<RustExpr, { readonly kind: "block" }>,
  depth: number,
): readonly string[] {
  const indent = indentText(depth);
  const bindings = expression.bindings.flatMap((binding) => {
    const prefix = `${indent}let ${binding.mutable === true ? "mut " : ""}${binding.name}${binding.type === undefined ? "" : `: ${printRustType(binding.type)}`} = `;
    return [
      ...(binding.attrs ?? []).map((attribute) => `${indent}${attribute}`),
      printRustLetInitializer(prefix, binding.value, depth),
    ];
  });
  const value = printRustExprFitted(
    expression.value,
    depth,
    indent.length,
    undefined,
    "statement",
  );
  return [
    ...(expression.innerAttrs ?? []).map((attribute) => `${indent}${attribute}`),
    ...bindings,
    `${indent}${value}`,
  ];
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
  const longTuple = type.kind === "tuple" && flat.length > rustMethodChainWidth;
  if (!longTuple && renderedFits(flat, column) && column + flat.length + 1 < rustFormatWidth) {
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
  if (!flat.includes("\n") && prefix.length + flat.length + 1 <= rustFormatWidth &&
    !rustExpressionContainsStatementBlock(initializer) &&
    !rustExpressionContainsExpandedStructLiteral(initializer) &&
    !rustMethodChainPrefersVerticalLayout(initializer) &&
    !(rustMethodChain(initializer) !== undefined &&
      prefix.length + flat.length + 1 >= rustFormatWidth)) {
    return `${prefix}${flat};`;
  }
  const fittedAtPrefix = printRustExprFitted(initializer, depth, prefix.length + 1);
  const trailingClosure = initializer.kind === "call" || initializer.kind === "invoke" ||
      initializer.kind === "associated-call" || initializer.kind === "method-call"
    ? initializer.args[initializer.args.length - 1]
    : undefined;
  if (trailingClosure?.kind === "closure" || trailingClosure?.kind === "closure-block") {
    const continuationIndent = indentText(depth + 1);
    const continuation = printRustExprFitted(
      initializer,
      depth + 1,
      continuationIndent.length,
    );
    if (continuation.includes("\n") &&
      prefix.length + firstLine(continuation).length + 1 > rustFormatWidth &&
      renderedFits(continuation, continuationIndent.length)) {
      return `${prefix.trimEnd()}\n${continuationIndent}${continuation};`;
    }
  }
  const directCallOpeningFits = (initializer.kind === "call" ||
      initializer.kind === "invoke" || initializer.kind === "associated-call") &&
    trailingClosure?.kind === "closure" &&
    fittedAtPrefix.includes("\n") &&
    !(initializer.kind === "associated-call" && flat.includes("\n") === false &&
      renderedFits(flat, indentText(depth + 1).length)) &&
    prefix.length + firstLine(fittedAtPrefix).length + 1 <= rustFormatWidth;
  if (directCallOpeningFits) {
    return appendToLastLine(`${prefix}${fittedAtPrefix}`, ";");
  }
  if (fittedAtPrefix.includes("\n")) {
    const continuationIndent = indentText(depth + 1);
    const continuation = printRustExprFitted(
      initializer,
      depth + 1,
      continuationIndent.length,
    );
    const collectionCallContinuation = printRustSingleCollectionCallContinuation(
      initializer,
      depth + 1,
      continuationIndent.length,
    );
    if (collectionCallContinuation !== undefined) {
      return `${prefix.trimEnd()}\n${continuationIndent}${collectionCallContinuation};`;
    }
    const compactContinuationWidth = continuationIndent.length + firstLine(continuation).length + 1;
    const longBindingPrefix = prefix.length > 40;
    const methodChain = rustMethodChain(initializer);
    const chainBaseAtPrefix = methodChain === undefined
      ? undefined
      : printRustExprFitted(methodChain.base, depth, prefix.length + 1);
    const chainBaseAtContinuation = methodChain === undefined
      ? undefined
      : printRustExprFitted(
          methodChain.base,
          depth + 1,
          continuationIndent.length,
        );
    const chainBaseIsInvocation = methodChain?.base.kind === "call" ||
      methodChain?.base.kind === "associated-call" || methodChain?.base.kind === "invoke";
    const initializerHasNestedCollectionInvocation =
      rustInvocationHasNestedExpandedCollection(initializer);
    const chainBaseHasNestedCollectionInvocation = methodChain !== undefined &&
      rustInvocationHasNestedExpandedCollection(methodChain.base);
    const compactContinuationLimit = methodChain === undefined
      ? rustFormatWidth
      : rustFormatWidth - 4;
    const bindingLineOwnsChainBase = chainBaseAtPrefix !== undefined &&
      (chainBaseAtPrefix.includes("\n")
        ? prefix.length + firstLine(chainBaseAtPrefix).length + 1 <= rustFormatWidth &&
          !(longBindingPrefix && chainBaseIsInvocation &&
            chainBaseHasNestedCollectionInvocation)
        : prefix.length + chainBaseAtPrefix.length + 1 <= rustFormatWidth);
    const continuationPacksMoreSource =
      !continuation.includes("\n") && compactContinuationWidth <= compactContinuationLimit ||
      longBindingPrefix &&
        (initializerHasNestedCollectionInvocation ||
          !bindingLineOwnsChainBase && chainBaseIsInvocation &&
          chainBaseHasNestedCollectionInvocation && chainBaseAtPrefix?.includes("\n") === true) ||
      longBindingPrefix && chainBaseAtPrefix?.includes("\n") === true &&
        chainBaseAtContinuation?.includes("\n") === false;
    if (continuationPacksMoreSource && renderedFits(continuation, continuationIndent.length)) {
      return appendToLastLine(
        `${prefix.trimEnd()}\n${continuationIndent}${continuation}`,
        ";",
      );
    }
    if (prefix.length + firstLine(fittedAtPrefix).length + 1 <= rustFormatWidth) {
      return appendToLastLine(`${prefix}${fittedAtPrefix}`, ";");
    }
    return appendToLastLine(
      `${prefix.trimEnd()}\n${continuationIndent}${continuation}`,
      ";",
    );
  }
  if (flat.includes("\n") && initializer.kind !== "match") {
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
  if (!flat.includes("\n") &&
    (!renderedFits(flat, prefix.length + 1) ||
      prefix.length + flat.length + 1 > rustFormatWidth ||
      rustMethodChain(initializer) !== undefined &&
        prefix.length + flat.length + 1 >= rustFormatWidth) &&
    renderedFits(flat, indentText(depth + 1).length + 1) &&
    initializer.kind !== "struct-literal" &&
    !rustMethodChainPrefersVerticalLayout(initializer)) {
    return `${prefix.trimEnd()}\n${indentText(depth + 1)}${flat};`;
  }
  return `${prefix}${printRustExprFitted(initializer, depth, prefix.length + 1)};`;
}

function printRustSingleCollectionCallContinuation(
  initializer: RustExpr,
  depth: number,
  column: number,
): string | undefined {
  const invocation = initializer.kind === "call"
    ? {
        callable: `${initializer.path}${printRustCallTypeArguments(initializer.typeArguments)}`,
        arguments: initializer.args,
      }
    : initializer.kind === "associated-call"
      ? {
          callable: `${printRustAssociatedOwner(initializer.owner)}::${initializer.method}${printRustCallTypeArguments(initializer.typeArguments)}`,
          arguments: initializer.args,
        }
      : undefined;
  const argument = invocation?.arguments.length === 1
    ? invocation.arguments[0]
    : undefined;
  if (invocation === undefined || argument === undefined ||
    (argument.kind !== "vec-literal" && argument.kind !== "slice-literal") ||
    argument.elements.length !== 1) {
    return undefined;
  }
  const flat = printRustExpr(initializer);
  const argumentFlat = printRustExpr(argument);
  const argumentIndent = indentText(depth + 1);
  if (flat.includes("\n") || argumentFlat.includes("\n") ||
    renderedFits(`${flat};`, column) ||
    !renderedFits(`${invocation.callable}(`, column) ||
    !renderedFits(`${argumentFlat},`, argumentIndent.length)) {
    return undefined;
  }
  return [
    `${invocation.callable}(`,
    `${argumentIndent}${argumentFlat},`,
    `${indentText(depth)})`,
  ].join("\n");
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

function printRustCallTypeArguments(typeArguments: readonly RustType[] | undefined): string {
  return typeArguments === undefined || typeArguments.length === 0
    ? ""
    : `::<${typeArguments.map(printRustType).join(", ")}>`;
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
    if (!rendered.includes("\n") && expressionIsRightHandBlock(operand)) {
      const separator = ` ${operator} `;
      const attachedRight = printFittedLogicalOperand(
        operand,
        operator,
        depth,
        column + rendered.length + separator.length,
        "expression",
      );
      if (column + rendered.length + separator.length + firstLine(attachedRight).length <=
        rustFormatWidth) {
        rendered = `${rendered}${separator}${attachedRight}`;
        continue;
      }
    }
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
    const flat = printRustExpr(expression);
    if (flat.length < rustInlineFormatArgumentWidth * 2 &&
      !flat.includes("\n") && renderedFits(`${flat},`, column) &&
      !rustExpressionContainsStatementBlock(expression) &&
      !rustExpressionContainsPreferredVerticalMethodChain(expression) &&
      !rustExpressionContainsExpandedStructLiteral(expression)) {
      return flat;
    }
    const argument = expression.args[0]!;
    const callable = expression.kind === "call"
      ? expression.path
      : `${printRustAssociatedCallOwner(expression)}::${expression.method}`;
    const prefix = `${callable}(`;
    const borrowedNested = printBorrowedNestedRustFormatArgument(
      callable,
      argument,
      depth,
      column,
    );
    if (borrowedNested !== undefined) {
      return borrowedNested;
    }
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
  }
  return printRustExprFitted(expression, depth, column);
}

function printBorrowedNestedRustFormatArgument(
  outerCallable: string,
  argument: RustExpr,
  depth: number,
  column: number,
): string | undefined {
  if (argument.kind !== "reference") {
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
    `${indentText(depth)}))`,
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
  const selectedColumn = column + (parenthesized ? 1 : 0);
  const rendered = printRustVerticalMethodChainSlot(
    operand,
    depth,
    selectedColumn,
  ) ?? printRustExprFitted(
      operand,
      depth,
      selectedColumn,
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
  | { readonly kind: "await" }
  | { readonly kind: "try" };

function rustMethodChain(expression: RustExpr): RustMethodChain | undefined {
  const steps: RustMethodChainStep[] = [];
  const base = collectRustMethodChain(expression, steps);
  return steps.some((step) => step.kind === "method") ? { base, steps } : undefined;
}

function rustMethodChainRequiresVerticalLayout(expression: RustExpr): boolean {
  const chain = rustMethodChain(expression);
  const expandedClosureOpening = rustExpandedMethodClosureOpeningWidth(expression);
  const renderedLength = printRustExpr(expression).length;
  return chain !== undefined &&
    (expandedClosureOpening === undefined || expandedClosureOpening > rustMethodChainWidth) &&
    (expression.kind === "try"
      ? renderedLength >= rustMethodChainWidth
      : renderedLength > rustMethodChainWidth) &&
    chain.steps.filter((step) =>
      step.kind === "method" || step.kind === "field" || step.kind === "await").length > 1;
}

function rustExpandedMethodClosureOpeningWidth(
  expression: RustExpr,
  depth = 0,
  column = 0,
): number | undefined {
  if (expression.kind !== "method-call") {
    return undefined;
  }
  const trailing = expression.args[expression.args.length - 1];
  if (trailing?.kind !== "closure" && trailing?.kind !== "closure-block") {
    return undefined;
  }
  const preceding = expression.args.slice(0, -1).map(printRustExpr);
  if (preceding.some((argument) => argument.includes("\n"))) {
    return 0;
  }
  const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
  const prefix = `${receiver}.${expression.method}(${preceding.length === 0 ? "" : `${preceding.join(", ")}, `}`;
  const renderedClosure = printRustExprFitted(trailing, depth, column + prefix.length);
  return renderedClosure.includes("\n")
    ? prefix.length + firstLine(renderedClosure).length + 1
    : undefined;
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
    const bodyChain = rustMethodChain(trailing.body);
    const complexBody = bodyChain !== undefined &&
      bodyChain.steps.filter((step) =>
        step.kind === "method" || step.kind === "field" || step.kind === "await").length >= 3;
    if (!complexBody && !flatClosure.includes("\n") && continuationWidth <= rustFormatWidth) {
      return false;
    }
  }
  const closureOpening = firstLine(renderedClosure);
  const openingWidth = prefix.length + closureOpening.length + 1;
  return column + openingWidth <= rustFormatWidth;
}

function rustMethodChainPrefersVerticalLayout(expression: RustExpr): boolean {
  const chain = rustMethodChain(expression);
  return rustMethodChainRequiresVerticalLayout(expression) ||
    chain !== undefined && printRustExpr(expression).length > rustNestedCallWidth &&
    chain.steps.some((step) => step.kind === "method" && step.args.some((argument) =>
      argument.kind !== "closure" && argument.kind !== "closure-block" && argument.kind !== "block" &&
      rustExpressionContainsClosure(argument)));
}

function rustBinaryOperandPrefersExpandedCall(expression: RustExpr): boolean {
  const call = expression.kind === "call" || expression.kind === "associated-call"
    ? expression
    : expression.kind === "try" &&
        (expression.expr.kind === "call" || expression.expr.kind === "associated-call")
      ? expression.expr
      : undefined;
  return call !== undefined && call.args.length > 1 &&
    (expression.kind === "try" || call.args.some((argument) => argument.kind === "try")) &&
    printRustExpr(expression).length > rustNestedCallWidth;
}

function rustMethodChainBreaksReceiverWhenExpanded(chain: RustMethodChain): boolean {
  const first = chain.steps[0];
  const firstSelectorWidth = first?.kind === "method" || first?.kind === "field"
    ? first.name.length + 1
    : first?.kind === "await" ? ".await".length
      : first?.kind === "try" ? 1 : 0;
  return chain.steps.filter((step) =>
    step.kind === "method" || step.kind === "field" || step.kind === "await").length > 1 ||
    printRustExpr(chain.base).length + firstSelectorWidth > rustInlineFieldReceiverWidth ||
    chain.steps.some((step, index) =>
      step.kind === "try" && chain.steps[index + 1]?.kind === "method");
}

function rustMethodChainFirstSegmentWidth(chain: RustMethodChain): number {
  let width = printRustExpr(chain.base).length;
  for (const step of chain.steps) {
    if (step.kind === "try") {
      width += 1;
      continue;
    }
    if (step.kind === "await") {
      width += ".await".length;
      continue;
    }
    if (step.kind === "field") {
      width += step.name.length + 1;
      continue;
    }
    return width + step.name.length + step.args.map(printRustExpr).join(", ").length + 3;
  }
  return width;
}

function rustMethodChainFirstMethodRequiresExpansion(
  chain: RustMethodChain,
  depth: number,
): boolean {
  const firstMethod = chain.steps.find((step) => step.kind === "method");
  if (firstMethod === undefined || firstMethod.kind !== "method") {
    return false;
  }
  const continuationIndent = indentText(depth + 1);
  return printFittedCall(
    `.${firstMethod.name}`,
    firstMethod.args,
    depth + 1,
    continuationIndent.length + 1,
  ).includes("\n");
}

function rustMethodChainContainsClosure(chain: RustMethodChain): boolean {
  return chain.steps.some((step) => step.kind === "method" && step.args.some((argument) =>
    argument.kind === "closure" || argument.kind === "closure-block"));
}

function rustMethodChainLastSelectorWidth(chain: RustMethodChain): number {
  let selector: Exclude<RustMethodChainStep, { readonly kind: "try" }> | undefined;
  for (let index = chain.steps.length - 1; index >= 0; index -= 1) {
    const step = chain.steps[index];
    if (step !== undefined && step.kind !== "try") {
      selector = step;
      break;
    }
  }
  if (selector === undefined) {
    return 0;
  }
  if (selector.kind === "field") {
    return selector.name.length + 1;
  }
  if (selector.kind === "await") {
    return ".await".length;
  }
  return selector.name.length + selector.args.map(printRustExpr).join(", ").length + 3;
}

function printRustMethodChain(chain: RustMethodChain): string {
  let rendered = printRustExpr(chain.base);
  for (const step of chain.steps) {
    if (step.kind === "try") {
      rendered += "?";
    } else if (step.kind === "await") {
      rendered += ".await";
    } else if (step.kind === "field") {
      rendered += `.${step.name}`;
    } else {
      rendered += `.${step.name}(${step.args.map(printRustExpr).join(", ")})`;
    }
  }
  return rendered;
}

function rustMethodChainBreaksReceiverForClosure(
  chain: RustMethodChain,
  flat: string,
  column: number,
): boolean {
  const selectorCount = chain.steps.filter((step) =>
    step.kind === "method" || step.kind === "field" || step.kind === "await").length;
  return selectorCount > 1 && rustMethodChainContainsClosure(chain) &&
    (!renderedFits(flat, column) ||
      flat.length > rustMethodChainWidth &&
        rustMethodChainLastSelectorWidth(chain) <= rustMethodChainWidth);
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
  if (expression.kind === "await") {
    const base = collectRustMethodChain(expression.expr, steps);
    steps.push({ kind: "await" });
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
  forceAttachFirstSelector = false,
): string {
  const flatBase = printRustExpr(chain.base);
  const flatChain = printRustMethodChain(chain);
  const selectedBreakBeforeFirstSelector = breakBeforeFirstSelector ||
    rustMethodChainBreaksReceiverForClosure(chain, flatChain, column);
  let rendered = !flatBase.includes("\n") && renderedFits(flatBase, column) &&
      !rustExpressionContainsExpandedStructLiteral(chain.base)
    ? flatBase
    : printRustExprFitted(chain.base, depth, column);
  const selectedContinuationIndent = rendered.includes("\n")
    ? indentText(depth)
    : continuationIndent;
  const breakBeforeFirstField = selectedBreakBeforeFirstSelector;
  let emittedCall = false;
  let emittedField = false;
  for (const step of chain.steps) {
    if (step.kind === "try") {
      rendered = appendToLastLine(rendered, "?");
      continue;
    }
    if (step.kind === "await") {
      rendered = emittedCall || rendered.includes("\n") ||
          column + lastLineLength(rendered) + ".await".length >= rustMethodChainWidth
        ? `${rendered}\n${selectedContinuationIndent}.await`
        : appendToLastLine(rendered, ".await");
      continue;
    }
    if (step.kind === "field") {
      const attachInitialField = !emittedCall && !emittedField &&
        !rendered.includes("\n") &&
        (forceAttachFirstSelector ||
          rustMethodChainContainsClosure(chain) &&
            lastLineLength(rendered) + step.name.length + 1 <=
              rustInlineClosureFieldReceiverWidth);
      rendered = !attachInitialField && (breakBeforeFirstField || emittedCall || rendered.includes("\n") ||
          lastLineLength(rendered) + step.name.length + 1 > rustInlineFieldReceiverWidth
        )
          ? `${rendered}\n${selectedContinuationIndent}.${step.name}`
          : appendToLastLine(rendered, `.${step.name}`);
      emittedField = true;
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
    const inlineFirstMethod = !selectedBreakBeforeFirstSelector && !emittedCall &&
      !rendered.includes("\n") &&
      (forceAttachFirstSelector ||
        lastLineLength(rendered) + firstLine(inlineMethod).length <= rustInlineFieldReceiverWidth);
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

function printRustVerticalMethodChainSlot(
  expression: RustExpr,
  depth: number,
  column: number,
  continuationIndent = indentText(depth + 1),
): string | undefined {
  const chain = rustMethodChain(expression);
  return chain !== undefined && rustMethodChainPrefersVerticalLayout(expression)
    ? printFittedMethodChain(chain, depth, column, true, continuationIndent)
    : undefined;
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
  const soleArgument = arguments_[0];
  const soleNestedClosureCall = soleArgument?.kind === "call" ||
      soleArgument?.kind === "associated-call"
    ? soleArgument.args.length === 1 &&
        (soleArgument.args[0]?.kind === "closure" ||
          soleArgument.args[0]?.kind === "closure-block")
      ? soleArgument
      : undefined
    : undefined;
  if (soleNestedClosureCall !== undefined) {
    const nestedCallable = soleNestedClosureCall.kind === "call"
      ? soleNestedClosureCall.path
      : `${printRustAssociatedOwner(soleNestedClosureCall.owner)}::${soleNestedClosureCall.method}`;
    if (column + callable.length + nestedCallable.length + 2 >
      rustNestedClosureOpeningWidth) {
      const argumentIndent = indentText(depth + 1);
      const rendered = printRustExprFitted(
        soleNestedClosureCall,
        depth + 1,
        argumentIndent.length,
      );
      return [
        `${callable}(`,
        appendToLastLine(`${argumentIndent}${rendered}`, ","),
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  const soleFallibleMethod = arguments_.length === 1 && soleArgument?.kind === "try" &&
      soleArgument.expr.kind === "method-call"
    ? soleArgument.expr
    : undefined;
  const soleFallibleChain = soleFallibleMethod === undefined
    ? undefined
    : rustMethodChain(soleFallibleMethod);
  const soleFallibleSelectorCount = soleFallibleChain?.steps.filter((step) =>
    step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
  if (!forceExpanded && soleArgument !== undefined && soleFallibleChain !== undefined &&
    soleFallibleSelectorCount > 1 && printRustExpr(soleArgument).length > rustNestedCallWidth) {
    const argumentIndent = indentText(depth + 1);
    const selectorIndent = indentText(depth + 2);
    const firstSegmentWidth = rustMethodChainFirstSegmentWidth(soleFallibleChain);
    const attachFirstSelector = firstSegmentWidth > rustMethodChainWidth &&
      firstSegmentWidth <= rustNestedMethodFirstSegmentWidth;
    const rendered = appendToLastLine(
      printFittedMethodChain(
        soleFallibleChain,
        depth + 1,
        argumentIndent.length,
        !attachFirstSelector,
        selectorIndent,
        attachFirstSelector,
      ),
      "?",
    );
    return [
      `${callable}(`,
      appendToLastLine(`${argumentIndent}${rendered}`, ","),
      `${indentText(depth)})`,
    ].join("\n");
  }
  if (!forceExpanded && soleArgument !== undefined && soleFallibleChain !== undefined &&
    soleFallibleSelectorCount === 1) {
    const prefix = `${callable}(`;
    const methodCallable = `${printOperand(
      soleFallibleMethod!.receiver,
      RustPrecedence.Postfix,
      false,
    )}.${soleFallibleMethod!.method}`;
    const rendered = appendToLastLine(printFittedCall(
      methodCallable,
      soleFallibleMethod!.args,
      depth,
      column + prefix.length,
    ), "?");
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    const multilineCallback = soleFallibleMethod!.args.some((argument) =>
      argument.kind === "closure" || argument.kind === "closure-block");
    if ((!rendered.includes("\n") || multilineCallback) &&
      firstLine(attached).length + column <= rustFormatWidth) {
      return attached;
    }
  }
  if (!forceExpanded && arguments_.length === 1 && soleArgument?.kind === "try" &&
    !renderedFits(flat, column)) {
    const prefix = `${callable}(`;
    const nested = printNestedCallArgument(
      soleArgument,
      depth,
      column + prefix.length,
      true,
    );
    const attached = appendToLastLine(`${prefix}${nested}`, ")");
    if (soleArgument.expr.kind !== "method-call" && nested.includes("\n") &&
      renderedFits(attached, column)) {
      return attached;
    }
    const argumentIndent = indentText(depth + 1);
    const rendered = printRustExprFitted(
      soleArgument,
      depth + 1,
      argumentIndent.length,
      indentText(depth + 2),
    );
    return [
      `${callable}(`,
      appendToLastLine(`${argumentIndent}${rendered}`, ","),
      `${indentText(depth)})`,
    ].join("\n");
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
      const expandedClosure = printRustExprFitted(
        trailingClosure,
        depth + 1,
        indentText(depth + 1).length + 1,
      );
      const expansionMakesClosureCompact = trailingClosure.kind === "closure" &&
        !expressionIsRightHandBlock(trailingClosure.body) &&
        renderedClosure.includes("\n") &&
        !expandedClosure.includes("\n");
      if (!expansionMakesClosureCompact &&
        firstLine(renderedClosure).length + column + prefix.length <= rustFormatWidth) {
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
    (arguments_[0]?.kind === "block" || arguments_[0]?.kind === "evaluate-then" ||
      arguments_[0]?.kind === "match" ||
      arguments_[0]?.kind === "conditional")) {
    const prefix = `${callable}(`;
    const renderedArgument = printRustExprFitted(
      arguments_[0],
      inlineArgumentDepth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${renderedArgument}`, ")");
    const nestedMatchScrutinee = arguments_[0].kind === "match" &&
      rustExpressionContainsStatementBlock(arguments_[0].expression);
    if (!nestedMatchScrutinee &&
      (((arguments_[0].kind === "block" || arguments_[0].kind === "evaluate-then") &&
        column + firstLine(attached).length <= rustFormatWidth) ||
      renderedFits(attached, column) &&
      !(arguments_[0].kind === "match" &&
        (firstLine(attached).length > rustNestedCallWidth ||
          !firstLine(renderedArgument).trimEnd().endsWith("{"))))) {
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
  if (arguments_.length === 1 && arguments_[0]?.kind === "unary" &&
    expressionIsRightHandBlock(arguments_[0].operand)) {
    const prefix = `${callable}(`;
    const renderedArgument = printRustExprFitted(
      arguments_[0],
      inlineArgumentDepth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${renderedArgument}`, ")");
    if (column + firstLine(attached).length <= rustFormatWidth) {
      return attached;
    }
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
    const attachedBinaryContinuation = /^[A-Za-z_][A-Za-z0-9_]*$/u.test(callable) &&
      callable.length <= rustInlineFieldReceiverWidth &&
      rendered.split("\n").length === 2;
    if ((!rendered.includes("\n") || attachedBinaryContinuation) &&
      renderedFits(attached, column)) {
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
  if (arguments_.length === 1 && arguments_[0]?.kind === "string-concat") {
    const prefix = `${callable}(`;
    const rendered = printRustExprFitted(
      arguments_[0],
      depth,
      column + prefix.length,
    );
    if (rendered.includes("\n")) {
      return appendToLastLine(`${prefix}${rendered}`, ")");
    }
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
    const rendered = printRustVerticalMethodChainSlot(
      argument,
      depth + 1,
      argumentIndent.length + 1,
      indentText(depth + 2),
    ) ?? printRustExprFitted(
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
  if (nested.args.length > 1) {
    const nestedCallable = nested.kind === "call"
      ? nested.path
      : `${printRustAssociatedOwner(nested.owner)}::${nested.method}`;
    const renderedNested = printFittedCall(
      nestedCallable,
      nested.args,
      depth,
      column + outerCallable.length + 1,
      true,
    );
    const attached = appendToLastLine(`${outerCallable}(${renderedNested}`, ")");
    if (renderedNested.includes("\n")) {
      return attached;
    }
  }
  const singleArgumentChain = collectNestedCallExpressionChain(nested);
  if (singleArgumentChain !== undefined && singleArgumentChain.arguments.length === 1 &&
    singleArgumentChain.callables.length > 1) {
    const opening = `${outerCallable}(${singleArgumentChain.callables.map((callable) =>
      `${callable}(`).join("")}`;
    const closing = ")".repeat(singleArgumentChain.callables.length + 1);
    const terminalArgument = singleArgumentChain.arguments[0]!;
    const terminalFlat = printRustExpr(terminalArgument);
    if (terminalArgument.kind === "block" || terminalArgument.kind === "evaluate-then") {
      const terminal = printRustExprFitted(
        terminalArgument,
        depth,
        column + opening.length,
      );
      const attached = appendToLastLine(`${opening}${terminal}`, closing);
      if (column + firstLine(attached).length <= rustFormatWidth) {
        return attached;
      }
    }
    if (opening.length + terminalFlat.length + closing.length > rustNestedCallWidth &&
      renderedFits(opening, column)) {
      const argumentIndent = indentText(depth + 1);
      const terminal = printRustExprFitted(
        terminalArgument,
        depth + 1,
        argumentIndent.length,
      );
      return [
        opening,
        appendToLastLine(`${argumentIndent}${terminal}`, ","),
        `${indentText(depth)}${closing}`,
      ].join("\n");
    }
  }
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
      const attachedArgument = printRustExprFitted(
        nested.args[0],
        depth,
        lastLineLength(opening),
      );
      const attached = appendToLastLine(`${opening}${attachedArgument}`, "))");
      if (renderedFits(attached, column)) {
        return attached;
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
  }
  const nestedCallable = nested.kind === "call"
    ? nested.path
    : `${printRustAssociatedOwner(nested.owner)}::${nested.method}`;
  const argumentIndent = indentText(depth + 1);
  const nestedClosureChain = collectNestedClosureCallChain(nested);
  if (nestedClosureChain !== undefined) {
    const opening = `${outerCallable}(${nestedClosureChain.callables.map((callable) => `${callable}(`).join("")}`;
    if (renderedFits(opening, column) &&
      opening.length + column <= rustNestedClosureOpeningWidth) {
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
    if (!renderedFits(opening, column) ||
      opening.length + column > rustNestedClosureOpeningWidth) {
      return undefined;
    }
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
  const flatNested = printRustExpr(nested);
  const nestedArgumentOwnsBreak = nested.args.some((argument) =>
    argument.kind === "call" || argument.kind === "associated-call" ||
    argument.kind === "method-call" || argument.kind === "try" ||
    argument.kind === "reference" &&
      (argument.expr.kind === "call" || argument.expr.kind === "associated-call" ||
        argument.expr.kind === "method-call" || argument.expr.kind === "try"));
  if (!nestedArgumentOwnsBreak && !flatNested.includes("\n") &&
    renderedFits(`${flatNested},`, argumentIndent.length)) {
    const expanded = [
      `${outerCallable}(`,
      `${argumentIndent}${flatNested},`,
      `${indentText(depth)})`,
    ].join("\n");
    if (renderedFits(expanded, column)) {
      return expanded;
    }
  }
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
    if (argument.kind === "associated-call") {
      return printRustExprFitted(argument, depth, column);
    }
    if (argument.kind === "call") {
      return printFittedCall(
        argument.path,
        argument.args,
        depth,
        column,
        true,
      );
    }
    const receiver = printOperand(argument.receiver, RustPrecedence.Postfix, false);
    return printFittedCall(`${receiver}.${argument.method}`, argument.args, depth, column, true);
  }
  if (argument.kind === "associated-call") {
    return printRustExprFitted(argument, depth, column);
  }
  if (argument.kind === "call") {
    return printFittedCall(
      argument.path,
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
    case "owned-string-from-borrowed-str":
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

function rustExpressionContainsExpandedCollectionLiteral(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "vec-literal":
    case "slice-literal":
      return expression.elements.length > 1 ||
        expression.elements.some(rustExpressionContainsExpandedCollectionLiteral);
    case "tuple-literal":
      return expression.elements.some(rustExpressionContainsExpandedCollectionLiteral);
    case "bottom":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expression);
    case "owned-string-from-borrowed-str":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expression);
    case "unary":
      return rustExpressionContainsExpandedCollectionLiteral(expression.operand);
    case "dereference":
      return rustExpressionContainsExpandedCollectionLiteral(expression.pointer);
    case "unsafe":
    case "numeric-cast":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expression);
    case "binary":
      return rustExpressionContainsExpandedCollectionLiteral(expression.left) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.right);
    case "range":
      return rustExpressionContainsExpandedCollectionLiteral(expression.start) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.end);
    case "conditional":
      return rustExpressionContainsExpandedCollectionLiteral(expression.condition) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.whenTrue) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.whenFalse);
    case "match":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expression) ||
        expression.arms.some((arm) =>
          rustExpressionContainsExpandedCollectionLiteral(arm.expression));
    case "matches":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expression);
    case "assignment":
      return rustExpressionContainsExpandedCollectionLiteral(expression.target) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.value);
    case "call":
    case "associated-call":
      return expression.args.some(rustExpressionContainsExpandedCollectionLiteral);
    case "invoke":
      return rustExpressionContainsExpandedCollectionLiteral(expression.callee) ||
        expression.args.some(rustExpressionContainsExpandedCollectionLiteral);
    case "method-call":
      return rustExpressionContainsExpandedCollectionLiteral(expression.receiver) ||
        expression.args.some(rustExpressionContainsExpandedCollectionLiteral);
    case "field":
      return rustExpressionContainsExpandedCollectionLiteral(expression.receiver);
    case "index":
      return rustExpressionContainsExpandedCollectionLiteral(expression.receiver) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.index);
    case "block":
      return expression.bindings.some((binding) =>
        rustExpressionContainsExpandedCollectionLiteral(binding.value)) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.value);
    case "evaluate-then":
      return rustExpressionContainsExpandedCollectionLiteral(expression.effect) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.value);
    case "string-concat":
      return expression.parts.some(rustExpressionContainsExpandedCollectionLiteral);
    case "format-write":
      return rustExpressionContainsExpandedCollectionLiteral(expression.writer) ||
        expression.args.some(rustExpressionContainsExpandedCollectionLiteral);
    case "reference":
    case "await":
    case "try":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expr);
    case "return-expression":
      return expression.expr !== undefined &&
        rustExpressionContainsExpandedCollectionLiteral(expression.expr);
    case "closure":
      return rustExpressionContainsExpandedCollectionLiteral(expression.body);
    case "struct-literal":
      return expression.fields.some((field) =>
        rustExpressionContainsExpandedCollectionLiteral(field.value));
    default:
      return false;
  }
}

function rustInvocationHasNestedExpandedCollection(expression: RustExpr): boolean {
  const invocation = rustTransparentInvocationOperand(expression);
  const arguments_ = invocation.kind === "call" || invocation.kind === "associated-call" ||
      invocation.kind === "method-call"
    ? invocation.args
    : invocation.kind === "invoke"
      ? invocation.args
      : undefined;
  return arguments_?.some((argument) => {
    const nested = rustTransparentInvocationOperand(argument);
    return (nested.kind === "call" || nested.kind === "associated-call" ||
      nested.kind === "method-call" || nested.kind === "invoke") &&
      rustExpressionContainsExpandedCollectionLiteral(nested);
  }) === true;
}

function rustTransparentInvocationOperand(expression: RustExpr): RustExpr {
  if (expression.kind === "bottom") {
    return rustTransparentInvocationOperand(expression.expression);
  }
  if (expression.kind === "reference" || expression.kind === "await" || expression.kind === "try") {
    return rustTransparentInvocationOperand(expression.expr);
  }
  return expression;
}

function rustFormatArgumentIsAtomic(expression: RustExpr): boolean {
  return expression.kind === "int-literal" || expression.kind === "float-literal" ||
    expression.kind === "bool-literal" || expression.kind === "none" ||
    expression.kind === "string-literal" || expression.kind === "str-literal" ||
    expression.kind === "path" || expression.kind === "associated-value";
}

function rustFormatArgumentCanShareLine(expression: RustExpr): boolean {
  if (rustFormatArgumentIsAtomic(expression)) {
    return true;
  }
  switch (expression.kind) {
    case "call":
    case "associated-call":
      return expression.args.every(rustFormatArgumentCanShareLine);
    case "field":
      return rustFormatArgumentCanShareLine(expression.receiver);
    case "index":
      return rustFormatArgumentCanShareLine(expression.receiver) &&
        rustFormatArgumentCanShareLine(expression.index);
    case "reference":
      return rustFormatArgumentCanShareLine(expression.expr);
    case "slice-literal":
    case "vec-literal":
    case "tuple-literal":
      return expression.elements.every(rustFormatArgumentCanShareLine);
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
    if (arm.expression.kind === "return-expression") {
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
    if (arm.expression.kind !== "try" && rustExpressionContainsTry(arm.expression)) {
      const valueIndent = indentText(depth + 2);
      const value = printRustExprFitted(arm.expression, depth + 2, valueIndent.length);
      return [
        `${armIndent}${pattern} => {`,
        `${valueIndent}${value}`,
        `${armIndent}}`,
      ];
    }
    const prefix = `${armIndent}${pattern} => `;
    const flatValue = printRustExpr(arm.expression);
    if (flatValue.includes("\n") || !renderedFits(`${prefix}${flatValue},`, 0)) {
      if (arm.expression.kind === "call" || arm.expression.kind === "associated-call" ||
        arm.expression.kind === "invoke" ||
        arm.expression.kind === "match" ||
        arm.expression.kind === "method-call" &&
          rustExpressionContainsStatementBlock(arm.expression)) {
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

function rustExpressionContainsTry(expression: RustExpr): boolean {
  return expression.kind === "try" ||
    rustExpressionChildren(expression).some(rustExpressionContainsTry);
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
