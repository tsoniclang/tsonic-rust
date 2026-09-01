import type { RustTargetProgram } from "../../analysis/program/model.js";
import {
  createRustArtifactGraph,
} from "./artifacts/index.js";
import type {
  RustArtifactGraph,
} from "./artifacts/index.js";
import { createRustPlannerLiveness } from "./liveness/plan.js";
import type { RustPlannerLiveness } from "./liveness/plan.js";

export interface RustPlanningContext {
  readonly host: RustTargetProgram["host"];
  readonly program: RustTargetProgram;
  readonly artifacts: RustArtifactGraph;
  readonly liveness: RustPlannerLiveness;
}

export function createRustPlanningContext(
  program: RustTargetProgram,
): RustPlanningContext {
  return Object.freeze({
    host: program.host,
    program,
    artifacts: createRustArtifactGraph(),
    liveness: createRustPlannerLiveness(program),
  });
}
