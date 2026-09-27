import type { RustNativeDefinitionId, RustNativeNodeId, RustNativeSourceSpan } from "./evidence.js";
import { nativeDefinitionKey } from "./evidence.js";
import type { RustNativeBodyFlow, RustNativeFlowOrigin, RustNativeFlowStep } from "./flow-model.js";
import { unique } from "./decode-values.js";

export function validateNativeFlowRelations(
  flows: readonly RustNativeBodyFlow[],
  requireDefinition: (identity: RustNativeDefinitionId) => void,
  requireBinding: (identity: RustNativeNodeId) => void,
  requireSpan: (span: RustNativeSourceSpan | null) => void,
): void {
  unique(flows.map(body => nativeDefinitionKey(body.owner)), "flow body");
  for (const body of flows) {
    requireDefinition(body.owner);
    if (body.locals.length <= body.argumentCount || body.blocks.length === 0 || body.blocks[0]?.cleanup !== false) {
      throw new Error("Native Rust flow requires a return local, every argument and a non-cleanup entry block.");
    }
    const requireLocal = (local: number): void => {
      if (local >= body.locals.length) throw new Error("Native Rust flow references an absent local.");
    };
    const requireBlock = (target: number | null): void => {
      if (target !== null && target >= body.blocks.length) throw new Error("Native Rust flow references an absent block.");
    };
    const origin = (origin: RustNativeFlowOrigin): void => {
      requireDefinition(origin.node.owner);
      requireSpan(origin.source);
    };
    const step = (step: RustNativeFlowStep): void => {
      origin(step.origin);
      for (const access of step.accesses) {
        requireLocal(access.local);
        for (const projection of access.projections) if (projection.kind === "index") requireLocal(projection.local);
      }
    };
    for (const [index, local] of body.locals.entries()) {
      origin(local.origin);
      if (local.binding !== null) requireBinding(local.binding);
      if (local.guardTarget !== null) {
        requireLocal(local.guardTarget);
        if (local.guardTarget === index || body.locals[local.guardTarget]?.guardTarget !== null) {
          throw new Error("Native Rust flow has an invalid guard binding target.");
        }
      }
    }
    for (const block of body.blocks) {
      for (const statement of block.statements) step(statement);
      step(block.terminator);
      const control = block.terminator.control;
      switch (control.kind) {
        case "goto": case "call": case "assert": requireBlock(control.target); break;
        case "drop": requireBlock(control.target); requireBlock(control.drop); break;
        case "switch":
          for (const branch of control.branches) requireBlock(branch.target);
          requireBlock(control.otherwise);
          break;
        case "yield": requireBlock(control.resume); requireBlock(control.drop); break;
        case "false-edge": requireBlock(control.real); requireBlock(control.imaginary); break;
        case "false-unwind": requireBlock(control.real); break;
        case "inline-assembly": for (const target of control.targets) requireBlock(target); break;
        case "return": case "unreachable": case "unwind-resume": case "unwind-terminate":
        case "tail-call": case "coroutine-drop": break;
      }
      if ("unwind" in control && control.unwind.kind === "cleanup") {
        requireBlock(control.unwind.target);
        if (body.blocks[control.unwind.target]?.cleanup !== true) {
          throw new Error("Native Rust flow unwind target is not a cleanup block.");
        }
      }
    }
  }
}
