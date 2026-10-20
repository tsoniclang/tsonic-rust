import type { RustTargetProgram } from "../../analysis/program/model.js";

export interface RustPlanningContext {
  readonly host: RustTargetProgram["host"];
  readonly program: RustTargetProgram;
}

export function createRustPlanningContext(
  program: RustTargetProgram,
): RustPlanningContext {
  return Object.freeze({
    host: program.host,
    program,
  });
}
