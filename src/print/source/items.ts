import { printRustBlockStatements } from "./blocks.js";
import { printRustExpr } from "./expressions/core.js";
import { printRustExprFitted } from "./expressions/fitted.js";
import { printRustTypeFitted } from "./expressions/blocks.js";
import { printRustAttribute, printRustScopedAttribute } from "./attributes.js";
import { appendToLastLine, firstLine, lastLineLength, renderedFits } from "./patterns.js";
import {
  indentText,
  printRustConstExpression,
  printRustGenerics,
  printRustLifetime,
  printRustType,
  printRustTypeBound,
  printRustWhereClause,
} from "./types.js";
import type {
  RustAssociatedConstItem,
  RustAssociatedTypeItem,
  RustBlock,
  RustFunctionParam,
  RustGenerics,
  RustImplFunction,
  RustItem,
  RustReceiver,
  RustSourceFileModel,
  RustStructField,
  RustStructFields,
  RustTraitFunction,
  RustType,
  RustVisibility,
} from "../../backend/target-ast/nodes.js";
import type { RustAttribute } from "../../backend/target-ast/attributes.js";
import { validateRustSourceFileModel } from "../../backend/target-ast/validation.js";
import { rustFormatWidth } from "./formatting.js";
import type { RustFunctionParameterPrint } from "./formatting.js";

export function printRustSourceFile(model: RustSourceFileModel): string {
  validateRustSourceFileModel(model);
  const parts: string[] = [`// ${model.headerComment}`];
  if (model.attrs !== undefined) parts.push(...model.attrs.map(printRustScopedAttribute));
  for (const item of model.items) parts.push("", printRustItem(item));
  return `${parts.join("\n")}\n`;
}

