import { maximumFlowQuerySteps } from "./complexity.js";

export class FlowConstructionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class FlowLimitError extends FlowConstructionError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

export class FlowShapeError extends FlowConstructionError {
  constructor(message: string) {
    super("RUST_SOURCE_AST_INCOMPLETE", message);
  }
}

export class RustSourceFlowQueryLimitError extends Error {
  constructor(readonly stepCount: number) {
    super(
      `Rust ownership analysis performed ${stepCount} control-flow query steps; ` +
      `the finite limit is ${maximumFlowQuerySteps}.`,
    );
  }
}
