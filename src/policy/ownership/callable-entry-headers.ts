import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { snapshotTargetReadonlyMap } from "@tsonic/target-api/analysis";
import type { RustCallableEntryHeaderSelection } from "../../target-model/records/callable-entry-headers.js";
import type { RustNativeCallableGenericHeader } from "../../target-model/records/native-generics.js";
import type { RustDeclarationGenericRequirementContract } from "../../target-model/records/generic-requirements.js";
import type { RustSourceGenericParameterContract } from "../../target-model/lifetimes/model.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustCapturedLifetimeSubstitutions } from "../../target-model/names/captured-lifetimes.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";

export function selectRustCallableEntryHeader(input: {
  readonly header: RustNativeCallableGenericHeader;
  readonly requirements: RustDeclarationGenericRequirementContract | undefined;
  readonly inherited: RustTargetGenericBindings;
  readonly ownerLifetimes: ReadonlySet<string>;
  readonly capturedParameters: readonly RustSourceGenericParameterContract[];
  readonly specialization: ReadonlyMap<string, TargetTypeRef> | undefined;
  readonly promiseBody: boolean;
  readonly enclosingArguments: readonly RustTargetGenericArgument[];
  readonly trailingArguments: readonly RustTargetGenericArgument[];
  readonly finalArguments: readonly RustTargetGenericArgument[] | undefined;
}): RustCallableEntryHeaderSelection {
  const { header, specialization } = input;
  const { sourceContract } = header;
  const declaration = sourceContract.declaration;
  if (sourceContract.lifetimeBinder !== undefined)
    failTargetAnalysisInvariant("tsonic-rust", "An admitted item generic contract cannot retain a higher-ranked binder.", declaration);
  const ordinary = sourceContract.parameters.filter(parameter => parameter.kind === "type");
  const sourceTypeParameterIdentities = Object.freeze(ordinary.map(parameter => parameter.identity));
  if (specialization !== undefined && (specialization.size !== ordinary.length ||
    ordinary.some(parameter => !specialization.has(parameter.identity))))
    failTargetAnalysisInvariant("tsonic-rust",
      "An admitted callable specialization requires exact ordinary source type parameter coverage.", declaration);
  const captures = [...input.capturedParameters, ...header.implicitLifetimes];
  const hasSourceHeader = sourceContract.parameters.length !== 0 || captures.length !== 0;
  if (hasSourceHeader && (input.requirements === undefined ||
    input.requirements.typeParameters.length !== ordinary.length ||
    input.requirements.typeParameters.some((parameter, index) => parameter.identity !== ordinary[index]?.identity)))
    failTargetAnalysisInvariant("tsonic-rust",
      "An admitted callable requires its exact completed native type-requirement contract.", declaration);
  const selectedCaptures = captures.filter(parameter => parameter.kind === "type"
    ? !input.inherited.types.has(parameter.identity) : !input.ownerLifetimes.has(rustLifetimeKey(parameter.lifetime)));
  const types = new Map(input.inherited.types);
  const lifetimes = new Map(input.inherited.lifetimes);
  const names = new Map(ordinary.map(parameter => [parameter.identity, parameter.targetName]));
  const usedNames = new Set(ordinary.map(parameter => parameter.targetName));
  if (hasSourceHeader) {
    for (const parameter of sourceContract.parameters)
      if (parameter.kind === "lifetime") lifetimes.delete(rustLifetimeKey(parameter.lifetime));
    for (const parameter of selectedCaptures)
      if (parameter.kind === "type") names.set(parameter.identity, allocateRustGeneratedName(usedNames, parameter.targetName));
    for (const [identity, lifetime] of rustCapturedLifetimeSubstitutions(sourceContract.parameters, selectedCaptures))
      lifetimes.set(identity, lifetime);
    for (const [identity, carrier] of specialization ?? []) types.set(identity, carrier);
  }
  const parameters = Object.freeze((hasSourceHeader ? [...sourceContract.parameters, ...selectedCaptures] : [])
    .flatMap((parameter): readonly RustSourceGenericParameterContract[] => {
      if (parameter.kind === "type" && specialization?.has(parameter.identity) === true) return [];
      const outlives = Object.freeze(parameter.outlives.map(lifetime => lifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime));
      if (parameter.kind === "type") return [Object.freeze({ ...parameter, outlives })];
      const lifetime = lifetimes.get(rustLifetimeKey(parameter.lifetime)) ?? parameter.lifetime;
      if (lifetime.kind !== "parameter") failTargetAnalysisInvariant("tsonic-rust",
        "An admitted callable lifetime substitution requires its exact native binder.", declaration);
      return [Object.freeze({ ...parameter, lifetime, outlives })];
    }));
  const ordered = Object.freeze([...parameters.filter(parameter => parameter.kind === "lifetime" && parameter.lifetime.kind === "parameter"),
    ...parameters.filter(parameter => parameter.kind === "type")]);
  const optionalStorage = Object.freeze(hasSourceHeader && specialization === undefined
    ? input.requirements!.optionalStorage.filter(requirement => !requirement.captured) : []);
  const nativeBinders = new Set(header.inputs.filter(selected => !types.has(selected.implementation.identity))
    .map(selected => selected.implementation.identity));
  const arguments_: RustTargetGenericArgument[] = ordered.map(parameter => parameter.kind === "lifetime"
    ? Object.freeze({ kind: "lifetime", lifetime: parameter.lifetime })
    : Object.freeze({ kind: "type", type: Object.freeze({ kind: "type-parameter", identity: parameter.identity, name: parameter.targetName }) }));
  arguments_.push(...optionalStorage.map(requirement => Object.freeze({ kind: "type" as const, type: requirement.carrier })),
    ...header.inputs.filter(selected => nativeBinders.has(selected.implementation.identity))
      .map(selected => Object.freeze({ kind: "type" as const, type: selected.implementation })));
  return Object.freeze({ declaration, promiseBody: input.promiseBody, sourceTypeParameterIdentities,
    parameters: ordered, optionalStorage, nativeBinders: snapshotTargetReadonlyMap([...nativeBinders].map(identity => [identity, true] as const)),
    bindings: Object.freeze({ types: snapshotTargetReadonlyMap(types), lifetimes: snapshotTargetReadonlyMap(lifetimes),
      consts: snapshotTargetReadonlyMap(input.inherited.consts) }),
    specialization: specialization === undefined ? undefined : snapshotTargetReadonlyMap(specialization),
    typeNames: snapshotTargetReadonlyMap(names),
    preservesExplicitLifetimes: hasSourceHeader && [...sourceContract.parameters, ...selectedCaptures].some(parameter => parameter.kind === "lifetime"),
    preservesSourceRequirements: hasSourceHeader,
    captureArguments: Object.freeze([...input.enclosingArguments, ...(input.finalArguments ?? arguments_), ...input.trailingArguments]) });
}
