import type { RustPlaceRef, RustTypeRef } from "../../target-model/semantics/index.js";
import { rustFixedArrayCarrierValue } from "../../target-model/types/index.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import {
  maximumTrackedOwnershipPlaces,
  rustOwnershipPlaceComplexityDiagnostic,
} from "./complexity.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import { RustMoveComplexityError } from "./move-complexity-error.js";
import type { RustOwnershipOperationInventory } from "./operations.js";
import {
  rustPlaceKey,
  rustProjectedPlace,
  rustProjectFieldProjection,
} from "./places.js";
import { requireDenseRustOwnershipNodes } from "./source-shape.js";

export interface RustPlaceUniverse {
  readonly places: readonly RustPlaceRef[];
  readonly byKey: ReadonlyMap<string, RustPlaceRef>;
  readonly byRoot: ReadonlyMap<string, readonly RustPlaceRef[]>;
  readonly regionByRoot: ReadonlyMap<string, string>;
  readonly carrierByRoot: ReadonlyMap<string, RustTypeRef>;
  readonly completeChildrenByParent: ReadonlyMap<string, readonly string[]>;
}

export function createRustPlaceUniverse(
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  input: RustOwnershipAnalysisInput,
): RustPlaceUniverse {
  const byKey = new Map<string, RustPlaceRef>();
  const carrierByRoot = new Map<string, RustTypeRef>();
  const regionByRoot = new Map<string, string>();
  let placeBudgetExceeded = false;
  const add = (place: RustPlaceRef, carrier?: RustTypeRef): void => {
    const key = rustPlaceKey(place);
    if (!byKey.has(key)) {
      if (byKey.size >= maximumTrackedOwnershipPlaces) {
        placeBudgetExceeded = true;
        return;
      }
      byKey.set(key, place);
    }
    if (carrier !== undefined && place.projections.length === 0 &&
      !carrierByRoot.has(place.rootId)) carrierByRoot.set(place.rootId, carrier);
  };
  for (const node of inventory.nodes) {
    const place = inventory.places.get(node);
    if (place !== undefined) {
      add(place, input.facts.getRuntimeCarrierFact(node)?.carrier ??
        input.facts.getRuntimeCarrierFact(
          input.navigation.sourceReferenceFor(node)?.declaration,
        )?.carrier);
      const region = inventory.regionByNode.get(node)?.id;
      if (region !== undefined && !regionByRoot.has(place.rootId)) {
        regionByRoot.set(place.rootId, region);
      }
    }
  }
  for (const record of operations.records) add(record.operation.place, record.carrier);
  const observedPlaces = Object.freeze([...byKey.values()]);
  const expandableParents = new Set<string>();
  for (const place of observedPlaces) {
    for (let length = 0; length < place.projections.length; length += 1) {
      expandableParents.add(rustPlaceKey(Object.freeze({
        rootId: place.rootId,
        projections: Object.freeze(place.projections.slice(0, length)),
      })));
    }
  }
  const completeChildrenByParent = new Map<string, readonly string[]>();
  const pending: { readonly place: RustPlaceRef; readonly carrier: RustTypeRef }[] = [];
  for (const [rootId, carrier] of carrierByRoot) {
    const root = byKey.get(rootId);
    if (root !== undefined) pending.push({ place: root, carrier });
  }
  const expanded = new Set<string>();
  while (pending.length > 0 && !placeBudgetExceeded) {
    const { place, carrier } = pending.pop()!;
    const parentKey = rustPlaceKey(place);
    if (expanded.has(parentKey) || !expandableParents.has(parentKey)) continue;
    expanded.add(parentKey);
    const childrenResult = completeAggregateChildren(
      place,
      carrier,
      input,
      maximumTrackedOwnershipPlaces - byKey.size,
    );
    if (childrenResult.kind === "budget-exceeded") {
      placeBudgetExceeded = true;
      break;
    }
    if (childrenResult.kind === "not-aggregate" || childrenResult.children.length === 0) {
      continue;
    }
    const childKeys = childrenResult.children.map(({ place: child, carrier: childCarrier }) => {
      add(child, childCarrier);
      const childKey = rustPlaceKey(child);
      if (expandableParents.has(childKey)) {
        pending.push({ place: child, carrier: childCarrier });
      }
      return childKey;
    });
    completeChildrenByParent.set(parentKey, Object.freeze(childKeys));
  }
  if (placeBudgetExceeded) {
    const diagnostic = rustOwnershipPlaceComplexityDiagnostic(byKey.size + 1);
    if (diagnostic !== undefined) throw new RustMoveComplexityError(diagnostic);
  }
  const byRoot = new Map<string, RustPlaceRef[]>();
  for (const place of byKey.values()) {
    const selected = byRoot.get(place.rootId) ?? [];
    selected.push(place);
    byRoot.set(place.rootId, selected);
  }
  return Object.freeze({
    places: Object.freeze([...byKey.values()]),
    byKey,
    byRoot: new Map([...byRoot].map(([root, places]) => [root, Object.freeze(places)])),
    regionByRoot,
    carrierByRoot,
    completeChildrenByParent,
  });
}

