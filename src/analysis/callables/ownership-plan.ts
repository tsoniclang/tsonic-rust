import type { Node } from "@tsonic/tsts";
import type { SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import {
  createRustCallableOwnershipComponentQueries,
  type RustCallableOwnershipComponent, type RustCallableOwnershipComponentQueries, type RustCallableOwnershipCapture,
} from "./ownership-components.js";

export interface RustCallableActivation {
  readonly kind: "lexical" | "class";
  readonly ownerDeclaration: Node;
  readonly activationScope: Node;
  readonly components: readonly RustCallableOwnershipComponent[];
  readonly callableDeclarations: readonly Node[];
  readonly slotDeclarations: readonly Node[];
  readonly externalCaptures: readonly RustCallableOwnershipCapture[];
}

export type RustCallableStorageOwnership =
  | { readonly kind: "ordinary" }
  | { readonly kind: "frame"; readonly activation: RustCallableActivation }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustCallableOwnershipPlan extends RustCallableOwnershipComponentQueries {
  readonly activations: readonly RustCallableActivation[];
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
    get activations() { return requireCurrent().activations; },
    get issues() { return requireCurrent().issues; },
    failureReason: () => requireCurrent().failureReason(),
    componentForCallable: (declaration: Node) => requireCurrent().componentForCallable(declaration),
    componentForSlot: (declaration: Node) => requireCurrent().componentForSlot(declaration),
    isCyclicCallable: (declaration: Node) => requireCurrent().isCyclicCallable(declaration),
    isCyclicSlot: (declaration: Node) => requireCurrent().isCyclicSlot(declaration),
    isIndependentCallable: (declaration: Node) => requireCurrent().isIndependentCallable(declaration),
    instanceReceiverOwner: (receiver: Node) => requireCurrent().instanceReceiverOwner(receiver),
    storageFor: (subject: SourceStorageSubject) => requireCurrent().storageFor(subject),
  });
}

export function createRustCallableOwnershipPlan(
  storage: SourceStorageQueries,
  components: RustCallableOwnershipComponentQueries,
): RustCallableOwnershipPlan {
  const ordinary: RustCallableStorageOwnership = Object.freeze({ kind: "ordinary" });
  const unresolved = (reason: string): RustCallableStorageOwnership => Object.freeze({ kind: "unresolved", reason });
  const groups = new Map<Node, RustCallableOwnershipComponent[]>();
  for (const component of components.components) {
    const group = groups.get(component.activationScope) ?? [];
    group.push(component);
    groups.set(component.activationScope, group);
  }
  const byComponent = new Map<RustCallableOwnershipComponent, RustCallableActivation>();
  const activations = Object.freeze([...groups].map(([activationScope, group]) => {
    const first = group[0]!;
    if (group.some(component => component.kind !== first.kind || component.ownerDeclaration !== first.ownerDeclaration))
      throw new Error("One checked source activation cannot acquire conflicting physical owners.");
    const slotDeclarations = Object.freeze([...new Set(group.flatMap(component => component.slotDeclarations))]);
    const slots = new Set(slotDeclarations);
    const activation = Object.freeze({ activationScope, ownerDeclaration: first.ownerDeclaration, kind: first.kind,
      components: Object.freeze(group),
      callableDeclarations: Object.freeze([...new Set(group.flatMap(component => component.callableDeclarations))]),
      slotDeclarations,
      externalCaptures: Object.freeze(group.flatMap(component => component.externalCaptures)
        .filter(capture => !slots.has(capture.declaration))),
    });
    for (const component of group) byComponent.set(component, activation);
    return activation;
  }));
  return Object.freeze({ ...components, activations,
    storageFor(subject: SourceStorageSubject): RustCallableStorageOwnership {
      const failure = components.failureReason() ?? storage.failureReason();
      if (failure !== undefined) return unresolved(failure);
      const origins = storage.closedOriginsFor(subject);
      if (origins.kind === "unresolved") return unresolved(origins.reason);
      let selected: RustCallableActivation | undefined;
      let ordinaryOrigins = false;
      for (const origin of origins.origins) {
        const declaration = origin.subject.node;
        const component = origin.subject.kind === "value" && origin.subject.projection.length === 0
          ? components.componentForCallable(declaration) : undefined;
        if (component === undefined) {
          if (components.isCyclicCallable(declaration) || components.isCyclicSlot(declaration))
            return unresolved("A cyclic callback origin has no closed physical activation owner.");
          ordinaryOrigins = true;
        } else if (selected !== undefined && byComponent.get(component) !== selected) {
          return unresolved("Callable storage receives different physical activation families.");
        } else selected = byComponent.get(component);
      }
      if (selected === undefined) return components.isCyclicSlot(subject.node)
        ? unresolved("Cyclic callback storage has no exact contributing callback creation.") : ordinary;
      if (origins.kind !== "complete") return unresolved("An open callable storage domain cannot select one physical activation family.");
      return ordinaryOrigins ? unresolved("Callable storage mixes an owning frame with an independent callable origin.")
        : Object.freeze({ kind: "frame", activation: selected });
    },
  });
}
