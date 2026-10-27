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

for (const surfaces of ([[], ["js"]]).slice(0, 1)) {
for (const current of (moduleInitializationErrorCases).slice(0, 8)) {
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

for (const surfaces of ([[], ["js"]]).slice(1, 2)) {
for (const current of (moduleInitializationErrorCases).slice(0, 6)) {
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
