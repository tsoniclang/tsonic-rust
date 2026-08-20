import type {
  TargetBackend,
  TargetBackendContext,
  TargetCompileInput,
} from "@tsonic/target-api";
import type { TargetCompileResult } from "@tsonic/target-api/artifacts";
import { planRustArtifacts } from "./planner/program/index.js";
import { createRustPlanningContext } from "./planner/context.js";
import type { RustProviderSemantics } from "../providers/packages/model.js";
import { analyzeRustTargetProgram } from "../analysis/program/index.js";
import { materializeRustArtifacts } from "./emission/materialize.js";
import { readRustOutputType } from "../options/rust-target-options.js";

export function createRustBackend(
  context: TargetBackendContext,
  providerSemantics: RustProviderSemantics,
  jsEnabled: boolean,
): TargetBackend {
  return {
    compile(input: TargetCompileInput): TargetCompileResult {
      const analysis = analyzeRustTargetProgram(
        context,
        input,
        providerSemantics,
        jsEnabled,
        readRustOutputType(input.target) === "lib",
      );
      return analysis.kind === "rejected"
        ? { artifacts: [], diagnostics: analysis.diagnostics }
        : materializeRustArtifacts(planRustArtifacts(
            createRustPlanningContext(context, input, analysis.program),
          ));
    },
  };
}
