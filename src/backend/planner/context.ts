import type {
  TargetBackendContext,
  TargetCompileInput,
} from "@tsonic/target-api";
import type { RustTargetProgram } from "../../analysis/program/model.js";
import {
  createRustArtifactGraph,
} from "./artifacts/index.js";
import type {
  RustArtifactGraph,
} from "./artifacts/index.js";

export interface RustPlanningContext
  extends TargetCompileInput,
    RustTargetProgram {
  readonly backend: TargetBackendContext;
  readonly program: RustTargetProgram;
  readonly artifacts: RustArtifactGraph;
}

export function createRustPlanningContext(
  backend: TargetBackendContext,
  input: TargetCompileInput,
  program: RustTargetProgram,
): RustPlanningContext {
  return Object.freeze({
    ...input,
    ...program,
    backend,
    program,
    artifacts: createRustArtifactGraph(program.ast),
  });
}
