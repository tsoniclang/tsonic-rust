import type { Node } from "@tsonic/tsts";
import type { RustTargetTraitRef, TargetTypeRef } from "../../target-model/types/model.js";

export interface RustSourceTypeFamily {
  readonly declaration: Node;
  readonly parameter: Node;
  readonly trait: RustTargetTraitRef;
}

export interface RustSourceTypeFamilyImplementation {
  readonly family: RustSourceTypeFamily;
  readonly owner: TargetTypeRef;
  readonly output: TargetTypeRef;
  readonly sourceFileName: string;
}

export interface RustSourceTypeFamilyRegistry {
  register(family: RustSourceTypeFamily): boolean;
  get(identity: string): RustSourceTypeFamily | undefined;
  families(): readonly RustSourceTypeFamily[];
  registerImplementation(implementation: RustSourceTypeFamilyImplementation): boolean;
  implementation(identity: string, owner: TargetTypeRef): RustSourceTypeFamilyImplementation | undefined;
  implementations(): readonly RustSourceTypeFamilyImplementation[];
  seal(): RustSourceTypeFamilyPlan;
}

export interface RustSourceTypeFamilyPlan {
  readonly families: readonly RustSourceTypeFamily[];
  readonly implementations: readonly RustSourceTypeFamilyImplementation[];
}
