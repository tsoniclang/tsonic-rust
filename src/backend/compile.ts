import { runTargetCompilationStages } from "@tsonic/target-api/artifacts";
import type {
  TargetCompilationObserver,
  TargetCompileResult,
} from "@tsonic/target-api/artifacts";
import { planRustOutput } from "./planner/program/index.js";
import { createRustPlanningContext } from "./planner/context.js";
import { analyzeRustTargetProgram } from "../analysis/program/index.js";
import type { RustTargetAnalysisRequest } from "../analysis/program/index.js";
import type { RustTargetProgram } from "../target-model/program.js";
import { materializeRustOutputPlan } from "./emission/materialize.js";

export function compileRustTarget(
  request: RustTargetAnalysisRequest,
  observer?: TargetCompilationObserver<
    RustTargetProgram,
    Extract<ReturnType<typeof planRustOutput>, { readonly kind: "resolved" }>["value"]
  >,
): TargetCompileResult {
  return runTargetCompilationStages({
    analyze: () => analyzeRustTargetProgram(request),
    plan: (program) => planRustOutput(createRustPlanningContext(program)),
    materialize: materializeRustOutputPlan,
  }, observer);
}
