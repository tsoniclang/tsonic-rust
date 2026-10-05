import type { Node } from "@tsonic/tsts";

export interface RustConstructionState {
  readonly initialized: ReadonlySet<Node>;
  readonly possiblyInitialized: ReadonlySet<Node>;
  readonly published: boolean;
}

export interface RustConstructionTransfer {
  readonly target: Node | undefined;
  readonly state: RustConstructionState;
}

export interface RustConstructionFlow {
  readonly normal?: RustConstructionState;
  readonly returned: readonly RustConstructionState[];
  readonly thrown: readonly RustConstructionState[];
  readonly breaks: readonly RustConstructionTransfer[];
  readonly continues: readonly RustConstructionTransfer[];
}

export function rustConstructionFallthrough(normal?: RustConstructionState): RustConstructionFlow {
  return { normal, returned: [], thrown: [], breaks: [], continues: [] };
}

export function rustConstructionFlowStates(flow: RustConstructionFlow): readonly RustConstructionState[] {
  return [...(flow.normal === undefined ? [] : [flow.normal]), ...flow.returned, ...flow.thrown,
    ...flow.breaks.map(transfer => transfer.state), ...flow.continues.map(transfer => transfer.state)];
}

export function rustConstructionFinalizeFlow(
  incoming: RustConstructionFlow,
  finalized: RustConstructionFlow,
): RustConstructionFlow {
  const state = finalized.normal;
  return { normal: incoming.normal === undefined ? undefined : state,
    returned: [...(state === undefined ? [] : incoming.returned.map(() => state)), ...finalized.returned],
    thrown: [...(state === undefined ? [] : incoming.thrown.map(() => state)), ...finalized.thrown],
    breaks: [...(state === undefined ? [] : incoming.breaks.map(transfer => ({ ...transfer, state }))), ...finalized.breaks],
    continues: [...(state === undefined ? [] : incoming.continues.map(transfer => ({ ...transfer, state }))), ...finalized.continues] };
}
