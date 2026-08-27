import { rustLifetimeKey, rustLifetimesEqual } from "./identity.js";
import type {
  RustLifetimeRef,
  RustSourceGenericContract,
} from "./model.js";

export function rustLifetimeOutlives(
  source: RustLifetimeRef,
  target: RustLifetimeRef,
  contract: RustSourceGenericContract,
): boolean {
  if (rustLifetimesEqual(source, target) || source.kind === "static") {
    return true;
  }
  if (target.kind === "static") {
    return false;
  }
  const edges = new Map(contract.parameters.flatMap((parameter) =>
    parameter.kind === "lifetime"
      ? [[rustLifetimeKey(parameter.lifetime), parameter.outlives] as const]
      : []));
  const targetKey = rustLifetimeKey(target);
  const pending = [...(edges.get(rustLifetimeKey(source)) ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const candidate = pending.pop()!;
    const candidateKey = rustLifetimeKey(candidate);
    if (candidateKey === targetKey) return true;
    if (visited.has(candidateKey)) continue;
    visited.add(candidateKey);
    pending.push(...(edges.get(candidateKey) ?? []));
  }
  return false;
}
