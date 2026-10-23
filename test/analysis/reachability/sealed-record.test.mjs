import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { sealRustAnalysisProgram } from "../../../dist/analysis/program/target-program.js";
import { createRustPlanningContext } from "../../../dist/backend/planner/context.js";
import * as directives from "../../../dist/backend/planner/program/reachability-directives.js";

function fixture(outputType = "bin", publicBox = false) {
  const analyzed = analyzeRust({ surfaces: [], target: { id: "rust", options: { outputType } }, files: {
    "index.ts": `import type { int32 } from "@tsonic/core/types.js";
      ${publicBox ? "export" : ""} class Box {
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
  const program = sealRustAnalysisProgram(analyzed.program);
  const declarations = new Map();
  const pending = [...program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)];
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
  const record = program.records.authoredLiveness;
  assert.equal(Object.isFrozen(program), true);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(typeof record.get, "function", "the reader exposes only the sealed source decision");
  assert.equal("reachability" in program, false, "no post-seal reachability engine is published");
  const unused = declarations.get("unused");
  assert.equal(unused.length, 2);
  const unusedSignature = unused.find(node => program.source.ast.body(node) === undefined);
  const unusedImplementation = unused.find(node => program.source.ast.body(node) !== undefined);
  assert.equal(record.get(unusedSignature), undefined, "an erased overload signature is never emitted as a second native item");
  assert.equal(record.get(unusedImplementation).deadCode, "authored-declaration", "the sole emitted overload implementation has the canonical liveness decision");
  for (const declaration of declarations.get("deadRoot")) assert.equal(record.get(declaration).deadCode, "authored-declaration");
  for (const declaration of declarations.get("active").filter(node => program.source.ast.body(node) !== undefined)) assert.equal(record.get(declaration).deadCode, undefined);
  const read = declarations.get("read").find(node => program.source.ast.kindName(node) === "KindMethodDeclaration");
  assert.equal(record.get(read).deadCode, undefined);
  const value = declarations.get("value").find(node => program.source.ast.kindName(node) === "KindPropertyDeclaration");
  const unread = declarations.get("unread").find(node => program.source.ast.kindName(node) === "KindPropertyDeclaration");
  assert.equal(value !== undefined, true);
  assert.equal(unread !== undefined, true);
  const owner = declarations.get("Box").find(node => program.source.ast.is.IsClassDeclaration(node));
  const fields = program.records.nativeClass.get(owner).fields;
  assert.equal(fields.find(field => field.declaration === value).deadCode, undefined);
  assert.equal(fields.find(field => field.declaration === unread).deadCode, "authored-unread-field", "writes and constructor assignments do not invent reads");
});

test("planner creation and warning emission never reopen source reachability evidence", () => {
  const { program, declarations } = fixture();
  const inaccessible = new Proxy({}, { get() { throw new Error("post-seal semantic read"); } });
  const isolated = Object.freeze({ ...program,
    source: { ...program.source, ast: { getFileName: program.source.ast.getFileName } },
    sourceNavigation: inaccessible, projectTypes: inaccessible,
    structuralShapes: inaccessible, callableValues: inaccessible,
  });
  const input = createRustPlanningContext(isolated);
  assert.equal(input.program.records === program.records, true);
  assert.equal("reachability" in input.program, false, "native liveness has no second read route");
  assert.equal("liveness" in input, false, "no planner-owned analysis object remains");
  const context = { input };
  for (const declaration of declarations.get("deadRoot"))
    assert.equal(directives.rustAuthoredDeadCodeDisposition(context, declaration), "authored-declaration");
  for (const declaration of declarations.get("active").filter(node => program.source.ast.body(node) !== undefined))
    assert.equal(directives.rustAuthoredDeadCodeDisposition(context, declaration), undefined);
  const owner = declarations.get("Box").find(node => program.source.ast.kindName(node) === "KindClassDeclaration");
  const unread = declarations.get("unread").find(node => program.source.ast.kindName(node) === "KindPropertyDeclaration");
  assert.equal(input.program.records.nativeClass.get(owner).fields.find(field => field.declaration === unread).deadCode, "authored-unread-field");
  const library = fixture("lib", true);
  const libraryOwner = library.declarations.get("Box").find(node => library.program.source.ast.is.IsClassDeclaration(node));
  const libraryClass = library.program.records.nativeClass.get(libraryOwner);
  assert.equal(libraryClass.publiclyReachable, true, "exported native class fields remain externally observable");
  assert.equal(libraryClass.fields.find(field => field.sourceName === "unread").deadCode, undefined,
    "externally observable fields never get an internal dead-code disposition");
});

test("public library reachability and dead binary declarations remain separate", () => {
  const binary = fixture("bin");
  const library = fixture("lib");
  for (const current of [binary, library]) {
    const main = current.declarations.get("main").find(node => current.program.source.ast.kindName(node) === "KindFunctionDeclaration");
    assert.equal(current.program.records.callableDeclaration.get(main).exported, current === library);
    assert.equal(current.program.records.authoredLiveness.get(main).deadCode, undefined);
  }
});
