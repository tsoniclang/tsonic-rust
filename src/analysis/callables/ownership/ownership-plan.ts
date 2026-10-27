import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";
import type { SourceStorageProducer, SourceStorageProducersSelection, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { createRustCallableOwnershipComponentQueries } from "./ownership-components.js";
import { type RustCallableOwnershipComponentQueries } from "../../../target-model/records/callable-ownership.js";
import type { RustCallableOwnershipComponent } from "../../../target-model/records/callable-ownership.js";

import type { RustCallableActivation } from "../../../target-model/records/callable-ownership.js";

export type RustCallableOwnershipInput =
  | { readonly kind: "storage"; readonly producers: SourceStorageProducersSelection }
  | { readonly kind: "construction"; readonly declaration: Node };

export type RustCallableOwnershipSelection =
  | { readonly kind: "ordinary" }
  | { readonly kind: "frame"; readonly activation: RustCallableActivation }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustCallableOwnershipPlan extends RustCallableOwnershipComponentQueries {
  readonly activations: readonly RustCallableActivation[];
  activationForCallable(declaration: Node): RustCallableActivation | undefined;
}

export interface RustCallableOwnershipRegistry extends RustCallableOwnershipPlan {
  initialize(input: Parameters<typeof createRustCallableOwnershipComponentQueries>[0]): RustCallableOwnershipPlan;
  seal(): RustCallableOwnershipPlan;
}

export function createRustCallableOwnershipRegistry(): RustCallableOwnershipRegistry {
  let current: RustCallableOwnershipPlan | undefined;
  const requireCurrent = (): RustCallableOwnershipPlan => {
    if (current === undefined) failTargetAnalysisInvariant("tsonic-rust", "Callable ownership must be initialized before declaration ABI selection.");
    return current;
  };
  return Object.freeze({
    initialize(input: Parameters<typeof createRustCallableOwnershipComponentQueries>[0]) {
      if (current !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Callable ownership can be initialized only once.");
      current = createRustCallableOwnershipPlan(createRustCallableOwnershipComponentQueries(input));
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
    activationForCallable: (declaration: Node) => requireCurrent().activationForCallable(declaration),
  });
}

export function createRustCallableOwnershipPlan(
  components: RustCallableOwnershipComponentQueries,
): RustCallableOwnershipPlan {
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
      failTargetAnalysisInvariant("tsonic-rust", "One checked source activation cannot acquire conflicting physical owners.", activationScope);
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
    activationForCallable(declaration: Node): RustCallableActivation | undefined {
      const component = components.componentForCallable(declaration);
      return component === undefined ? undefined : byComponent.get(component);
    },
  });
}

export function selectRustCallableOwnership(
  ownership: RustCallableOwnershipPlan,
  subject: SourceStorageSubject,
  input: RustCallableOwnershipInput,
  physicalInputs: readonly Pick<SourceStorageProducer, "subject" | "bindings">[],
): RustCallableOwnershipSelection {
  const unresolved = (reason: string): RustCallableOwnershipSelection => Object.freeze({ kind: "unresolved", reason });
  const failure = ownership.failureReason();
  if (failure !== undefined) return unresolved(failure);
  if (input.kind === "construction") {
    if (subject.kind !== "value" || subject.projection.length !== 0 || subject.node !== input.declaration)
      return unresolved("Callable construction requires its exact original, unprojected value declaration.");
    const issue = ownership.issues.find(current => current.node === input.declaration);
    if (issue !== undefined) return unresolved(issue.reason);
    const activation = ownership.activationForCallable(input.declaration);
    if (activation !== undefined) return Object.freeze({ kind: "frame", activation });
    return ownership.isCyclicCallable(input.declaration) || ownership.isCyclicSlot(input.declaration)
      ? unresolved("A cyclic callback construction has no closed physical activation owner.")
      : Object.freeze({ kind: "ordinary" });
  }
  const origins = input.producers;
  if (origins.kind === "unresolved") return unresolved(origins.reason);
  const closedInput = (origin: Pick<SourceStorageProducer, "subject" | "bindings">): boolean => physicalInputs.some(input =>
    input.subject === origin.subject && input.bindings === origin.bindings);
  if (origins.kind === "open" && (origins.boundaries.length === 0 || origins.boundaries.some(boundary =>
    boundary.kind !== "external-input" || !closedInput(boundary))))
    return unresolved("An open callable storage domain cannot select one physical activation family.");
  let selected: RustCallableActivation | undefined;
  let ordinaryOrigins = false;
  for (const origin of origins.producers) {
    const declaration = origin.subject.node;
    const activation = origin.subject.kind === "value" && origin.subject.projection.length === 0
      ? ownership.activationForCallable(declaration) : undefined;
    if (activation === undefined) {
      if (ownership.isCyclicCallable(declaration) || ownership.isCyclicSlot(declaration))
        return unresolved("A cyclic callback origin has no closed physical activation owner.");
      ordinaryOrigins = true;
    } else if (selected !== undefined && activation !== selected) {
      return unresolved("Callable storage receives different physical activation families.");
    } else selected = activation;
  }
  if (selected === undefined) return ownership.isCyclicSlot(subject.node)
    ? unresolved("Cyclic callback storage has no exact contributing callback creation.") : Object.freeze({ kind: "ordinary" });
  return ordinaryOrigins ? unresolved("Callable storage mixes an owning frame with an independent callable origin.")
    : Object.freeze({ kind: "frame", activation: selected });
}
