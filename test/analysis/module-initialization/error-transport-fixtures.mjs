import assert from "node:assert/strict";

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


const absentOwner = Object.freeze({ kind: "physical", domain: "project", componentId: "not-a-sealed-component" });

const warning = Object.freeze({ code: "ANALYSIS_WARNING", category: "warning", message: "A prior analysis warning is retained." });

const programs = new Map();


function initializerProgram(surfaces) {
  const key = surfaces[0] ?? "native";
  if (!programs.has(key)) {
    programs.set(key, analyzeRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: `initializer_invariant_${key}` } },
      files: { "index.ts": `export function main(fail: boolean): void {
        if (fail) throw new Error("initializer identity");
      } main(false);` },
    }).program);
  }
  return programs.get(key);
}


function rejectAtAdmission(action) {
  const admitted = runTargetCompilationStages({
    analyze() { action(); assert.fail("The inconsistent producer input must be rejected at admission."); },
    plan() { assert.fail("An inconsistent producer input must not reach planning."); },
    materialize() { assert.fail("An inconsistent producer input must not be materialized."); },
  });
  assert.equal(admitted.kind, "rejected");
  assert.equal(Object.hasOwn(admitted, "value"), false);
  return rejectedTargetStage([warning, ...admitted.diagnostics]);
}


const invariantCases = [
  {
    name: "missing source error region", phase: "analysis",
    message: "An admitted source module requires its exact finalized error region.",
    run(program, sourceFile) {
      const producer = createRustSourceFileEmissionProducer(() => {});
      return analyzeRustSourceFileEmission({ ...program, errorRegions: { ...program.errorRegions,
        get: node => node === sourceFile ? undefined : program.errorRegions.get(node) } }, producer);
    },
  },
  {
    name: "unrenderable source error region", phase: "planning",
    message: "An admitted native error region requires its exact physical package boundary.",
    run(program, sourceFile) {
      const selected = program.records.nativeErrorRegion.get(sourceFile);
      assert.equal(selected !== undefined && selected.kind !== "infallible", true, "the real source region is fallible");
      return planRustSelectedErrorRegion({ ...selected, localOwner: absentOwner },
        rustSourceFilePlanContext(program, sourceFile), sourceFile);
    },
  },
  {
    name: "missing completed module selection", phase: "analysis",
    message: "Source module '/src/index.ts' has no exact finalized initializer error effects.",
    run(program) {
      return analyzeRustSourcePackageInitializers({ ...program, errorRegions: { ...program.errorRegions,
        initialization: { ...program.errorRegions.initialization, moduleFor: () => undefined } } },
      program.records.sourcePackageComponents.get(), program.sourceOutputIdentities);
    },
  },
  {
    name: "unrenderable completed root", phase: "planning",
    message: "An admitted initializer requires its exact physical error owner.",
    run(program, sourceFile) {
      const rendering = rustSourceFilePlanContext(program, sourceFile);
      const root = program.errorRegions.initialization.root;
      const modules = planRustModuleInitializers(root, program.records.sourcePackageInitializers.get(), rendering);
      assert.equal(modules.length > 0, true, "the root reconstructs its real module initializers");
      return planRustInitializerBoundary({ ...root, error: { kind: "package", owner: absentOwner } },
        modules, "initializer_invariant", undefined, rendering);
    },
  },
  {
    name: "missing completed worker selection", phase: "analysis",
    message: "A worker initializer requires its exact completed error composition.",
    run(program, sourceFile) {
      const producer = createRustSourcePackageEmissionProducer(() => {});
      return analyzeRustWorkerEntries({ ...program,
        sourceModuleConstructions: { ...program.sourceModuleConstructions, targets: () => [sourceFile] },
        errorRegions: { ...program.errorRegions, initialization: { ...program.errorRegions.initialization,
          workerFor: () => undefined } } }, producer);
    },
  },
  {
    name: "unrenderable completed worker", phase: "planning",
    message: "An admitted initializer requires its exact physical error owner.",
    run(program, sourceFile) {
      const producer = createRustSourcePackageEmissionProducer(() => {});
      const issues = analyzeRustWorkerEntries({ ...program,
        sourceModuleConstructions: { ...program.sourceModuleConstructions, targets: () => [sourceFile] },
        errorRegions: { ...program.errorRegions, initialization: { ...program.errorRegions.initialization,
          workerFor: () => program.errorRegions.initialization.root } } }, producer);
      assert.equal(issues.length, 0, "the actual worker admission accepts its complete initializer");
      const workers = producer.records.workerEntries.get();
      assert.equal(workers?.length, 1, "one original worker source is admitted");
      assert.equal(workers[0].sourceFile === sourceFile, true, "worker admission retains source identity");
      const changed = { ...program, records: { ...program.records, workerEntries: { get: () => workers.map(worker =>
        Object.freeze({ ...worker, initializer: { ...worker.initializer, error: { kind: "package", owner: absentOwner } } })) } } };
      return planRustOutput(createRustPlanningContext(changed));
    },
  },
];

export {
  absentOwner,
  warning,
  programs,
  initializerProgram,
  rejectAtAdmission,
  invariantCases,
};
