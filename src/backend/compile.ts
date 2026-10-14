import {
  rejectedTargetStage,
  runTargetCompilationStages,
} from "@tsonic/target-api/artifacts";
import type {
  TargetCompilationObserver,
  TargetCompileResult,
} from "@tsonic/target-api/artifacts";
import { planRustOutput } from "./planner/program/index.js";
import { createRustPlanningContext } from "./planner/context.js";
import { analyzeRustTargetProgram } from "../analysis/program/index.js";
import type {
  RustTargetAnalysisRequest,
  RustTargetProgram,
} from "../analysis/program/index.js";
import type { RustOutputPlan } from "./artifact-model/output.js";
import { materializeRustOutputPlan } from "./emission/materialize.js";
import { RustFormattingError } from "./emission/rustfmt.js";

export function compileRustTarget(
  request: RustTargetAnalysisRequest,
  observer?: TargetCompilationObserver<RustTargetProgram, RustOutputPlan>,
): TargetCompileResult {
  try {
    return runTargetCompilationStages({
      analyze: () => analyzeRustTargetProgram(request),
      plan: (program) => planRustOutput(createRustPlanningContext(program)),
      materialize: materializeRustOutputPlan,
    }, observer);
  } catch (error) {
    if (!(error instanceof RustFormattingError)) {
      throw error;
    }
    return rejectedTargetStage([{
      code: "RUST_SOURCE_FORMATTING_FAILED",
      category: "error",
      source: "tsonic-rust",
      message: error.message,
      evidence: ["target.capability=rust.toolchain.rustfmt"],
    }]);
  }
}
