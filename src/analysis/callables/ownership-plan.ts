import type { SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import {
  createRustCallableOwnershipComponentQueries,
  type RustCallableOwnershipComponent, type RustCallableOwnershipComponentQueries,
} from "./ownership-components.js";

export type RustCallableStorageOwnership =
  | { readonly kind: "ordinary" }
  | { readonly kind: "frame"; readonly component: RustCallableOwnershipComponent }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustCallableOwnershipPlan extends RustCallableOwnershipComponentQueries {
  storageFor(subject: SourceStorageSubject): RustCallableStorageOwnership;
}

export interface RustCallableOwnershipRegistry extends RustCallableOwnershipPlan {
  initialize(input: Parameters<typeof createRustCallableOwnershipComponentQueries>[0]): RustCallableOwnershipPlan;
  seal(): RustCallableOwnershipPlan;
}

export function createRustCallableOwnershipRegistry(): RustCallableOwnershipRegistry {
  let current: RustCallableOwnershipPlan | undefined;
  const requireCurrent = (): RustCallableOwnershipPlan => {
    if (current === undefined) throw new Error("Callable ownership must be sealed before declaration ABI selection.");
    return current;
  };
  return Object.freeze({
    initialize(input: Parameters<typeof createRustCallableOwnershipComponentQueries>[0]) {
      if (current !== undefined) throw new Error("Callable ownership can be initialized only once.");
      current = createRustCallableOwnershipPlan(input.storage, createRustCallableOwnershipComponentQueries(input));
      return current;
    },
    seal: requireCurrent,
    get components() { return requireCurrent().components; },
    get issues() { return requireCurrent().issues; },
    failureReason: () => requireCurrent().failureReason(),
    componentForCallable: (declaration: Node) => requireCurrent().componentForCallable(declaration),
    componentForSlot: (declaration: Node) => requireCurrent().componentForSlot(declaration),
    isCyclicCallable: (declaration: Node) => requireCurrent().isCyclicCallable(declaration),
    isCyclicSlot: (declaration: Node) => requireCurrent().isCyclicSlot(declaration),
    storageFor: (subject: SourceStorageSubject) => requireCurrent().storageFor(subject),
  });
}

export function createRustCallableOwnershipPlan(
  storage: SourceStorageQueries,
  components: RustCallableOwnershipComponentQueries,
): RustCallableOwnershipPlan {
  const ordinary: RustCallableStorageOwnership = Object.freeze({ kind: "ordinary" });
  const unresolved = (reason: string): RustCallableStorageOwnership => Object.freeze({ kind: "unresolved", reason });
  return Object.freeze({ ...components,
    storageFor(subject: SourceStorageSubject): RustCallableStorageOwnership {
      const failure = components.failureReason() ?? storage.failureReason();
      if (failure !== undefined) return unresolved(failure);
      const origins = storage.originsFor(subject);
      if (origins.kind === "unresolved") return unresolved(origins.reason);
      let selected: RustCallableOwnershipComponent | undefined;
      let ordinaryOrigins = false;
      for (const origin of origins.origins) {
        const declaration = origin.subject.node;
        const component = origin.subject.kind === "value" && origin.subject.projection.length === 0
          ? components.componentForCallable(declaration) : undefined;
        if (component === undefined) {
          if (components.isCyclicCallable(declaration) || components.isCyclicSlot(declaration))
            return unresolved("A cyclic callback origin has no closed physical activation owner.");
          ordinaryOrigins = true;
        } else if (selected !== undefined && component !== selected) {
          return unresolved("Callable storage receives different physical activation families.");
        } else selected = component;
      }
      if (selected === undefined) return components.isCyclicSlot(subject.node)
        ? unresolved("Cyclic callback storage has no exact contributing callback creation.") : ordinary;
      return ordinaryOrigins ? unresolved("Callable storage mixes an owning frame with an independent callable origin.")
        : Object.freeze({ kind: "frame", component: selected });
    },
  });
}
