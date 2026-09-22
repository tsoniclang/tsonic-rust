import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type {
  RustSourceTypeFamily,
  RustSourceTypeFamilyImplementation,
  RustSourceTypeFamilyRegistry,
} from "../../target-model/types/type-families.js";
import type { RustTargetGenericArgument, RustTargetTraitRef, TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";
import { inferRustTargetTypeParameterBindings } from "../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { rustNamedTypeCarrierValue, rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import { rustTypeFamilyNormalizer } from "../../policy/types/type-family-normalization.js";
import { rustIndexedFieldTrait } from "../../target-model/types/carriers/indexed-fields.js";

interface ImplementationBucket {
  readonly closed: Map<string, RustSourceTypeFamilyImplementation>;
  template?: RustSourceTypeFamilyImplementation;
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
    const template = buckets.get(bucketKey(trait, owner))?.template;
    return template === undefined ? undefined : instantiate(template, owner);
  };
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
        return closedMetadataKey(existing.field ?? null) === closedMetadataKey(implementation.field ?? null) &&
          existing.sourceFileName === implementation.sourceFileName &&
          rustTargetTypeRefEquals(existing.output, implementation.output);
      }
      const constructor = bucketKey(trait, implementation.owner);
      const bucket: ImplementationBucket = buckets.get(constructor) ?? { closed: new Map() };
      if (bucket.template !== undefined) {
        const selected = instantiate(bucket.template, implementation.owner);
        return selected !== undefined && selected.sourceFileName === implementation.sourceFileName &&
          closedMetadataKey(selected.field ?? null) === closedMetadataKey(implementation.field ?? null) &&
          rustTargetTypeRefEquals(selected.output, implementation.output);
      }
      if (parameterNames.size > 0) {
        for (const concrete of bucket.closed.values()) {
          const selected = instantiate(implementation, concrete.owner);
          if (selected === undefined || selected.sourceFileName !== concrete.sourceFileName ||
            closedMetadataKey(selected.field ?? null) !== closedMetadataKey(concrete.field ?? null) ||
            !rustTargetTypeRefEquals(selected.output, concrete.output)) return false;
        }
      }
      const snapshot = Object.freeze({ ...implementation, family,
        ...(implementation.field === undefined ? {} : { field: snapshotClosedMetadata(implementation.field) }),
        arguments: snapshotClosedMetadata(implementation.arguments),
        owner: snapshotClosedMetadata(implementation.owner), output: snapshotClosedMetadata(implementation.output) });
      if (parameterNames.size > 0) {
        for (const identity of bucket.closed.keys()) implementations.delete(identity);
        bucket.closed.clear();
        bucket.template = snapshot;
      } else {
        bucket.closed.set(identity, snapshot);
      }
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
