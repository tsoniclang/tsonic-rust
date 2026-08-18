import type { RustType } from "../../backend/rust-ast/nodes.js";

export const rustFormatWidth = 100;
export const rustSingleLineConditionalWidth = 50;
export const rustStructLiteralWidth = 18;
export const rustNestedCallWidth = 60;
export const rustCompactTrailingClosureWidth = rustNestedCallWidth + " || {".length;
export const rustNestedClosureOpeningWidth = 80;
export const rustMatchArmWidth = 80;
export const rustInlineFormatArgumentWidth = 40;
export const rustMethodChainWidth = 60;
export const rustNestedMethodFirstSegmentWidth = 64;
export const rustInlineFieldReceiverWidth = 28;
export const rustInlineClosureFieldReceiverWidth = 10;

export interface RustFunctionParameterPrint {
  readonly prefix: string;
  readonly type?: RustType;
}
