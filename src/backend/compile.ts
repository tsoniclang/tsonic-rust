import {
  runTargetCompilationStages,
} from "@tsonic/target-api/artifacts";
import type { TargetCompileResult } from "@tsonic/target-api/artifacts";
import { planRustOutput } from "./planner/program/index.js";
import { createRustPlanningContext } from "./planner/context.js";
import { analyzeRustTargetProgram } from "../analysis/program/index.js";
import type { RustTargetAnalysisRequest } from "../analysis/program/index.js";
import { materializeRustOutputPlan } from "./emission/materialize.js";

export function compileRustTarget(
  request: RustTargetAnalysisRequest,
): TargetCompileResult {
  return runTargetCompilationStages({
    analyze: () => analyzeRustTargetProgram(request),
    plan: (program) => planRustOutput(createRustPlanningContext(program)),
    materialize: materializeRustOutputPlan,
  });
}
