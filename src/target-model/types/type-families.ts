import type { Node } from "@tsonic/tsts";
import type { RustTargetGenericArgument, RustTargetTraitRef, TargetTypeRef } from "./model.js";

export interface RustConditionalSourceTypeFamily {
  readonly kind: "conditional";
  readonly declaration: Node;
  readonly parameter: Node;
  readonly trait: RustTargetTraitRef;
}

export interface RustIndexedSourceTypeFamily {
  readonly kind: "indexed";
  readonly trait: RustTargetTraitRef;
}

export type RustSourceTypeFamily = RustConditionalSourceTypeFamily | RustIndexedSourceTypeFamily;

export interface RustSourceTypeFamilyImplementation {
  readonly family: RustSourceTypeFamily;
  readonly arguments: readonly RustTargetGenericArgument[];
  readonly owner: TargetTypeRef;
  readonly output: TargetTypeRef;
  readonly sourceFileName: string;
  readonly field?: {
    readonly storage: "structural-object" | "project-object";
    readonly storageIndex: number;
    readonly readonly: boolean;
    readonly sharedWrite: boolean;
  };
}

export interface RustSourceTypeFamilyRegistry {
  registerFieldKey(identity: string, name: string): boolean;
  register(family: RustSourceTypeFamily): boolean;
  get(identity: string): RustSourceTypeFamily | undefined;
  families(): readonly RustSourceTypeFamily[];
  registerImplementation(implementation: RustSourceTypeFamilyImplementation): boolean;
  implementation(trait: RustTargetTraitRef, owner: TargetTypeRef): RustSourceTypeFamilyImplementation | undefined;
  implementations(): readonly RustSourceTypeFamilyImplementation[];
  seal(): RustSourceTypeFamilyPlan;
}

export interface RustSourceTypeFamilyPlan {
  readonly families: readonly RustSourceTypeFamily[];
  readonly implementations: readonly RustSourceTypeFamilyImplementation[];
  normalize(carrier: TargetTypeRef): TargetTypeRef;
}
