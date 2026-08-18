import { appendToLastLine, lastLineLength, renderedFits } from "./patterns.js";
import { finalizeRustSourceStyle } from "../../backend/rust-ast/source-style.js";
import { indentText, printRustType } from "./types.js";
import { printRustBlockStatements } from "./blocks.js";
import { printRustExpr } from "./expressions/core.js";
import { printRustExprFitted } from "./expressions/fitted.js";
import { printRustTypeFitted } from "./expressions/blocks.js";
import { rustFormatWidth } from "./formatting.js";
import type {
  RustItem,
  RustSourceFileModel,
  RustStructField,
  RustType,
  RustVisibility,
} from "../../backend/rust-ast/nodes.js";
import type { RustFunctionParameterPrint } from "./formatting.js";

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
  selfParam: import("../../backend/rust-ast/nodes.js").RustSelfParam | undefined,
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

function printRustTypeParameters(parameters: readonly import("../../backend/rust-ast/nodes.js").RustTypeParameter[] | undefined): string {
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

function printRustTypeParameter(parameter: import("../../backend/rust-ast/nodes.js").RustTypeParameter): string {
  if (parameter.bounds.length === 0) {
    return parameter.name;
  }
  const bounds = parameter.bounds.map((bound) =>
    bound.kind === "trait" ? bound.path : `'${bound.name}`);
  return `${parameter.name}: ${bounds.join(" + ")}`;
}