function completeAggregateChildren(
  parent: RustPlaceRef,
  carrier: RustTypeRef,
  input: RustOwnershipAnalysisInput,
  maximumChildren: number,
):
  | {
      readonly kind: "complete";
      readonly children: readonly {
        readonly place: RustPlaceRef;
        readonly carrier: RustTypeRef;
      }[];
    }
  | { readonly kind: "not-aggregate" }
  | { readonly kind: "budget-exceeded" } {
  const definition = input.projectTypes.definitionForCarrier(carrier);
  if (definition !== undefined) {
    const fields = requireDenseRustOwnershipNodes(
      input.ast.members(definition.declaration),
      "Project declaration contains an undefined member slot during move analysis.",
      definition.declaration,
    ).filter((member) =>
      !input.ast.hasModifierKind(member, "static") &&
      input.ast.kindName(member) === "KindPropertyDeclaration");
    if (fields.length > maximumChildren) return { kind: "budget-exceeded" };
    const children = fields.map((member) => {
      const declared = input.facts.getRuntimeCarrierFact(member)?.carrier;
      const fieldCarrier = declared === undefined
        ? undefined
        : input.projectTypes.instantiateMemberCarrier(member, carrier, declared);
      return fieldCarrier === undefined
        ? undefined
        : Object.freeze({
            place: rustProjectedPlace(
              parent,
              rustProjectFieldProjection(
                member,
                input.ast,
                `field:${requireRustOwnershipSourceIdentity(input.ast, member)}`,
              ),
            ),
            carrier: fieldCarrier,
          });
    });
    return children.some((child) => child === undefined)
      ? { kind: "not-aggregate" }
      : {
          kind: "complete",
          children: Object.freeze(children as readonly {
            readonly place: RustPlaceRef;
            readonly carrier: RustTypeRef;
          }[]),
        };
  }
  if (carrier.kind === "tuple") {
    return carrier.elements.length > maximumChildren
      ? { kind: "budget-exceeded" }
      : {
          kind: "complete",
          children: Object.freeze(carrier.elements.map((element, index) => Object.freeze({
            place: rustProjectedPlace(
              parent,
              Object.freeze({ kind: "tuple-field" as const, index }),
            ),
            carrier: element,
          }))),
        };
  }
  const fixed = rustFixedArrayCarrierValue(carrier);
  return fixed === undefined
    ? { kind: "not-aggregate" }
    : fixed.length > maximumChildren
      ? { kind: "budget-exceeded" }
      : {
          kind: "complete",
          children: Object.freeze(Array.from(
            { length: fixed.length },
            (_unused, index) => Object.freeze({
              place: rustProjectedPlace(
                parent,
                Object.freeze({ kind: "fixed-index" as const, index }),
              ),
              carrier: fixed.element,
            }),
          )),
        };
}