export function printRustItem(item: RustItem): string {
  const attrs = printOuterAttributes(item.kind === "use" ? undefined : item.attrs);
  switch (item.kind) {
    case "mod-decl":
      return `${attrs}${printRustVisibility(item.visibility)}mod ${item.name};`;
    case "use":
      return `${printRustVisibility(item.visibility ?? "private")}use ${item.path}${item.alias === undefined ? "" : ` as ${item.alias}`};`;
    case "type-alias": {
      const declaration = `${printRustVisibility(item.visibility)}type ${item.name}${printRustGenerics(item.generics)}`;
      const whereClause = printRustWhereClause(item.generics);
      const prefix = `${declaration}${whereClause} =`;
      const target = printRustType(item.target);
      if (renderedFits(`${prefix} ${target};`, 0)) return `${attrs}${prefix} ${target};`;
      const targetIndent = indentText(1);
      if (!target.includes("\n") && renderedFits(`${target};`, targetIndent.length)) {
        return `${attrs}${prefix}\n${targetIndent}${target};`;
      }
      const fitted = printRustTypeFitted(item.target, 0, lastLineLength(prefix) + 1);
      if (lastLineLength(prefix) + 1 + firstLine(fitted).length <= rustFormatWidth) {
        return `${attrs}${appendToLastLine(`${prefix} ${fitted}`, ";")}`;
      }
      return `${attrs}${prefix}\n${appendToLastLine(
        `${targetIndent}${printRustTypeFitted(item.target, 1, targetIndent.length)}`,
        ";",
      )}`;
    }
    case "const":
      return `${attrs}${printRustVisibility(item.visibility)}const ${item.name}: ${printRustType(item.type)} = ${printRustExpr(item.value)};`;
    case "static":
      return `${attrs}${printRustVisibility(item.visibility)}static ${item.mutable ? "mut " : ""}${item.name}: ${printRustType(item.type)} = ${printRustExpr(item.value)};`;
    case "thread-local": {
      const declarationAttrs = printOuterAttributes(item.attrs, 1);
      const value = printRustExpr(item.value);
      const initializer = item.constInitializer ? `const { ${value} }` : value;
      return `std::thread_local! {\n${declarationAttrs}    ${printRustVisibility(item.visibility)}static ${item.name}: ${printRustType(item.type)} = ${initializer};\n}`;
    }
    case "struct": {
      const header = `${attrs}${printRustVisibility(item.visibility)}struct ${item.name}${printRustGenerics(item.generics)}`;
      if (item.fields.kind === "tuple") {
        return `${header}${printRustStructFields(item.fields, 0, false)}${printRustWhereClause(item.generics, 0, false)};`;
      }
      return `${header}${printRustWhereClause(item.generics)}${printRustStructFields(item.fields, 0, true)}`;
    }
    case "union": {
      const fields = item.fields.map((field) => printRustStructField(field, 1)).join("\n");
      return `${attrs}${printRustVisibility(item.visibility)}union ${item.name}${printRustGenerics(item.generics)}${printRustWhereClause(item.generics)} {\n${fields}\n}`;
    }
    case "enum": {
      const variants = item.variants.map((variant) => {
        const fields = printRustStructFields(variant.fields, 1, false);
        const discriminant = variant.discriminant === undefined
          ? ""
          : ` = ${printRustConstExpression(variant.discriminant)}`;
        return `${indentText(1)}${variant.name}${fields}${discriminant},`;
      }).join("\n");
      return `${attrs}${printRustVisibility(item.visibility)}enum ${item.name}${printRustGenerics(item.generics)}${printRustWhereClause(item.generics)} {\n${variants}\n}`;
    }
    case "trait": {
      const safety = item.safety === "unsafe" ? "unsafe " : "";
      const auto = item.auto ? "auto " : "";
      const renderedSuperTraits = item.superTraits.map(printRustTypeBound);
      const superTraits = renderedSuperTraits.length === 0
        ? ""
        : `: ${renderedSuperTraits.join(" + ")}`;
      const members = [
        ...item.associatedTypes.map((associated) => printAssociatedType(associated, 1, false)),
        ...item.associatedConstants.map((constant) => printAssociatedConstant(constant, 1, false)),
        ...item.functions.map((fn) => printRustTraitFunction(fn, 1)),
      ].join("\n");
      const declaration = `${printRustVisibility(item.visibility)}${safety}${auto}trait ${item.name}${printRustGenerics(item.generics)}`;
      const flatHeader = `${declaration}${superTraits}`;
      const whereClause = printRustWhereClause(item.generics, 1);
      const expandedHeader = renderedSuperTraits.length > 0 && whereClause.length === 0 &&
          (`${flatHeader} {`.length >= rustFormatWidth ||
            (renderedSuperTraits.length > 1 && flatHeader.length > 80) ||
            (members.length > 0 && `${flatHeader} {`.length >= 86))
        ? `${declaration}:\n    ${renderedSuperTraits.join(" + ")}\n{`
        : `${flatHeader}${whereClause} {`;
      if (members.length === 0) {
        return expandedHeader.includes("\n")
          ? `${attrs}${expandedHeader}\n}`
          : `${attrs}${flatHeader} {}`;
      }
      return `${attrs}${expandedHeader}\n${members}\n}`;
    }
    case "impl": {
      const safety = item.safety === "unsafe" ? "unsafe " : "";
      const polarity = item.polarity === "negative" ? "!" : "";
      const target = printRustType(item.target);
      const relation = item.trait === undefined
        ? target
        : `${polarity}${printRustType(item.trait)} for ${target}`;
      const members = [
        ...item.associatedTypes.map((associated) => printAssociatedType(associated, 1, true)),
        ...item.associatedConstants.map((constant) => printAssociatedConstant(constant, 1, true)),
        ...item.functions.map((fn) => printRustImplFunction(fn, 1, item.trait !== undefined)),
      ].join("\n\n");
      const header = `${attrs}${safety}impl${printRustGenerics(item.generics)} ${relation}${printRustWhereClause(item.generics, 1)}`;
      return members.length === 0 ? `${header} {}` : `${header} {\n${members}\n}`;
    }
    case "extern-block": {
      const safety = item.safety === "unsafe" ? "unsafe " : "";
      const functions = item.functions.map((fn) => {
        const prefix = `${printRustVisibility(fn.visibility)}${printRustExternSafety(fn.safety)}`;
        return `${printOuterAttributes(fn.attrs, 1)}${indentText(1)}${prefix}${printRustFunctionSignature({ ...fn, abi: item.abi }, false, false, false, 1, prefix.length)};`;
      }).join("\n");
      const statics = item.statics.map((entry) =>
        `${indentText(1)}${printRustVisibility(entry.visibility)}${printRustExternSafety(entry.safety)}static ${entry.mutable ? "mut " : ""}${entry.name}: ${printRustType(entry.type)};`).join("\n");
      return `${attrs}${safety}extern ${JSON.stringify(item.abi)} {\n${[functions, statics].filter(Boolean).join("\n")}\n}`;
    }
    case "function": {
      const visibility = printRustVisibility(item.visibility);
      const signature = printRustFunctionSignature(
        item,
        item.isAsync === true,
        true,
        true,
        0,
        visibility.length,
      );
      return `${attrs}${visibility}${signature}${printRustFunctionBody(item.body, 0)}`;
    }
  }
}

