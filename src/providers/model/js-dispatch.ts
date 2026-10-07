import type { RustProviderBinaryHookRow, RustProviderDispatchContextRow } from "../packages/model.js";
import type { RustDispatchContextGroupInput, RustDispatchContextInput } from "../../target-model/operations/dispatch-contexts.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustCallableTargetType, rustNamedTargetType, rustProgramErrorTargetType, rustUnitTargetType } from "../../target-model/types/index.js";

export const rustJsTimerDispatchContextId = "tsonic.rust.js.timers";

export const rustJsTimerDispatchContext: RustProviderDispatchContextRow = snapshotClosedMetadata({
  id: rustJsTimerDispatchContextId,
  requiredCrate: "tsonic_rust_js",
  rootCarrier: rustNamedTargetType("rust.js.Timers", "tsonic_rust_runtime::timer_queue::TimerContext", [
    { kind: "type", type: rustCallableTargetType([], rustUnitTargetType()) },
  ]),
  construct: { form: "call", path: "tsonic_rust_js::timers::new", const: true },
  composedContexts: [],
  providerPackageId: "tsonic.rust.js-surface",
  providerVersion: "1",
});

export const rustJsTimerDispatchInput: RustDispatchContextInput = snapshotClosedMetadata({
  contextId: rustJsTimerDispatchContextId, view: "root", targetArgumentIndex: 0, mode: "ref",
});

function timerGroup(targetArgumentIndex: number): RustDispatchContextGroupInput {
  return {
    contextIds: [rustJsTimerDispatchContextId], targetArgumentIndex,
    empty: { form: "associated-call", method: "new", owner: rustNamedTargetType(
      "rust.runtime.DispatchEnd", "tsonic_rust_runtime::dispatch::DispatchEnd",
      [{ kind: "type", type: rustProgramErrorTargetType() }],
    ) },
    prepend: { form: "call", path: "tsonic_rust_runtime::dispatch::prepend" },
  };
}

export const rustJsEventLoopEpilogue: RustProviderBinaryHookRow = snapshotClosedMetadata({
  id: "tsonic.rust.js.event-loop",
  phase: "after-entry",
  path: "tsonic_rust_js::event_loop::run_with_contexts",
  requiredCrate: "tsonic_rust_js",
  isFallible: true,
  errorBoundary: "source-program",
  dispatchGroups: [timerGroup(0)],
  providerPackageId: "tsonic.rust.js-surface",
  providerVersion: "1",
});

export const rustJsAsyncExecutor: RustProviderBinaryHookRow = snapshotClosedMetadata({
  ...rustJsEventLoopEpilogue,
  id: "tsonic.rust.js.async-executor",
  phase: "async-execution",
  path: "tsonic_rust_js::event_loop::block_on_with_contexts",
  dispatchGroups: [timerGroup(1)],
});
