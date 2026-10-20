import type { RustTargetProgram } from "../../analysis/program/model.js";

export interface RustPlanningContext {
  readonly host: RustTargetProgram["host"];
  readonly program: {
    readonly source: Pick<RustTargetProgram["source"], "ast">;
    readonly records: RustTargetProgram["records"];
  };
}

export function createRustPlanningContext(program: RustTargetProgram): RustPlanningContext {
  return Object.freeze({ host: program.host, program: Object.freeze({
    source: Object.freeze({ ast: program.source.ast }), records: program.records,
  }) });
}
