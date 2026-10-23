import type { RustAnalysisProgram } from "../program/model.js";

import type { RustAnalysisRecords } from "../../target-model/records/analysis.js";

export type RustReachabilityInput = Pick<RustAnalysisProgram,
  | "source" | "sourceFiles" | "sourceNavigation" | "projectTypes" | "promiseBodies"
  | "moduleInitialization" | "sourcePackageFacades" | "sourcePackageComponents"
  | "classValues" | "sourceCallableSpecializations" | "declarationGenericRequirements"
  | "typeDefinitions" | "typeFamilies" | "objectRepresentations" | "projectMethodProperties"
  | "projectFieldDispatch" | "structuralShapes" | "callableValues" | "generatedDeclarationUses"
> & { readonly records: RustAnalysisRecords };
