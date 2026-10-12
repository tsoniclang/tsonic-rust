import { defaultSourceStorageLimits } from "@tsonic/target-api/analysis";

export const defaultRustEffectsWorkLimit = defaultSourceStorageLimits.maximumSteps;

export interface RustEffectsWorkFailure {
  readonly code: "RUST_ERROR_EFFECTS_WORK_LIMIT" | "RUST_ERROR_EFFECTS_WORK_INVALID";
  readonly message: string;
}

export function createRustEffectsWorkBudget(maximumSteps = defaultRustEffectsWorkLimit) {
  let remaining = maximumSteps;
  let failure: RustEffectsWorkFailure | undefined = Number.isSafeInteger(maximumSteps) && maximumSteps > 0
    ? undefined : Object.freeze({ code: "RUST_ERROR_EFFECTS_WORK_INVALID",
      message: "Rust error-effect work limits must be finite positive safe integers." });
  const stopped = Object.freeze({});
  const reject = (code: RustEffectsWorkFailure["code"], message: string): never => {
    failure ??= Object.freeze({ code, message });
    throw stopped;
  };
  const step = (cost = 1): void => {
    if (failure !== undefined) throw stopped;
    if (!Number.isSafeInteger(cost) || cost <= 0) {
      reject("RUST_ERROR_EFFECTS_WORK_INVALID", "Rust error-effect work requires finite positive integer reservations.");
    }
    if (cost > remaining) {
      reject("RUST_ERROR_EFFECTS_WORK_LIMIT", `Rust error-effect analysis exceeds its finite work budget of ${maximumSteps} steps.`);
    }
    remaining -= cost;
  };
  const metadata = (value: unknown): number => {
    const before = remaining;
    const active = new WeakSet<object>();
    const pending: ({ readonly value: unknown } | { readonly leave: object })[] = [{ value }];
    while (pending.length !== 0) {
      const current = pending.pop()!;
      if ("leave" in current) { active.delete(current.leave); continue; }
      step();
      const selected = current.value;
      if (typeof selected === "string") {
        if (selected.length !== 0) step(selected.length);
      } else if (selected !== null && typeof selected === "object") {
        if (active.has(selected)) {
          reject("RUST_ERROR_EFFECTS_WORK_INVALID", "Rust error-effect work requires acyclic data-only metadata.");
        }
        active.add(selected);
        pending.push({ leave: selected });
        for (const key of Reflect.ownKeys(selected)) {
          step();
          const descriptor = Object.getOwnPropertyDescriptor(selected, key);
          if (typeof key !== "string" || descriptor === undefined || !("value" in descriptor)) {
            return reject("RUST_ERROR_EFFECTS_WORK_INVALID", "Rust error-effect work requires acyclic data-only metadata.");
          }
          if (key.length !== 0) step(key.length);
          pending.push({ value: descriptor.value });
        }
      } else if (typeof selected === "function" || typeof selected === "symbol") {
        reject("RUST_ERROR_EFFECTS_WORK_INVALID", "Rust error-effect work requires acyclic data-only metadata.");
      }
    }
    return before - remaining;
  };
  return Object.freeze({
    step,
    metadata,
    expansion(sourceWork: number, replacementWork: number): void {
      if (failure !== undefined) throw stopped;
      if (!Number.isSafeInteger(sourceWork) || sourceWork <= 0 ||
        !Number.isSafeInteger(replacementWork) || replacementWork <= 0) {
        reject("RUST_ERROR_EFFECTS_WORK_INVALID", "Rust error-effect expansion requires finite positive work factors.");
      }
      if (sourceWork > Math.floor(remaining / replacementWork)) {
        reject("RUST_ERROR_EFFECTS_WORK_LIMIT", `Rust error-effect analysis exceeds its finite work budget of ${maximumSteps} steps.`);
      }
      step(sourceWork * replacementWork);
    },
    run(work: () => void): RustEffectsWorkFailure | undefined {
      if (failure !== undefined) return failure;
      try {
        work();
      } catch (error) {
        if (error !== stopped) throw error;
      }
      return failure;
    },
  });
}

export type RustEffectsWorkBudget = ReturnType<typeof createRustEffectsWorkBudget>;
