import type {
  RustMacroInput,
  RustTokenDelimiter,
  RustTokenFragment,
  RustTokenTree,
} from "../../backend/target-ast/macro-input.js";
import { printRustExpr } from "./expressions/core.js";
import { printRustItem } from "./items.js";
import { printRustPattern } from "./patterns.js";
import { printRustConstArgument, printRustLifetime, printRustType } from "./types.js";

export function printRustMacroInvocation(path: string, input: RustMacroInput): string {
  return `${path}!${printRustTokenGroup(input.delimiter, input.tokens)}`;
}

export function printRustTokenStream(tokens: readonly RustTokenTree[]): string {
  let result = "";
  let precedingJoint = true;
  for (const token of tokens) {
    if (!precedingJoint) result += " ";
    result += printRustToken(token);
    precedingJoint = token.kind === "punctuation" && token.joint;
  }
  return result;
}

function printRustTokenGroup(delimiter: RustTokenDelimiter, tokens: readonly RustTokenTree[]): string {
  const content = printRustTokenStream(tokens);
  switch (delimiter) {
    case "parentheses": return `(${content})`;
    case "brackets": return `[${content}]`;
    case "braces": return `{${content}}`;
  }
}

function printRustToken(token: RustTokenTree): string {
  switch (token.kind) {
    case "identifier": return `${token.raw ? "r#" : ""}${token.text}`;
    case "literal":
    case "punctuation": return token.text;
    case "group": return printRustTokenGroup(token.delimiter, token.tokens);
    case "fragment": return printRustFragment(token.fragment);
  }
}

function printRustFragment(fragment: RustTokenFragment): string {
  switch (fragment.kind) {
    case "expression": return printRustExpr(fragment.expression);
    case "type": return printRustType(fragment.type);
    case "pattern": return printRustPattern(fragment.pattern);
    case "items": return fragment.items.map(printRustItem).join("\n");
    case "lifetime": return printRustLifetime(fragment.lifetime);
    case "const": return printRustConstArgument(fragment.value);
  }
}
