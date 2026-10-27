import type { Node } from "@tsonic/tsts";
import type { RustSourceGenericParameterContract } from "../../lifetimes/model.js";
import type { RustTargetGenericArgument } from "../../types/model.js";
import type { RustTargetGenericBindings } from "../../types/carriers/generic-inference.js";
import type { RustOptionalStorageRequirement } from "../types/generic-requirements.js";
import type { RustClassImplementationContext } from "../objects/class-implementations.js";
import type { RustStructuralShapeField } from "../objects/structural-shapes.js";
import type { RustGenericCallableImplementation } from "./generic-callables.js";
import type { RustFrameCallableImplementation } from "./frame-callables.js";
import type { RustSuspendedCallableImplementation } from "./suspended-callables.js";
import type { RustSourceCallableSpecializationVariant } from "./callable-emission.js";
import type { RustProjectMethodDispatchVariant } from "../operations/method-dispatch.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectTypeDefinition } from "../../types/project-types.js";
import type { RustConstructionLayer } from "../objects/construction.js";

export interface RustCallableEntryHeaderSelection {
  readonly declaration: Node;
  readonly promiseBody: boolean;
  readonly sourceTypeParameterIdentities: readonly string[];
  readonly parameters: readonly RustSourceGenericParameterContract[];
  readonly optionalStorage: readonly RustOptionalStorageRequirement[];
  readonly nativeBinders: ReadonlyMap<string, true>;
  readonly bindings: RustTargetGenericBindings;
  readonly specialization: ReadonlyMap<string, TargetTypeRef> | undefined;
  readonly typeNames: ReadonlyMap<string, string>;
  readonly preservesExplicitLifetimes: boolean;
  readonly preservesSourceRequirements: boolean;
  readonly captureArguments: readonly RustTargetGenericArgument[];
}

export interface RustCallableEntryHeaderFacets {
  readonly source: RustCallableEntryHeaderSelection;
  readonly body: RustCallableEntryHeaderSelection;
}

export type RustCallableEntryHeaderPlacement = Node | RustClassImplementationContext | RustStructuralShapeField |
  RustGenericCallableImplementation | RustFrameCallableImplementation | RustSuspendedCallableImplementation |
  RustCallableEntryHeaderSelection | RustProjectTypeDefinition | RustConstructionLayer;

export type RustCallableEntryHeaderVariant = RustSourceCallableSpecializationVariant | RustProjectMethodDispatchVariant;

export interface RustCallableEntryHeaderSelections {
  get(placement: RustCallableEntryHeaderPlacement, variant: RustCallableEntryHeaderVariant | undefined,
    parent: RustCallableEntryHeaderSelection | undefined):
    RustCallableEntryHeaderFacets | undefined;
}
