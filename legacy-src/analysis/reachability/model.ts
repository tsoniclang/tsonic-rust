import type { Node } from "@tsonic/tsts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustGeneratedItemUsage } from "./generated-item-usage-model.js";
import type { RustAnalysisRecords } from "../program/records/model.js";

export interface RustReachability extends RustGeneratedItemUsage {
  readonly externallyReachable: ReadonlySet<Node>;
  readonly suppressedDeclarations: ReadonlySet<Node>;
}

export type RustReachabilityInput = Pick<RustAnalysisProgram,
  | "source" | "sourceFiles" | "sourceNavigation" | "projectTypes"
  | "moduleInitialization" | "sourcePackageFacades" | "sourcePackageComponents"
  | "classValues" | "sourceCallableSpecializations" | "declarationGenericRequirements"
  | "typeDefinitions" | "typeFamilies" | "objectRepresentations" | "projectMethodProperties"
  | "projectFieldDispatch" | "structuralShapes" | "callableValues" | "generatedDeclarationUses"
> & { readonly records: RustAnalysisRecords };
