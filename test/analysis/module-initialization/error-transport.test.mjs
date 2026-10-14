import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { moduleInitializationErrorCases } from "../../../../tsonic/test/fixtures/module-initialization-errors.mjs";
import { resolvedTargetStage, runTargetCompilationStages } from "@tsonic/target-api/artifacts";
import { createRustPlanningContext } from "../../../dist/backend/planner/context.js";
import { planRustOutput } from "../../../dist/backend/planner/program/planning.js";
import { planRustModuleInitializers } from "../../../dist/backend/planner/program/module-initialization.js";

for (const surfaces of [[], ["js"]]) {
  for (const current of moduleInitializationErrorCases) {
    test(`module initialization preserves ${current.name} on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: `init_${current.name}` } },
        files: { ...current.files, "index.ts": current.source },
        ...(current.sourcePackages === undefined ? {} : { sourcePackages: current.sourcePackages }),
      });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
      const native = validateGeneratedProject(`module-errors-${current.name}`, result.artifacts, { run: true });
      assert.equal(native.stdout, "");
    });
  }
}

const absentOwner = Object.freeze({ kind: "physical", domain: "project", componentId: "not-a-sealed-component" });
const warning = Object.freeze({ code: "ANALYSIS_WARNING", category: "warning", message: "A prior analysis warning is retained." });
const programs = new Map();

function initializerProgram(surfaces) {
  const key = surfaces[0] ?? "native";
  if (!programs.has(key)) {
    programs.set(key, analyzeRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: `initializer_invariant_${key}` } },
      files: { "index.ts": `export function main(): void {
        if (1 !== 1) throw new Error("initializer identity");
      } main();` },
    }).program);
  }
  return programs.get(key);
}

for (const surfaces of [[], ["js"]]) {
  for (const [name, replace, message] of [
    ["missing source error region", (program, sourceFile) => ({ ...program,
      errorRegions: { ...program.errorRegions,
        get: node => node === sourceFile ? undefined : program.errorRegions.get(node) },
    }), "Module initializer has no exact finalized error region."],
    ["unrenderable source error region", (program, sourceFile) => ({ ...program,
      errorRegions: { ...program.errorRegions, get: node => node === sourceFile
        ? { ...program.errorRegions.get(node), localOwner: absentOwner } : program.errorRegions.get(node) },
    }), "Module initializer has no exact finalized error region."],
    ["missing completed module selection", program => ({ ...program,
      errorRegions: { ...program.errorRegions,
        initialization: { ...program.errorRegions.initialization, moduleFor: () => undefined } },
    }), "Source module '/src/index.ts' has no exact finalized initializer error effects."],
    ["unrenderable completed root", program => ({ ...program,
      errorRegions: { ...program.errorRegions, initialization: { ...program.errorRegions.initialization,
        root: { ...program.errorRegions.initialization.root, error: { kind: "package", owner: absentOwner } } } },
    }), "The completed root initializer error composition has no exact native reconstruction."],
    ["missing completed worker selection", (program, sourceFile) => ({ ...program,
      sourceModuleConstructions: { ...program.sourceModuleConstructions, targets: () => [sourceFile] },
      errorRegions: { ...program.errorRegions,
        initialization: { ...program.errorRegions.initialization, workerFor: () => undefined } },
    }), "A worker initializer has no completed exact error composition."],
    ["unrenderable completed worker", (program, sourceFile) => ({ ...program,
      sourceModuleConstructions: { ...program.sourceModuleConstructions, targets: () => [sourceFile] },
      errorRegions: { ...program.errorRegions, initialization: { ...program.errorRegions.initialization,
        workerFor: () => ({ ...program.errorRegions.initialization.root, error: { kind: "package", owner: absentOwner } }) } },
    }), "A completed worker error composition has no exact native reconstruction."],
  ]) {
    test(`sealed initializer invariant ${name} on ${surfaces[0] ?? "native"}`, () => {
      const program = initializerProgram(surfaces);
      const sourceFile = program.errorRegions.initialization.entrySourceFile;
      assert.equal(sourceFile !== undefined, true);
      const changed = Object.freeze(replace(program, sourceFile));
      const compiled = runTargetCompilationStages({
        analyze: () => resolvedTargetStage(changed, [warning]),
        plan: selected => planRustOutput(createRustPlanningContext(selected)),
        materialize() { assert.fail("An inconsistent sealed initializer must not be materialized."); },
      });
      assert.equal(compiled.kind, "rejected");
      assert.equal(Object.hasOwn(compiled, "value"), false);
      assert.equal(compiled.diagnostics.length, 2);
      assert.equal(compiled.diagnostics[0] === warning, true);
      const diagnostic = compiled.diagnostics[1];
      assert.equal(diagnostic.code, "TSONIC_INTERNAL_PLANNER_INVARIANT");
      assert.equal(diagnostic.category, "error");
      assert.equal(diagnostic.source, "tsonic-rust");
      assert.equal(diagnostic.message, message);
      assert.equal(diagnostic.sourceNode === sourceFile, true, "the original source AST identity is retained");
      assert.equal(Object.isFrozen(diagnostic), true);
    });
  }

  for (const missing of ["native symbol", "rendered error payload"]) {
    test(`sealed module initializer lacks its ${missing} on ${surfaces[0] ?? "native"}`, () => {
      const program = initializerProgram(surfaces);
      const sourceFile = program.errorRegions.initialization.entrySourceFile;
      assert.equal(sourceFile !== undefined, true);
      const selected = program.errorRegions.initialization.moduleFor(sourceFile);
      assert.equal(selected !== undefined, true);
      const region = { kind: "infallible", fileName: selected.identity, sources: [],
        localOwner: missing === "rendered error payload" ? absentOwner : undefined };
      const selection = { ...program.errorRegions.initialization.root, modules: [{ ...selected, region }] };
      const sources = missing === "native symbol" ? [] : [{ sourceFile, moduleName: "index",
        moduleInitialization: { functionName: "module_init" } }];
      const compiled = runTargetCompilationStages({
        analyze: () => resolvedTargetStage(selection),
        plan: current => resolvedTargetStage(planRustModuleInitializers(sources, current,
          { byFileName: new Map() }, {})),
        materialize() { assert.fail("A missing sealed module reconstruction must not be materialized."); },
      });
      assert.equal(compiled.kind, "rejected");
      assert.equal(Object.hasOwn(compiled, "value"), false);
      assert.equal(compiled.diagnostics.length, 1);
      const diagnostic = compiled.diagnostics[0];
      assert.equal(diagnostic.code, "TSONIC_INTERNAL_PLANNER_INVARIANT");
      assert.equal(diagnostic.source, "tsonic-rust");
      assert.equal(diagnostic.category, "error");
      assert.equal(diagnostic.message,
        `Completed initializer '${selected.identity}' has no exact native symbol or rendered error payload.`);
      assert.equal(diagnostic.sourceNode === sourceFile, true, "the completed selection's AST identity is retained");
    });
  }
}
