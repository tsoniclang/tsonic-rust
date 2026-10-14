import type { Node } from "@tsonic/tsts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustGeneratedItemUsage } from "./generated-item-usage-model.js";

export interface RustReachability extends RustGeneratedItemUsage {
  readonly externallyReachable: ReadonlySet<Node>;
  readonly suppressedDeclarations: ReadonlySet<Node>;
}

export type RustReachabilityInput = Pick<RustTargetProgram,
  | "source" | "sourceFiles" | "sourceNavigation" | "records" | "projectTypes"
  | "moduleInitialization" | "sourcePackageFacades" | "sourcePackageComponents"
  | "classValues" | "sourceCallableSpecializations" | "declarationGenericRequirements"
  | "typeDefinitions" | "typeFamilies" | "objectRepresentations" | "projectMethodProperties"
  | "projectFieldDispatch" | "structuralShapes" | "callableValues" | "generatedDeclarationUses"
>;
