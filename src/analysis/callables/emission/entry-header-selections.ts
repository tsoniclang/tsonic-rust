import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { snapshotTargetReadonlyMap } from "@tsonic/target-api/analysis";
import type { RustCallableEntryHeaderFacets, RustCallableEntryHeaderPlacement, RustCallableEntryHeaderSelections, RustCallableEntryHeaderSelection,
  RustCallableEntryHeaderVariant } from "../../../target-model/records/callables/callable-entry-headers.js";
import type { RustNativeCallableGenericHeader } from "../../../target-model/records/native/native-generics.js";
import type { RustDeclarationGenericRequirementIndex } from "../../declarations/generic-requirements.js";
import { selectRustCallableEntryHeader } from "../../../policy/ownership/callable-entry-headers.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustLifetimesEqual } from "../../../target-model/lifetimes/index.js";

export type RustCallableEntryHeaderInput = Omit<Parameters<typeof selectRustCallableEntryHeader>[0],
  "header" | "requirements" | "promiseBody"> & { readonly splitBody: boolean };

export function createRustCallableEntryHeaderSelections(input: {
  readonly headers: ReadonlyMap<Node, RustNativeCallableGenericHeader>;
  readonly requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">;
}) {
  const declarations = new Map<Node, Map<RustCallableEntryHeaderSelection | undefined, Map<RustCallableEntryHeaderPlacement,
    Map<RustCallableEntryHeaderVariant | undefined, { readonly input: RustCallableEntryHeaderInput;
      readonly selected: RustCallableEntryHeaderFacets }>>>>();
  const readers = new Map<Node, RustCallableEntryHeaderSelections>();
  let sealed = false;
  const readerFor = (declaration: Node): RustCallableEntryHeaderSelections => {
    const existing = readers.get(declaration);
    if (existing !== undefined) return existing;
    const reader = Object.freeze({ get: (placement: RustCallableEntryHeaderPlacement,
      variant: RustCallableEntryHeaderVariant | undefined, parent: RustCallableEntryHeaderSelection | undefined) =>
      declarations.get(declaration)?.get(parent)?.get(placement)?.get(variant)?.selected });
    readers.set(declaration, reader);
    return reader;
  };
  return Object.freeze({ readerFor,
    select(declaration: Node, placement: RustCallableEntryHeaderPlacement, variant: RustCallableEntryHeaderVariant | undefined,
      parent: RustCallableEntryHeaderSelection | undefined, request: RustCallableEntryHeaderInput): RustCallableEntryHeaderFacets {
      const parents = declarations.get(declaration) ?? new Map<RustCallableEntryHeaderSelection | undefined,
        Map<RustCallableEntryHeaderPlacement, Map<RustCallableEntryHeaderVariant | undefined,
          { readonly input: RustCallableEntryHeaderInput; readonly selected: RustCallableEntryHeaderFacets }>>>();
      const placements = parents.get(parent) ?? new Map<RustCallableEntryHeaderPlacement,
        Map<RustCallableEntryHeaderVariant | undefined, { readonly input: RustCallableEntryHeaderInput;
          readonly selected: RustCallableEntryHeaderFacets }>>();
      const variants = placements.get(placement) ?? new Map<RustCallableEntryHeaderVariant | undefined,
        { readonly input: RustCallableEntryHeaderInput; readonly selected: RustCallableEntryHeaderFacets }>();
      const existing = variants.get(variant);
      if (existing !== undefined) {
        const sameTypes = existing.input.inherited.types.size === request.inherited.types.size &&
          [...existing.input.inherited.types].every(([identity, carrier]) => rustTargetTypeRefEquals(carrier, request.inherited.types.get(identity)));
        const sameLifetimes = existing.input.inherited.lifetimes.size === request.inherited.lifetimes.size &&
          [...existing.input.inherited.lifetimes].every(([identity, lifetime]) => rustLifetimesEqual(lifetime, request.inherited.lifetimes.get(identity)));
        const sameConsts = existing.input.inherited.consts.size === request.inherited.consts.size &&
          [...existing.input.inherited.consts].every(([identity, value]) => closedMetadataEquals(value, request.inherited.consts.get(identity)));
        const sameSpecialization = existing.input.specialization === undefined ? request.specialization === undefined
          : request.specialization !== undefined && existing.input.specialization.size === request.specialization.size &&
            [...existing.input.specialization].every(([identity, carrier]) => rustTargetTypeRefEquals(carrier, request.specialization?.get(identity)));
        if (!sameTypes || !sameLifetimes || !sameConsts ||
          existing.input.splitBody !== request.splitBody || existing.input.ownerLifetimes.size !== request.ownerLifetimes.size ||
          [...existing.input.ownerLifetimes].some(identity => !request.ownerLifetimes.has(identity)) ||
          existing.input.capturedParameters.length !== request.capturedParameters.length ||
          existing.input.capturedParameters.some((parameter, index) => parameter !== request.capturedParameters[index]) ||
          !sameSpecialization ||
          !closedMetadataEquals(existing.input.enclosingArguments, request.enclosingArguments) ||
          !closedMetadataEquals(existing.input.trailingArguments, request.trailingArguments) ||
          !closedMetadataEquals(existing.input.finalArguments, request.finalArguments))
          failTargetAnalysisInvariant("tsonic-rust", "One exact native entry placement requires one original header binding domain.", declaration);
        return existing.selected;
      }
      if (sealed) failTargetAnalysisInvariant("tsonic-rust", "A sealed native entry cannot select another contextual generic header.", declaration);
      const header = input.headers.get(declaration);
      if (header === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native entry header requires its completed original generic inputs.", declaration);
      const owned: RustCallableEntryHeaderInput = Object.freeze({ ...request,
        inherited: Object.freeze({ types: snapshotTargetReadonlyMap(request.inherited.types),
          lifetimes: snapshotTargetReadonlyMap(request.inherited.lifetimes), consts: snapshotTargetReadonlyMap(request.inherited.consts) }),
        ownerLifetimes: new Set(request.ownerLifetimes),
        capturedParameters: Object.freeze([...request.capturedParameters]),
        specialization: request.specialization === undefined ? undefined : snapshotTargetReadonlyMap(request.specialization),
        enclosingArguments: Object.freeze([...request.enclosingArguments]),
        trailingArguments: Object.freeze([...request.trailingArguments]),
        finalArguments: request.finalArguments === undefined ? undefined : Object.freeze([...request.finalArguments]),
      });
      const source = selectRustCallableEntryHeader({ ...owned, header,
        requirements: input.requirements.contractFor(declaration), promiseBody: false });
      const body = owned.splitBody ? selectRustCallableEntryHeader({ ...owned, header,
        requirements: input.requirements.contractFor(declaration, true), promiseBody: true }) : source;
      const selected = Object.freeze({ source, body });
      variants.set(variant, Object.freeze({ input: owned, selected }));
      placements.set(placement, variants);
      parents.set(parent, placements);
      declarations.set(declaration, parents);
      return selected;
    },
    seal() { sealed = true; },
  });
}
