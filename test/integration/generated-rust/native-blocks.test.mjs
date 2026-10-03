import assert from "node:assert/strict";
import test from "node:test";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { applyFallibleShape } from "../../../dist/backend/planner/types/fallible-shape.js";
import { printRustSourceFile } from "../../helpers/printed-rust-source.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

const path = name => ({ kind: "path", path: name });
const integer = value => ({ kind: "int-literal", text: String(value) });
const block = (...statements) => ({ kind: "block", body: { statements } });
const intType = { kind: "primitive", name: "i32" };
const optionType = { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: intType }] };
const pattern = { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "present" }] };

test("canonical native blocks retain early result returns and direct branch loop exits", { timeout: 300_000 }, () => {
  const branch = { kind: "if-let", pattern, expression: path("input"),
    whenTrue: block({ kind: "return", expr: path("present") }) };
  const body = applyFallibleShape({ statements: [{ kind: "tail", expr: { kind: "call", path: "identity", args: [
    block({ kind: "expr", expr: branch }, { kind: "tail", expr: integer(99) }),
  ] } }] }, { fallible: true, hasReturnValue: true, inferErrorTypeFromReturnType: true, errorType: intType });
  const source = printRustSourceFile({ items: [
    { kind: "function", name: "choose", visibility: "public", generics: emptyRustGenerics,
      params: [{ name: "input", type: optionType }], returnType: { kind: "named", path: "Result",
        genericArguments: [{ kind: "type", type: intType }, { kind: "type", type: intType }] }, body },
    { kind: "function", name: "sum", visibility: "public", generics: emptyRustGenerics, params: [], returnType: intType,
      body: { statements: [
        { kind: "let", name: "result", mutable: true, init: integer(0) },
        { kind: "for", binding: "input", iterable: { kind: "slice-literal", elements: [
          { kind: "call", path: "Some", args: [integer(3)] }, { kind: "none" },
        ] }, body: { statements: [{ kind: "expr", expr: { ...branch, whenTrue: block(
          { kind: "assign", target: path("result"), operator: "+=", value: path("present") },
          { kind: "continue" },
        ), whenFalse: block({ kind: "break" }) } }] } },
        { kind: "tail", expr: path("result") },
      ] } },
  ] });
  assert.match(source, /return Ok\(present\);/u);
  assert.doesNotMatch(source, /\|\||if-let-some|allow\(/u);
  const project = writeGeneratedProject("canonical-native-blocks", [
    { path: "Cargo.toml", text: '[package]\nname = "canonical_native_blocks"\nversion = "0.0.0"\nedition = "2024"\n[workspace]\n' },
    { path: "src/lib.rs", text: `${source}\nfn identity(value: i32) -> i32 { value }\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn direct_flow() {\n        assert_eq!(super::choose(Some(7)), Ok(7));\n        assert_eq!(super::choose(None), Ok(99));\n        assert_eq!(super::sum(), 3);\n    }\n}\n` },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt", "--all"]);
  runCargo(project, ["fmt", "--all", "--check"]);
  runCargo(project, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["test", "--release", "--locked", "--offline"]);
});
