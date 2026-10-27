import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { moduleInitializationErrorCases } from "../../../../tsonic/test/fixtures/module-initialization-errors.mjs";
import { rejectedTargetStage, resolvedTargetStage, runTargetCompilationStages } from "@tsonic/target-api/artifacts";
import { createRustPlanningContext } from "../../../dist/backend/planner/context.js";
import { planRustOutput } from "../../../dist/backend/planner/program/planning.js";
import { planRustInitializerBoundary, planRustModuleInitializers } from "../../../dist/backend/planner/program/module-initialization.js";
import { planRustSelectedErrorRegion } from "../../../dist/backend/planner/program/error-regions.js";
import { analyzeRustSourceFileEmission } from "../../../dist/analysis/source-modules/emission.js";
import { analyzeRustSourcePackageInitializers } from "../../../dist/analysis/source-modules/package-initializers.js";
import { analyzeRustWorkerEntries } from "../../../dist/analysis/source-modules/worker-entries.js";
import { createRustSourceFileEmissionProducer } from "../../../dist/analysis/program/records/program/source-file-emission.js";
import { createRustSourcePackageEmissionProducer } from "../../../dist/analysis/program/records/program/source-packages.js";
import { rustSourceFilePlanContext } from "../../helpers/plan-context.mjs";
import {
  absentOwner,
  warning,
  programs,
  initializerProgram,
  rejectAtAdmission,
  invariantCases,
} from "./error-transport-fixtures.mjs";

for (const surfaces of ([[], ["js"]]).slice(1, 2)) {
for (const current of (moduleInitializationErrorCases).slice(6, 8)) {
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

for (const surfaces of [[], ["js"]]) {
  for (const current of invariantCases) {
    const { name, phase, message } = current;
    test(`sealed initializer invariant ${name} on ${surfaces[0] ?? "native"}`, () => {
      const program = initializerProgram(surfaces);
      const sourceFile = program.errorRegions.initialization.entrySourceFile;
      assert.equal(sourceFile !== undefined, true);
      const compiled = runTargetCompilationStages({
        analyze: () => phase === "analysis"
          ? rejectAtAdmission(() => current.run(program, sourceFile))
          : resolvedTargetStage(program, [warning]),
        plan: () => resolvedTargetStage(current.run(program, sourceFile)),
        materialize() { assert.fail("An inconsistent sealed initializer must not be materialized."); },
      });
      assert.equal(compiled.kind, "rejected");
      assert.equal(Object.hasOwn(compiled, "value"), false);
      assert.equal(compiled.diagnostics.length, 2);
      assert.equal(compiled.diagnostics[0] === warning, true);
      const diagnostic = compiled.diagnostics[1];
      assert.equal(diagnostic.code, phase === "analysis" ? "TSONIC_INTERNAL_ANALYSIS_INVARIANT" : "TSONIC_INTERNAL_PLANNER_INVARIANT");
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
      const initializers = program.records.sourcePackageInitializers.get();
      const packageInitializers = missing === "native symbol" ? { ...initializers,
        byFileName: new Map([...initializers.byFileName].filter(([identity]) => identity !== selected.identity)) } : initializers;
      const rendering = rustSourceFilePlanContext(program, sourceFile);
      const compiled = runTargetCompilationStages({
        analyze: () => resolvedTargetStage(selection),
        plan: current => resolvedTargetStage(planRustModuleInitializers(current, packageInitializers, rendering)),
        materialize() { assert.fail("A missing sealed module reconstruction must not be materialized."); },
      });
      assert.equal(compiled.kind, "rejected");
      assert.equal(Object.hasOwn(compiled, "value"), false);
      assert.equal(compiled.diagnostics.length, 1);
      const diagnostic = compiled.diagnostics[0];
      assert.equal(diagnostic.code, "TSONIC_INTERNAL_PLANNER_INVARIANT");
      assert.equal(diagnostic.source, "tsonic-rust");
      assert.equal(diagnostic.category, "error");
      assert.equal(diagnostic.message, missing === "native symbol"
        ? `Completed initializer '${selected.identity}' has no exact native symbol or rendered error payload.`
        : "An admitted native error region requires its exact physical package boundary.");
      assert.equal(diagnostic.sourceNode === sourceFile, true, "the completed selection's AST identity is retained");
      assert.equal(Object.isFrozen(diagnostic), true);
    });
  }
}
