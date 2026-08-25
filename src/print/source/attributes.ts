import type {
  RustAttribute,
  RustCfgPredicate,
  RustRepresentation,
  RustScopedAttribute,
} from "../../backend/target-ast/attributes.js";
import { rustAttributeFunctionWidth, rustFormatWidth } from "./formatting.js";
import { indentText } from "./types.js";

export function printRustAttribute(
  attribute: RustAttribute,
  style: "outer" | "inner" = "outer",
  depth = 0,
): string {
  const prefix = `#${style === "inner" ? "!" : ""}[`;
  const body = printRustAttributeBody(attribute);
  const flat = `${prefix}${body}]`;
  const values = [
    ...(attribute.kind !== "lint" ? [] : [attribute.lint]),
    ...(attribute.kind !== "lint" || attribute.reason === undefined
      ? []
      : [`reason = ${JSON.stringify(attribute.reason)}`]),
  ];
  if (attribute.kind !== "lint" ||
    (values.join(", ").length <= rustAttributeFunctionWidth &&
      indentText(depth).length + flat.length < rustFormatWidth)) {
    return flat;
  }
  return [
    `${prefix}${attribute.level}(`,
    ...values.map((value, index) =>
      `${indentText(depth + 1)}${value}${index + 1 === values.length ? "" : ","}`),
    `${indentText(depth)})]`,
  ].join("\n");
}

export function printRustScopedAttribute(attribute: RustScopedAttribute): string {
  return printRustAttribute(attribute.attribute, attribute.style);
}

function printRustAttributeBody(attribute: RustAttribute): string {
  switch (attribute.kind) {
    case "lint":
      return `${attribute.level}(${attribute.lint}${attribute.reason === undefined
        ? ""
        : `, reason = ${JSON.stringify(attribute.reason)}`})`;
    case "doc-hidden": return "doc(hidden)";
    case "derive": return `derive(${attribute.traits.join(", ")})`;
    case "cfg": return `cfg(${printRustCfgPredicate(attribute.predicate)})`;
    case "repr": return `repr(${attribute.representations.map(printRustRepresentation).join(", ")})`;
    case "inline": return attribute.mode === "hint" ? "inline" : `inline(${attribute.mode})`;
    case "cold": return "cold";
    case "must-use": return attribute.message === undefined ? "must_use" : `must_use = ${JSON.stringify(attribute.message)}`;
    case "non-exhaustive": return "non_exhaustive";
    case "no-mangle": return "unsafe(no_mangle)";
    case "export-name": return `unsafe(export_name = ${JSON.stringify(attribute.name)})`;
    case "link-name": return `link_name = ${JSON.stringify(attribute.name)}`;
    case "target-feature": return `target_feature(enable = ${JSON.stringify(attribute.feature)})`;
  }
}

function printRustCfgPredicate(predicate: RustCfgPredicate): string {
  switch (predicate.kind) {
    case "flag": return predicate.name;
    case "key-value": return `${predicate.name} = ${JSON.stringify(predicate.value)}`;
    case "all":
    case "any": return `${predicate.kind}(${predicate.predicates.map(printRustCfgPredicate).join(", ")})`;
    case "not": return `not(${printRustCfgPredicate(predicate.predicate)})`;
  }
}

function printRustRepresentation(representation: RustRepresentation): string {
  switch (representation.kind) {
    case "c": return "C";
    case "transparent": return "transparent";
    case "simd": return "simd";
    case "integer": return representation.type;
    case "packed": return representation.alignment === undefined
      ? "packed"
      : `packed(${representation.alignment})`;
    case "align": return `align(${representation.alignment})`;
  }
}
