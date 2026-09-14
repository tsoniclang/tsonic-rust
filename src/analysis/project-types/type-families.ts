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

export function createRustSourceTypeFamilyRegistry(): RustSourceTypeFamilyRegistry {
  const families = new Map<string, RustSourceTypeFamily>();
  const implementations = new Map<string, RustSourceTypeFamilyImplementation>();
  let sealed = false;
  const assertWritable = (): void => {
    if (sealed) throw new Error("Rust source type families are already sealed.");
  };
  const key = (identity: string, owner: TargetTypeRef): string =>
    closedMetadataKey({ identity, owner });
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
        implementation.sourceFileName.length === 0) return false;
      const parameterNames = new Set(rustTargetTypeParameterNames(implementation.owner));
      if (!rustTargetTypeParameterNames(implementation.output).every(name => parameterNames.has(name))) return false;
      const identity = key(implementation.family.trait.id, implementation.owner);
      const existing = implementations.get(identity);
      if (existing !== undefined) {
        return existing.sourceFileName === implementation.sourceFileName &&
          rustTargetTypeRefEquals(existing.output, implementation.output);
      }
      implementations.set(identity, Object.freeze({ ...implementation, family,
        owner: snapshotClosedMetadata(implementation.owner), output: snapshotClosedMetadata(implementation.output) }));
      return true;
    },
    implementation(identity: string, owner: TargetTypeRef) {
      const exact = implementations.get(key(identity, owner));
      if (exact !== undefined) return exact;
      const selected: RustSourceTypeFamilyImplementation[] = [];
      for (const candidate of implementations.values()) {
        if (candidate.family.trait.id !== identity) continue;
        const parameters = rustTargetTypeParameterNames(candidate.owner);
        if (parameters.length === 0) continue;
        const bindings = inferRustTargetTypeParameterBindings(candidate.owner, owner, new Set(parameters));
        if (bindings !== undefined) selected.push(Object.freeze({ ...candidate, owner,
          output: substituteRustTargetTypeParameters(candidate.output, bindings) }));
      }
      return selected.length === 1 ? selected[0] : undefined;
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
