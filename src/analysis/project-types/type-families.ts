import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type {
  RustSourceTypeFamily,
  RustSourceTypeFamilyImplementation,
  RustSourceTypeFamilyRegistry,
} from "../../target-model/types/type-families.js";
import type { RustTargetGenericArgument, RustTargetTraitRef, TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";
import { inferRustTargetTypeParameterBindings, rustTargetTypePatternsAreNominallyDisjoint } from "../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { rustNamedTypeCarrierValue, rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import { rustTypeFamilyNormalizer } from "../../policy/types/type-family-normalization.js";
import { rustIndexedFieldTrait } from "../../target-model/types/carriers/indexed-fields.js";

interface ImplementationBucket {
  readonly closed: Map<string, RustSourceTypeFamilyImplementation>;
  readonly templates: Map<string, RustSourceTypeFamilyImplementation>;
}

export function createRustSourceTypeFamilyRegistry(): RustSourceTypeFamilyRegistry {
  const families = new Map<string, RustSourceTypeFamily>();
  const implementations = new Map<string, RustSourceTypeFamilyImplementation>();
  const buckets = new Map<string, ImplementationBucket>();
  const fieldKeys = new Map<string, string>();
  let sealed = false;
  const assertWritable = (): void => {
    if (sealed) throw new Error("Rust source type families are already sealed.");
  };
  const key = (trait: RustTargetTraitRef, owner: TargetTypeRef): string =>
    closedMetadataKey({ trait, owner });
  const selectedTrait = (implementation: RustSourceTypeFamilyImplementation): RustTargetTraitRef =>
    ({ ...implementation.family.trait, genericArguments: implementation.arguments });
  const bucketKey = (trait: RustTargetTraitRef, owner: TargetTypeRef): string => {
    const source = rustSourceTypeCarrierValue(owner);
    const named = rustNamedTypeCarrierValue(owner);
    const constructor = source === undefined
      ? named === undefined ? owner.kind === "target-named" ? owner.id : owner.kind : named.path
      : [source.fileName, source.typeName];
    return closedMetadataKey({ trait, constructor });
  };
  const instantiate = (template: RustSourceTypeFamilyImplementation, owner: TargetTypeRef): RustSourceTypeFamilyImplementation | undefined => {
    const bindings = inferRustTargetTypeParameterBindings(template.owner, owner,
      new Set(rustTargetTypeParameterNames(template.owner)));
    return bindings === undefined ? undefined : Object.freeze({ ...template, owner,
      output: substituteRustTargetTypeParameters(template.output, bindings) });
  };
  const implementation = (trait: RustTargetTraitRef, owner: TargetTypeRef): RustSourceTypeFamilyImplementation | undefined => {
    const exact = implementations.get(key(trait, owner));
    if (exact !== undefined) return exact;
    for (const candidate of buckets.get(bucketKey(trait, owner))?.templates.values() ?? []) {
      const selected = instantiate(candidate, owner);
      if (selected !== undefined) return selected;
    }
    return undefined;
  };
  const equivalent = (left: RustSourceTypeFamilyImplementation, right: RustSourceTypeFamilyImplementation): boolean =>
    left.sourceFileName === right.sourceFileName &&
    closedMetadataKey(left.field ?? null) === closedMetadataKey(right.field ?? null) &&
    rustTargetTypeRefEquals(left.output, right.output);
  return Object.freeze({
    registerFieldKey(identity: string, name: string) {
      assertWritable();
      if (!/^[0-9a-f]{32}$/u.test(identity)) return false;
      const existing = fieldKeys.get(identity);
      if (existing !== undefined) return existing === name;
      fieldKeys.set(identity, name);
      return true;
    },
    register(family: RustSourceTypeFamily) {
      assertWritable();
      if (!isRustTargetTypeRef(family.trait) ||
        (family.kind === "conditional" ? family.trait.sourceItem === undefined :
          family.kind !== "indexed" || !rustTargetTypeRefEquals(family.trait, rustIndexedFieldTrait))) return false;
      const existing = families.get(family.trait.id);
      if (existing !== undefined) {
        return existing.kind === family.kind && (existing.kind !== "conditional" ||
          family.kind === "conditional" && existing.declaration === family.declaration && existing.parameter === family.parameter) &&
          rustTargetTypeRefEquals(existing.trait, family.trait);
      }
      families.set(family.trait.id, Object.freeze({ ...family, trait: snapshotClosedMetadata(family.trait) }));
      return true;
    },
    get(identity: string) { return families.get(identity); },
    families() { return Object.freeze([...families.values()]); },
    registerImplementation(implementation: RustSourceTypeFamilyImplementation) {
      assertWritable();
      const family = families.get(implementation.family.trait.id);
      if (family === undefined || !isRustTargetTypeRef(implementation.owner) || !isRustTargetTypeRef(implementation.output) ||
        implementation.sourceFileName.length === 0 || implementation.family.kind !== family.kind ||
        family.kind === "conditional" && (implementation.family.kind !== "conditional" ||
          implementation.family.declaration !== family.declaration || implementation.family.parameter !== family.parameter) ||
        !rustTargetTypeRefEquals(implementation.family.trait, family.trait) || implementation.owner.kind === "type-parameter") return false;
      if (!validArguments(family, implementation.arguments)) return false;
      if (family.kind === "indexed" ? implementation.field === undefined ||
        !Number.isSafeInteger(implementation.field.storageIndex) || implementation.field.storageIndex < 0 ||
        typeof implementation.field.readonly !== "boolean" ||
        typeof implementation.field.sharedWrite !== "boolean" ||
        implementation.field.readonly && implementation.field.sharedWrite ||
        !["project-object", "structural-object"].includes(implementation.field.storage) ||
        Object.keys(implementation.field).sort().join(",") !== "readonly,sharedWrite,storage,storageIndex" :
        implementation.field !== undefined) return false;
      const trait = selectedTrait(implementation);
      const parameterNames = new Set(rustTargetTypeParameterNames(implementation.owner));
      if (!rustTargetTypeParameterNames(implementation.output).every(name => parameterNames.has(name))) return false;
      const identity = key(trait, implementation.owner);
      const existing = implementations.get(identity);
      if (existing !== undefined) {
        return equivalent(existing, implementation);
      }
      const constructor = bucketKey(trait, implementation.owner);
      const bucket: ImplementationBucket = buckets.get(constructor) ?? { closed: new Map(), templates: new Map() };
      const covered: string[] = [];
      for (const [candidateIdentity, candidate] of bucket.templates) {
        const selected = instantiate(candidate, implementation.owner);
        if (selected !== undefined) return equivalent(selected, implementation);
        const generalized = parameterNames.size > 0 ? instantiate(implementation, candidate.owner) : undefined;
        if (generalized !== undefined) {
          if (!equivalent(generalized, candidate)) return false;
          covered.push(candidateIdentity);
        } else if (!rustTargetTypePatternsAreNominallyDisjoint(implementation.owner, candidate.owner)) return false;
      }
      if (parameterNames.size > 0) {
        for (const [candidateIdentity, candidate] of bucket.closed) {
          const generalized = instantiate(implementation, candidate.owner);
          if (generalized !== undefined) {
            if (!equivalent(generalized, candidate)) return false;
            covered.push(candidateIdentity);
          } else if (!rustTargetTypePatternsAreNominallyDisjoint(implementation.owner, candidate.owner)) return false;
        }
      }
      const snapshot = Object.freeze({ ...implementation, family,
        ...(implementation.field === undefined ? {} : { field: snapshotClosedMetadata(implementation.field) }),
        arguments: snapshotClosedMetadata(implementation.arguments),
        owner: snapshotClosedMetadata(implementation.owner), output: snapshotClosedMetadata(implementation.output) });
      for (const identity of covered) {
        implementations.delete(identity);
        bucket.closed.delete(identity);
        bucket.templates.delete(identity);
      }
      (parameterNames.size > 0 ? bucket.templates : bucket.closed).set(identity, snapshot);
      buckets.set(constructor, bucket);
      implementations.set(identity, snapshot);
      return true;
    },
    implementation,
    implementations() { return Object.freeze([...implementations.values()]); },
    seal() {
      sealed = true;
      return Object.freeze({
        families: Object.freeze([...families.values()]),
        implementations: Object.freeze([...implementations.values()]),
        normalize: rustTypeFamilyNormalizer({ implementation }),
      });
    },
  });
}

function validArguments(family: RustSourceTypeFamily, arguments_: readonly RustTargetGenericArgument[]): boolean {
  if (!Array.isArray(arguments_)) return false;
  const trait = { ...family.trait, genericArguments: arguments_ };
  return isRustTargetTypeRef(trait) && rustTargetTypeParameterNames(trait).length === 0 &&
    (family.kind === "conditional" ? arguments_.length === 0 :
      arguments_.length === 1 && arguments_[0]?.kind === "type");
}
