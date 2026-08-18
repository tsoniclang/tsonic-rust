import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustBackend } from "../../../dist/backend/rust-backend.js";
import { composeRustProviderSemantics } from "../../../dist/providers/packages/semantics.js";
import {
  fakeBackendContext,
  fakeCompileInput,
  fakeSourceFile,
  fakeStatement,
} from "../../helpers/fake-compile-input.mjs";

const backendContext = fakeBackendContext();
const providerSemantics = composeRustProviderSemantics(backendContext);

test("any source statement fails closed with a deterministic diagnostic and no artifacts", () => {
  const backend = createRustBackend(backendContext, providerSemantics, false);
  const result = backend.compile(fakeCompileInput({
    sourceFiles: [fakeSourceFile({
      fileName: "src/app.ts",
      text: "const x = 1;\n",
      statements: [fakeStatement({ pos: 0, end: 12, kindName: "VariableStatement" })],
    })],
  }));

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "RUST_UNSUPPORTED_AST");
  assert.equal(diagnostic.category, "error");
  assert.equal(diagnostic.source, "tsonic-rust");
  assert.match(diagnostic.message, /VariableStatement/);
  assert.deepEqual(diagnostic.sourceSpan, {
    fileName: "src/app.ts",
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 13,
  });
  assert.ok(diagnostic.evidence.includes("target.capability=rust.backend.statement"));
  assert.ok(diagnostic.evidence.includes("source.byteSpan=0-12"));
});

test("every statement in every source file produces its own diagnostic", () => {
  const backend = createRustBackend(backendContext, providerSemantics, false);
  const result = backend.compile(fakeCompileInput({
    sourceFiles: [
      fakeSourceFile({
        fileName: "src/a.ts",
        text: "let a;\nlet b;\n",
        statements: [
          fakeStatement({ pos: 0, end: 6, kindName: "VariableStatement" }),
          fakeStatement({ pos: 7, end: 13, kindName: "VariableStatement" }),
        ],
      }),
      fakeSourceFile({
        fileName: "src/b.ts",
        text: "export {};\n",
        statements: [fakeStatement({ pos: 0, end: 10, kindName: "ExportDeclaration" })],
      }),
    ],
  }));

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.length, 3);
  const secondSpan = result.diagnostics[1].sourceSpan;
  assert.equal(secondSpan.line, 2);
  assert.equal(secondSpan.column, 1);
});

test("diagnostic spans track multi-byte source text by utf-8 byte offsets", () => {
  const backend = createRustBackend(backendContext, providerSemantics, false);
  const text = 'const s = "héllo";\n';
  const result = backend.compile(fakeCompileInput({
    sourceFiles: [fakeSourceFile({
      fileName: "src/unicode.ts",
      text,
      // 'é' is two utf-8 bytes; the statement spans the full first line.
      statements: [fakeStatement({ pos: 0, end: 19, kindName: "VariableStatement" })],
    })],
  }));

  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.sourceSpan.endLine, 1);
  assert.equal(diagnostic.sourceSpan.endColumn, 19);
});
