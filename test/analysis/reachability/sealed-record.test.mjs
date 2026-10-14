import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { createRustPlanningContext } from "../../../dist/backend/planner/context.js";
import * as directives from "../../../dist/backend/planner/program/reachability-directives.js";

function fixture(outputType = "bin") {
  const { program } = analyzeRust({ surfaces: [], target: { id: "rust", options: { outputType } }, files: {
    "index.ts": `import type { int32 } from "@tsonic/core/types.js";
      class Box {
        value: int32; unread: int32;
        constructor(value: int32) { this.value = value; this.unread = 0; }
        read(): int32 { return this.value; }
      }
      function deadLeaf(): int32 { return 0; }
      function deadRoot(): int32 { return deadLeaf(); }
      function active(): int32;
      function active(): int32 { return 7; }
      function unused(): int32;
      function unused(): int32 { return 0; }
      ${outputType === "lib" ? "export" : ""} function main(): void { const box = new Box(active()); box.unread = 2; if (box.read() !== 7) throw new Error("value"); }
      ${outputType === "bin" ? "main();" : ""}`,
  } });
  const declarations = new Map();
  const pending = [...program.sourceFiles];
  while (pending.length > 0) {
    const node = pending.pop();
    const name = program.source.ast.name(node);
    if (name !== undefined && ["KindClassDeclaration", "KindFunctionDeclaration", "KindMethodDeclaration", "KindPropertyDeclaration"]
      .includes(program.source.ast.kindName(node))) {
      const key = program.source.ast.text(name);
      const group = declarations.get(key) ?? [];
      group.push(node);
      declarations.set(key, group);
    }
    program.source.ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  return { program, declarations };
}

test("analysis publishes complete reachability data before creating the planner", () => {
  const { program, declarations } = fixture();
  const record = program.reachability;
  assert.equal(Object.isFrozen(program), true);
  assert.equal(Object.isFrozen(record), true);
  for (const [name, value] of Object.entries(record)) {
    assert.equal(value instanceof Map || value instanceof Set, true, name);
    assert.equal(typeof value === "function", false, name);
  }
  const unused = declarations.get("unused");
  assert.equal(unused.length, 2);
  assert.equal(record.suppressedDeclarations.has(unused[0]), record.suppressedDeclarations.has(unused[1]),
    "every overload shares the sealed implementation result, including checked first-class uses");
  for (const declaration of declarations.get("deadRoot")) assert.equal(record.suppressedDeclarations.has(declaration), true);
  for (const declaration of declarations.get("active")) assert.equal(record.suppressedDeclarations.has(declaration), false);
  const read = declarations.get("read").find(node => program.source.ast.kindName(node) === "KindMethodDeclaration");
  assert.equal(record.suppressedDeclarations.has(read), false);
  const value = declarations.get("value").find(node => program.source.ast.kindName(node) === "KindPropertyDeclaration");
  const unread = declarations.get("unread").find(node => program.source.ast.kindName(node) === "KindPropertyDeclaration");
  assert.equal(value !== undefined, true);
  assert.equal(unread !== undefined, true);
  assert.equal(record.readAuthoredFields.has(value), true);
  assert.equal(record.readAuthoredFields.has(unread), false, "writes and constructor assignments do not invent reads");
});

test("planner creation and warning emission never reopen source reachability evidence", () => {
  const { program, declarations } = fixture();
  const inaccessible = new Proxy({}, { get() { throw new Error("post-seal semantic read"); } });
  const isolated = Object.freeze({ ...program,
    source: { ...program.source, ast: { getFileName: program.source.ast.getFileName } },
    sourceNavigation: inaccessible, records: inaccessible, projectTypes: inaccessible,
    structuralShapes: inaccessible, callableValues: inaccessible,
  });
  const input = createRustPlanningContext(isolated);
  assert.equal(input.program.reachability === program.reachability, true);
  assert.equal("liveness" in input, false, "no planner-owned analysis object remains");
  const context = { input };
  for (const declaration of declarations.get("deadRoot"))
    assert.equal(directives.rustAuthoredDeadCodeDisposition(context, declaration), "authored-declaration");
  for (const declaration of declarations.get("active"))
    assert.equal(directives.rustAuthoredDeadCodeDisposition(context, declaration), undefined);
  const owner = declarations.get("Box").find(node => program.source.ast.kindName(node) === "KindClassDeclaration");
  const unread = declarations.get("unread").find(node => program.source.ast.kindName(node) === "KindPropertyDeclaration");
  assert.equal(directives.rustAuthoredFieldDeadCodeDisposition(context, owner, unread, false), "authored-unread-field");
  assert.equal(directives.rustAuthoredFieldDeadCodeDisposition(context, owner, unread, true), undefined);
});

test("public library reachability and dead binary declarations remain separate", () => {
  const binary = fixture("bin");
  const library = fixture("lib");
  for (const current of [binary, library]) {
    const main = current.declarations.get("main").find(node => current.program.source.ast.kindName(node) === "KindFunctionDeclaration");
    assert.equal(current.program.reachability.externallyReachable.has(main), current === library);
    assert.equal(current.program.reachability.suppressedDeclarations.has(main), false);
  }
});
