import type { RustSourceFileModel } from "../backend/rust-ast/file.js";

export function printRustSourceFile(model: RustSourceFileModel): string {
  const lines = [`// ${model.headerComment}`];
  if (model.hasMainFunction) {
    lines.push("", "fn main() {}");
  }
  return `${lines.join("\n")}\n`;
}
