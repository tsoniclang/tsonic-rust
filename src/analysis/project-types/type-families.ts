import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type {
  RustSourceTypeFamily,
  RustSourceTypeFamilyImplementation,
  RustSourceTypeFamilyRegistry,
} from "../../policy/types/type-families.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";
import { inferRustTargetTypeParameterBindings } from "../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { rustNamedTypeCarrierValue, rustSourceTypeCarrierValue } from "../../target-model/types/index.js";

interface ImplementationBucket {
  readonly closed: Map<string, RustSourceTypeFamilyImplementation>;
  template?: RustSourceTypeFamilyImplementation;
}

export function createRustSourceTypeFamilyRegistry(): RustSourceTypeFamilyRegistry {
  const families = new Map<string, RustSourceTypeFamily>();
  const implementations = new Map<string, RustSourceTypeFamilyImplementation>();
  const buckets = new Map<string, ImplementationBucket>();
  let sealed = false;
  const assertWritable = (): void => {
    if (sealed) throw new Error("Rust source type families are already sealed.");
  };
  const key = (identity: string, owner: TargetTypeRef): string =>
    closedMetadataKey({ identity, owner });
  const bucketKey = (identity: string, owner: TargetTypeRef): string => {
    const source = rustSourceTypeCarrierValue(owner);
    const named = rustNamedTypeCarrierValue(owner);
    const constructor = source === undefined
      ? named === undefined ? owner.kind === "target-named" ? owner.id : owner.kind : named.path
      : [source.fileName, source.typeName];
    return closedMetadataKey({ identity, constructor });
  };
  const instantiate = (template: RustSourceTypeFamilyImplementation, owner: TargetTypeRef): RustSourceTypeFamilyImplementation | undefined => {
    const bindings = inferRustTargetTypeParameterBindings(template.owner, owner,
      new Set(rustTargetTypeParameterNames(template.owner)));
    return bindings === undefined ? undefined : Object.freeze({ ...template, owner,
      output: substituteRustTargetTypeParameters(template.output, bindings) });
  };
  return Object.freeze({
    register(family: RustSourceTypeFamily) {
      assertWritable();
      if (!isRustTargetTypeRef(family.trait) || family.trait.sourceItem === undefined) return false;
      const existing = families.get(family.trait.id);
      if (existing !== undefined) {
        return existing.declaration === family.declaration && existing.parameter === family.parameter &&
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
        implementation.sourceFileName.length === 0 || implementation.family.declaration !== family.declaration ||
        !rustTargetTypeRefEquals(implementation.family.trait, family.trait) || implementation.owner.kind === "type-parameter") return false;
      const parameterNames = new Set(rustTargetTypeParameterNames(implementation.owner));
      if (!rustTargetTypeParameterNames(implementation.output).every(name => parameterNames.has(name))) return false;
      const identity = key(implementation.family.trait.id, implementation.owner);
      const existing = implementations.get(identity);
      if (existing !== undefined) {
        return existing.sourceFileName === implementation.sourceFileName &&
          rustTargetTypeRefEquals(existing.output, implementation.output);
      }
      const constructor = bucketKey(family.trait.id, implementation.owner);
      const bucket = buckets.get(constructor) ?? { closed: new Map() };
      if (bucket.template !== undefined) {
        const selected = instantiate(bucket.template, implementation.owner);
        return selected !== undefined && selected.sourceFileName === implementation.sourceFileName &&
          rustTargetTypeRefEquals(selected.output, implementation.output);
      }
      if (parameterNames.size > 0) {
        for (const concrete of bucket.closed.values()) {
          const selected = instantiate(implementation, concrete.owner);
          if (selected === undefined || selected.sourceFileName !== concrete.sourceFileName ||
            !rustTargetTypeRefEquals(selected.output, concrete.output)) return false;
        }
      }
      const snapshot = Object.freeze({ ...implementation, family,
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
    implementation(identity: string, owner: TargetTypeRef) {
      const exact = implementations.get(key(identity, owner));
      if (exact !== undefined) return exact;
      const template = buckets.get(bucketKey(identity, owner))?.template;
      return template === undefined ? undefined : instantiate(template, owner);
    },
    implementations() { return Object.freeze([...implementations.values()]); },
    seal() {
      sealed = true;
      return Object.freeze({
        families: Object.freeze([...families.values()]),
        implementations: Object.freeze([...implementations.values()]),
      });
    },
  });
}
