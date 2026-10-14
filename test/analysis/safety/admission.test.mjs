import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";

const lang = `import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";
`;
const selected = "export function selected(value: int32): int32 { return value; }\n";
const conflict = "RUST_SAFETY_CONTRACT_CONFLICT";
const unresolved = "RUST_SAFETY_APPLICATION_TARGET_NOT_RESOLVED";
const safe = "RUST_SAFE_DECLARATION_TARGET_UNSUPPORTED";
const boundary = "RUST_SAFETY_APPLICATION_TARGET_UNSUPPORTED";
const messages = new Map([
  [conflict, "One exact Rust declaration received conflicting finalized safe and requires-unsafe contracts."],
  [unresolved, "The finalized safety application has no exact emitted Rust declaration target."],
  [safe, "Rust 'safe' is not an explicit modifier on ordinary function declarations; the selected source declaration has no Rust boundary where this contract can be emitted."],
  [boundary, "The selected source declaration has no emitted Rust function boundary that can carry an explicit unsafe contract."],
]);

function compile(files) {
  const texts = new Map(Object.entries(files).map(([path, text]) => [path, `${lang}${text}\n`]));
  return { texts, ...compileRust({ files: Object.fromEntries(texts) }) };
}

function label(ast, texts, diagnostic) {
  const node = diagnostic.sourceNode;
  const file = node === undefined ? undefined : ast.getFileName(ast.getSourceFile(node)).split("/").pop();
  const where = node === undefined ? "none"
    : `${ast.kindName(node)}@${file}:${texts.get(file)?.slice(ast.pos(node), ast.end(node)).trim()}`;
  return `${diagnostic.code}|${diagnostic.category}|${diagnostic.source}|${where}|${diagnostic.message}`;
}

function rejectedBeforePublication(files, expected) {
  const { result, source, texts } = compile(files);
  assert.equal(result.program === undefined, true, "safety admission rejects before the program is published");
  assert.equal(result.artifacts.length, 0, "no Rust is emitted");
  assert.deepEqual(result.diagnostics.map(diagnostic => label(source.ast, texts, diagnostic)),
    expected.map(([code, file, subject]) => `${code}|error|tsonic-rust|KindCallExpression@${file}:${subject}|${messages.get(code)}`));
}

test("contract conflicts are reported once, at the first application", () => {
  rejectedBeforePublication({ "index.ts": `${selected}safety(selected).safe();\nsafety(selected).requiresunsafe();` },
    [[conflict, "index.ts", "safety(selected).safe()"]]);
  rejectedBeforePublication({ "index.ts": `${selected}safety(selected).requiresunsafe();\nsafety(selected).safe();\nsafety(selected).requiresunsafe();` },
    [[conflict, "index.ts", "safety(selected).requiresunsafe()"]]);
  rejectedBeforePublication({ "index.ts": `${selected}safety(selected).safe();`,
    "apply.ts": `import { selected } from "./index.js";\nsafety(selected).requiresunsafe();` },
  [[conflict, "apply.ts", "safety(selected).requiresunsafe()"]]);
});

test("unresolved targets, safe contracts and missing unsafe boundaries keep their Rust diagnostics", () => {
  const snapshot = "export class Snapshot { get only(): int32 { return 1; } }\n";
  rejectedBeforePublication({ "index.ts": `${snapshot}safety<Snapshot>().property(s => s.only).setter().requiresunsafe();` },
    [[unresolved, "index.ts", "safety<Snapshot>().property(s => s.only).setter().requiresunsafe()"]]);
  rejectedBeforePublication({ "index.ts": `${snapshot}${selected}safety<Snapshot>().property(s => s.only).setter().requiresunsafe();\nsafety(selected).safe();\nsafety(selected).requiresunsafe();` },
    [[conflict, "index.ts", "safety(selected).safe()"], [unresolved, "index.ts", "safety<Snapshot>().property(s => s.only).setter().requiresunsafe()"]]);
  rejectedBeforePublication({ "index.ts": `${selected}safety(selected).safe();` }, [[safe, "index.ts", "safety(selected).safe()"]]);
  rejectedBeforePublication({ "index.ts": "export interface Shape { p: int32 }\nsafety<Shape>().property(s => s.p).requiresunsafe();" },
    [[boundary, "index.ts", "safety<Shape>().property(s => s.p).requiresunsafe()"]]);
  rejectedBeforePublication({ "index.ts": "export interface Shape { [key: string]: int32 }\nsafety<Shape>().indexer(s => s[\"\"]).getter().requiresunsafe();" },
    [[boundary, "index.ts", "safety<Shape>().indexer(s => s[\"\"]).getter().requiresunsafe()"]]);
});

test("every application in every source file is admitted, including erased statements the planner never plans", () => {
  for (const body of [
    "export function apply(): void { safety(selected).safe(); }",
    "export function apply(): void { return; safety(selected).safe(); }",
    "export function apply(): void { function inner(): void { safety(selected).safe(); } }",
    "export const apply = (): void => { safety(selected).safe(); };",
    "(safety(selected).safe());",
  ]) {
    rejectedBeforePublication({ "index.ts": `${selected}${body}` }, [[safe, "index.ts", "safety(selected).safe()"]]);
  }
  rejectedBeforePublication({ "index.ts": selected, "apply.ts": `import { selected } from "./index.js";\nsafety(selected).safe();` },
    [[safe, "apply.ts", "safety(selected).safe()"]]);
});

test("diagnostics follow source-file identity order across files", () => {
  const files = (name) => ({
    "index.ts": `import { other } from "./${name}.js";\n${selected}safety(selected).safe();\nexport function use(): int32 { return other(1); }`,
    [`${name}.ts`]: "export function other(value: int32): int32 { return value; }\nsafety(other).safe();",
  });
  rejectedBeforePublication(files("zeta"), [[safe, "index.ts", "safety(selected).safe()"], [safe, "zeta.ts", "safety(other).safe()"]]);
  rejectedBeforePublication(files("alpha"), [[safe, "alpha.ts", "safety(other).safe()"], [safe, "index.ts", "safety(selected).safe()"]]);
});

test("admitted unsafe contracts stay accepted", () => {
  for (const files of [
    { "index.ts": `${selected}safety(selected).requiresunsafe();` },
    { "index.ts": "export interface Shape { m(v: int32): int32 }\nsafety<Shape>().method(s => s.m).requiresunsafe();" },
    { "index.ts": selected, "apply.ts": `import { selected } from "./index.js";\nsafety(selected).requiresunsafe();` },
  ]) {
    const { result } = compile(files);
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), []);
    assert.equal(result.program !== undefined, true, "the program is published");
  }
});