function printRustExternSafety(safety: "inherited" | "safe" | "unsafe"): string {
  return safety === "inherited" ? "" : `${safety} `;
}

function printRustImplFunction(fn: RustImplFunction, depth: number, traitImplementation: boolean): string {
  const attrs = printOuterAttributes(fn.attrs, depth);
  const visibility = traitImplementation ? "" : printRustVisibility(fn.visibility);
  const signature = printRustFunctionSignature(
    fn,
    fn.isAsync === true,
    true,
    true,
    depth,
    visibility.length,
  );
  return `${attrs}${indentText(depth)}${visibility}${signature}${printRustFunctionBody(fn.body, depth)}`;
}

function printRustTraitFunction(fn: RustTraitFunction, depth: number): string {
  const attrs = printOuterAttributes(fn.attrs, depth);
  const signature = printRustFunctionSignature(
    fn,
    fn.isAsync === true,
    fn.body !== undefined,
    true,
    depth,
  );
  return fn.body === undefined
    ? `${attrs}${indentText(depth)}${signature};`
    : `${attrs}${indentText(depth)}${signature}${printRustFunctionBody(fn.body, depth)}`;
}

function printRustFunctionSignature(
  fn: {
    readonly name: string;
    readonly isUnsafe?: boolean;
    readonly abi?: import("../../target-model/semantics/index.js").RustAbi;
    readonly variadic?: boolean;
    readonly generics: RustGenerics;
    readonly receiver?: RustReceiver;
    readonly params: readonly RustFunctionParam[];
    readonly returnType?: RustType;
    readonly errorType?: RustType;
  },
  asynchronous: boolean,
  includeBodySpacing: boolean,
  includeAbi: boolean,
  depth: number,
  leadingWidth = 0,
): string {
  const parameters: RustFunctionParameterPrint[] = [
    ...(fn.receiver === undefined ? [] : [rustReceiverParameter(fn.receiver)]),
    ...fn.params.map(rustFunctionParameter),
  ];
  const returnType = rustFunctionReturnType(fn.returnType, fn.errorType);
  const whereClause = printRustWhereClause(fn.generics, depth + 1);
  if (fn.variadic === true && (fn.abi === undefined || fn.abi === "Rust" || asynchronous)) {
    throw new Error("A Rust variadic function requires a non-Rust ABI and cannot be async.");
  }
  if (fn.variadic === true) parameters.push({ prefix: "..." });
  const abi = includeAbi && fn.abi !== undefined
    ? `extern ${JSON.stringify(fn.abi)} `
    : "";
  const opening = `${asynchronous ? "async " : ""}${fn.isUnsafe === true ? "unsafe " : ""}${abi}fn ${fn.name}${printRustGenerics(fn.generics)}(`;
  const flatParameters = parameters.map(printRustFunctionParameterFlat);
  const returnSuffix = printRustReturnSuffix(returnType);
  const trailing = `${returnSuffix}${whereClause}${includeBodySpacing ? " " : ""}`;
  const flat = `${opening}${flatParameters.join(", ")})${trailing}`;
  const terminalWidth = 1;
  const flatLineWidth = indentText(depth).length + leadingWidth +
    flat.split("\n", 1)[0]!.length + terminalWidth;
  if (includeBodySpacing
    ? flatLineWidth <= rustFormatWidth
    : flatLineWidth < rustFormatWidth) {
    return flat;
  }
  const flatInvocation = `${opening}${flatParameters.join(", ")})`;
  if (!includeBodySpacing && returnType !== undefined && whereClause.length === 0 &&
    flatLineWidth === rustFormatWidth &&
    indentText(depth).length + leadingWidth + flatInvocation.length <= rustFormatWidth) {
    return `${flatInvocation}\n${indentText(depth + 1)}${printRustReturnSuffix(returnType).trimStart()}`;
  }
  const closingIndent = indentText(depth);
  const closingPrefix = parameters.length === 0
    ? `${opening})`
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
          opening,
          ...parameters.map((parameter) => printRustFunctionParameterFitted(parameter, depth + 1)),
        ]),
    `${closingPrefix}${fittedReturnSuffix}${whereClause}${includeBodySpacing ? " " : ""}`,
  ].join("\n");
}

