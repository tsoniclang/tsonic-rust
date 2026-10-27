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
