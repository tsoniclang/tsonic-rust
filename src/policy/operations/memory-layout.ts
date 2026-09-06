import type { Node, ReadonlySourceFactResolver } from "@tsonic/tsts";
import { resolveTsonicMemoryLayoutObservation } from "@tsonic/source-core/facts";

export function selectRustMemoryLayoutObservation(facts: ReadonlySourceFactResolver, node: Node) {
  const selected = resolveTsonicMemoryLayoutObservation(facts, node);
  return selected === undefined || selected.kind === "rejected" ? selected
    : Object.freeze({ kind: "resolved" as const, value: selected.value });
}
