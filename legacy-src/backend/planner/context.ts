import type { RustTargetProgram } from "../../analysis/program/model.js";
import {
  createRustArtifactGraph,
} from "./artifacts/index.js";
import type {
  RustArtifactGraph,
} from "./artifacts/index.js";

export interface RustPlanningContext {
  readonly host: RustTargetProgram["host"];
  readonly program: RustTargetProgram;
  readonly artifacts: RustArtifactGraph;
}

export function createRustPlanningContext(
  program: RustTargetProgram,
): RustPlanningContext {
  return Object.freeze({
    host: program.host,
    program,
    artifacts: createRustArtifactGraph(),
  });
}
