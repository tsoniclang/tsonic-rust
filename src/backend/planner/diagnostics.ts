import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api";

export interface RustDiagnosticInput {
  readonly ast: AstReader;
  readonly sourceFile: SourceFile;
  readonly node: Node;
}

export function unsupportedStatementDiagnostic(input: RustDiagnosticInput, capabilityId: string): TargetDiagnostic {
  const { ast, sourceFile, node } = input;
  const fileName = ast.getFileName(sourceFile);
  const text = ast.getSourceText(sourceFile);
  const pos = ast.pos(node);
  const end = ast.end(node);
  const sourceSpan = structuredSourceSpan(fileName, text, pos, end);
  const evidence = [
    `target.capability=${capabilityId}`,
    ...(fileName.length === 0 ? [] : [`source.module=${fileName}`, `source.file=${fileName}`]),
    ...sourceSpanEvidence(text, pos, end),
  ];
  return {
    code: "RUST_UNSUPPORTED_AST",
    category: "error",
    source: "tsonic-rust",
    message: `The Rust target does not support this construct. Node kind: ${ast.kindName(node)}.`,
    ...(sourceSpan === undefined ? {} : { sourceSpan }),
    evidence,
  };
}

export function missingFactDiagnostic(input: RustDiagnosticInput, capabilityId: string, message: string): TargetDiagnostic {
  const base = unsupportedStatementDiagnostic(input, capabilityId);
  return {
    ...base,
    code: "RUST_MISSING_TARGET_FACT",
    message: `${message} Node kind: ${input.ast.kindName(input.node)}.`,
  };
}

export function unsupportedConstructDiagnostic(input: RustDiagnosticInput, capabilityId: string, message: string): TargetDiagnostic {
  const base = unsupportedStatementDiagnostic(input, capabilityId);
  return {
    ...base,
    message: `${message} Node kind: ${input.ast.kindName(input.node)}.`,
  };
}

export function missingRuntimeReferenceDiagnostic(kind: string, include: string): TargetDiagnostic {
  return {
    code: "RUST_UNSUPPORTED_RUNTIME_REFERENCE",
    category: "error",
    source: "tsonic-rust",
    message: `The Rust target cannot map runtime reference kind '${kind}' to a Cargo dependency.`,
    evidence: [
      "target.capability=rust.toolchain.runtime-reference",
      `runtime.reference.kind=${kind}`,
      `runtime.reference.include=${include}`,
    ],
  };
}

function sourceSpanEvidence(text: string, pos: number, end: number): readonly string[] {
  if (!isValidByteSpan(pos, end)) {
    return [];
  }
  const start = sourceLocationFromByteOffset(text, pos);
  const stop = sourceLocationFromByteOffset(text, end);
  return start === undefined || stop === undefined
    ? [`source.byteSpan=${pos}-${end}`]
    : [
        `source.span=${start.line}:${start.column}-${stop.line}:${stop.column}`,
        `source.byteSpan=${pos}-${end}`,
      ];
}

function structuredSourceSpan(
  fileName: string,
  text: string,
  pos: number,
  end: number,
): TargetDiagnostic["sourceSpan"] | undefined {
  if (fileName.length === 0 || !isValidByteSpan(pos, end)) {
    return undefined;
  }
  const start = sourceLocationFromByteOffset(text, pos);
  const stop = sourceLocationFromByteOffset(text, end);
  return start === undefined || stop === undefined
    ? undefined
    : {
        fileName,
        line: start.line,
        column: start.column,
        endLine: stop.line,
        endColumn: stop.column,
      };
}

function isValidByteSpan(pos: number, end: number): boolean {
  return Number.isSafeInteger(pos) && Number.isSafeInteger(end) && pos >= 0 && end >= pos;
}

function sourceLocationFromByteOffset(
  text: string,
  targetOffset: number,
): { readonly line: number; readonly column: number } | undefined {
  if (!Number.isSafeInteger(targetOffset) || targetOffset < 0) {
    return undefined;
  }
  let byteOffset = 0;
  let line = 1;
  let column = 1;
  for (let index = 0; index < text.length;) {
    if (byteOffset === targetOffset) {
      return { line, column };
    }
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const width = codePoint > 0xffff ? 2 : 1;
    if (codePoint === 0x0d && text.codePointAt(index + width) === 0x0a) {
      const nextByteOffset = byteOffset + utf8ByteLength(codePoint) + utf8ByteLength(0x0a);
      if (targetOffset < nextByteOffset) {
        return { line, column };
      }
      byteOffset = nextByteOffset;
      index += width + 1;
      line += 1;
      column = 1;
      continue;
    }
    const nextByteOffset = byteOffset + utf8ByteLength(codePoint);
    if (targetOffset < nextByteOffset) {
      return { line, column };
    }
    byteOffset = nextByteOffset;
    index += width;
    if (codePoint === 0x0a || codePoint === 0x0d || codePoint === 0x2028 || codePoint === 0x2029) {
      line += 1;
      column = 1;
    } else {
      column += width;
    }
  }
  return byteOffset === targetOffset ? { line, column } : undefined;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  return codePoint <= 0xffff ? 3 : 4;
}
