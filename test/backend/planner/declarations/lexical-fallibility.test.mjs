import assert from "node:assert/strict";
import test from "node:test";
import { lexicalFallibilitySource } from "../../../../../tsonic/test/fixtures/lexical-fallibility.mjs";
import { artifactText, analyzeRust, compileRust } from "../../../helpers/rust-session.mjs";
import { rustFallibleFactKey } from "../../../../dist/analysis/facts/keys.js";

for (const surfaces of [[], ["js"]]) {
  test(`fallibility inventory retains deferred lexical effects without applying them to the owner in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": lexicalFallibilitySource } });
    const declarations = new Map();
    const visit = node => {
      if (program.source.ast.is.IsFunctionDeclaration(node)) declarations.set(program.source.ast.text(program.source.ast.name(node)), node);
      program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    for (const name of ["dormant", "forward", "fail", "through"]) {
      assert.equal(declarations.has(name), true, name);
      assert.equal(program.facts.getFact(declarations.get(name), rustFallibleFactKey) !== undefined, true, name);
    }
    for (const name of ["unused", "caught", "run"]) {
      assert.equal(declarations.has(name), true, name);
      assert.equal(program.facts.getFact(declarations.get(name), rustFallibleFactKey) === undefined, true, name);
    }
  });
  test(`lexical invocation effects do not execute deferred declarations in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": lexicalFallibilitySource } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    const text = artifactText(result, "src/index.rs");
    assert.match(text, /pub fn unused\(\) -> i32/u);
    assert.equal(/fn dormant\(/u.test(text), false);
    assert.equal(/pub fn forward\([^)]*\) -> Result<\(\), rt::TsonicError>/u.test(text), true);
    assert.equal(/fn fail\([^)]*\) -> Result<\(\), rt::TsonicError>/u.test(text), true);
    assert.equal(/fn through\([^)]*\) -> Result<\(\), rt::TsonicError>/u.test(text), true);
    assert.match(text, /pub fn caught\([^)]*\) -> bool/u);
  });
}
