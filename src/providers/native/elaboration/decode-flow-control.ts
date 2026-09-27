import type { RustNativeFlowControl, RustNativeUnwind } from "./flow-model.js";
import { array, choice, index, record, shape, unique, unsignedDecimal } from "./decode-values.js";

export function createNativeFlowControlDecoder(reserve: () => void) {
  const nullableIndex = (value: unknown): number | null => value === null ? null : index(value);
  const unwind = (value: unknown): RustNativeUnwind => {
    reserve();
    const input = record(value);
    const kind = choice(input.kind, ["continue", "unreachable", "terminate", "cleanup"]);
    switch (kind) {
      case "continue":
      case "unreachable":
        shape(input, ["kind"]);
        return Object.freeze({ kind });
      case "terminate":
        shape(input, ["kind", "reason"]);
        return Object.freeze({ kind, reason: choice(input.reason, ["abi", "in-cleanup"]) });
      case "cleanup":
        shape(input, ["kind", "target"]);
        return Object.freeze({ kind, target: index(input.target) });
    }
  };
  return (value: unknown): RustNativeFlowControl => {
    reserve();
    const input = record(value);
    const kind = choice(input.kind, ["goto", "switch", "return", "unreachable", "unwind-resume", "unwind-terminate",
      "drop", "call", "tail-call", "assert", "yield", "coroutine-drop", "false-edge", "false-unwind", "inline-assembly"]);
    switch (kind) {
      case "goto":
        shape(input, ["kind", "target"]);
        return Object.freeze({ kind, target: index(input.target) });
      case "switch": {
        shape(input, ["kind", "branches", "otherwise"]);
        const branches = array(input.branches, value => {
          reserve();
          const branch = shape(value, ["value", "target"]);
          return Object.freeze({ value: unsignedDecimal(branch.value, 128), target: index(branch.target) });
        });
        unique(branches.map(branch => branch.value), "flow switch value");
        return Object.freeze({ kind, branches, otherwise: index(input.otherwise) });
      }
      case "return":
      case "unreachable":
      case "unwind-resume":
      case "tail-call":
      case "coroutine-drop":
        shape(input, ["kind"]);
        return Object.freeze({ kind });
      case "unwind-terminate":
        shape(input, ["kind", "reason"]);
        return Object.freeze({ kind, reason: choice(input.reason, ["abi", "in-cleanup"]) });
      case "drop":
        shape(input, ["kind", "target", "unwind", "drop"]);
        return Object.freeze({ kind, target: index(input.target), unwind: unwind(input.unwind), drop: nullableIndex(input.drop) });
      case "call":
        shape(input, ["kind", "target", "unwind"]);
        return Object.freeze({ kind, target: nullableIndex(input.target), unwind: unwind(input.unwind) });
      case "assert":
        shape(input, ["kind", "target", "unwind"]);
        return Object.freeze({ kind, target: index(input.target), unwind: unwind(input.unwind) });
      case "yield":
        shape(input, ["kind", "resume", "drop"]);
        return Object.freeze({ kind, resume: index(input.resume), drop: nullableIndex(input.drop) });
      case "false-edge":
        shape(input, ["kind", "real", "imaginary"]);
        return Object.freeze({ kind, real: index(input.real), imaginary: index(input.imaginary) });
      case "false-unwind":
        shape(input, ["kind", "real", "unwind"]);
        return Object.freeze({ kind, real: index(input.real), unwind: unwind(input.unwind) });
      case "inline-assembly":
        shape(input, ["kind", "targets", "unwind"]);
        return Object.freeze({ kind, targets: array(input.targets, value => { reserve(); return index(value); }),
          unwind: unwind(input.unwind) });
    }
  };
}