function printRustFunctionBody(body: RustBlock, depth: number): string {
  const statements = printRustBlockStatements(body, depth + 1);
  return statements.length === 0
    ? "{}"
    : `{\n${statements}\n${indentText(depth)}}`;
}

function rustReceiverParameter(receiver: RustReceiver): RustFunctionParameterPrint {
  switch (receiver.kind) {
    case "value": return { prefix: `${receiver.mutable === true ? "mut " : ""}self` };
    case "reference": {
      const lifetime = receiver.lifetime === undefined ? "" : `${printRustLifetime(receiver.lifetime)} `;
      return { prefix: `&${lifetime}${receiver.mutable ? "mut " : ""}self` };
    }
    case "typed":
      return {
        prefix: `${receiver.mutable === true ? "mut " : ""}self: `,
        type: receiver.type,
      };
  }
}

function rustFunctionParameter(parameter: RustFunctionParam): RustFunctionParameterPrint {
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
  if (parameter.type === undefined) return `${indent}${parameter.prefix},`;
  return appendToLastLine(
    `${indent}${parameter.prefix}${printRustTypeFitted(
      parameter.type,
      depth,
      indent.length + parameter.prefix.length,
    )}`,
    ",",
  );
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

function printAssociatedType(item: RustAssociatedTypeItem, depth: number, implementation: boolean): string {
  const bounds = item.bounds.length === 0 ? "" : `: ${item.bounds.map(printRustTypeBound).join(" + ")}`;
  const value = item.value === undefined ? "" : ` = ${printRustType(item.value)}`;
  if (implementation && item.value === undefined) {
    throw new Error(`Rust associated type implementation '${item.name}' has no value.`);
  }
  return `${indentText(depth)}type ${item.name}${printRustGenerics(item.generics)}${bounds}${printRustWhereClause(item.generics, depth + 1)}${value};`;
}

function printAssociatedConstant(item: RustAssociatedConstItem, depth: number, implementation: boolean): string {
  if (implementation && item.value === undefined) {
    throw new Error(`Rust associated constant implementation '${item.name}' has no value.`);
  }
  return `${indentText(depth)}const ${item.name}: ${printRustType(item.type)}${item.value === undefined ? "" : ` = ${printRustExprFitted(item.value, depth, 0)}`};`;
}

function printRustStructFields(fields: RustStructFields, depth: number, declaration: boolean): string {
  switch (fields.kind) {
    case "unit": return declaration ? ";" : "";
    case "tuple": {
      const values = fields.fields.map((field) =>
        `${printRustVisibility(field.visibility)}${printRustType(field.type)}`).join(", ");
      return `(${values})${declaration ? ";" : ""}`;
    }
    case "named": {
      if (fields.fields.length === 0) return " {}";
      const values = fields.fields.map((field) => printRustStructField(field, depth + 1)).join("\n");
      return ` {\n${values}\n${indentText(depth)}}`;
    }
  }
}

function printRustStructField(field: RustStructField, depth: number): string {
  const attrs = printOuterAttributes(field.attrs, depth);
  const prefix = `${indentText(depth)}${printRustVisibility(field.visibility)}${field.name}:`;
  const flatType = printRustType(field.type);
  if (!flatType.includes("\n") && renderedFits(`${prefix} ${flatType},`, 0)) {
    return `${attrs}${prefix} ${flatType},`;
  }
  const typeIndent = indentText(depth + 1);
  return `${attrs}${prefix}\n${appendToLastLine(
    `${typeIndent}${printRustTypeFitted(field.type, depth + 1, typeIndent.length)}`,
    ",",
  )}`;
}

function printOuterAttributes(attrs: readonly RustAttribute[] | undefined, depth = 0): string {
  return attrs === undefined || attrs.length === 0
    ? ""
    : `${attrs.map((attribute) => `${indentText(depth)}${printRustAttribute(attribute, "outer", depth)}`).join("\n")}\n`;
}

function printRustVisibility(visibility: RustVisibility): string {
  return visibility === "public" ? "pub " : visibility === "crate" ? "pub(crate) " : "";
}

function rustFunctionReturnType(returnType: RustType | undefined, errorType: RustType | undefined): RustType | undefined {
  return errorType === undefined
    ? returnType
    : {
        kind: "named",
        path: "Result",
        genericArguments: [
          { kind: "type", type: returnType ?? { kind: "unit" } },
          { kind: "type", type: errorType },
        ],
      };
}
