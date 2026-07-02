import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput, TargetDiagnostic } from "@tsonic/target-api";

export interface RustPlanContext {
  readonly input: TargetCompileInput;
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly moduleNameByFileName: ReadonlyMap<string, string>;
  readonly diagnostics: TargetDiagnostic[];
  // Identifier names with a proven write (assignment or increment) in the
  // enclosing function body. `let mut` is emitted only for proven writes.
  readonly mutatedNames?: ReadonlySet<string>;
}

export const rustReservedIdentifiers: ReadonlySet<string> = new Set([
  "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else",
  "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop",
  "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self",
  "static", "struct", "super", "trait", "true", "type", "unsafe", "use",
  "where", "while", "abstract", "become", "box", "do", "final", "macro",
  "override", "priv", "try", "typeof", "unsized", "virtual", "yield", "gen",
]);

const rustIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function isValidRustIdentifier(name: string): boolean {
  return rustIdentifierPattern.test(name) && !rustReservedIdentifiers.has(name);
}

export function diagnosticInput(context: RustPlanContext, node: Node) {
  return { ast: context.input.ast, sourceFile: context.sourceFile, node };
}
