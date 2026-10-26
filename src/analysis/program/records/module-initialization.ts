import type { SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustModuleInitializationIssue, RustModuleInitializationPlan, RustModuleInitializationRequirement } from "../../../target-model/records/module-initialization.js";
import type { RustFoundation } from "../../../target-model/foundation/model.js";

export function createRustModuleInitializationRecords(input: {
  readonly issues: readonly RustModuleInitializationIssue[];
  readonly requirements: ReadonlyMap<SourceFile, RustModuleInitializationRequirement>;
  readonly minimumFoundation: RustFoundation;
  readonly moduleCycles: readonly import("../../../target-model/records/module-initialization.js").RustModuleCycleSelection[];
}): RustModuleInitializationPlan {
  const requirements = new WeakMap(input.requirements);
  return Object.freeze({
    issues: input.issues,
    moduleCycles: input.moduleCycles,
    requirementFor(sourceFile: SourceFile): RustModuleInitializationRequirement {
      const selected = requirements.get(sourceFile);
      if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "A module initialization query requires an admitted source file.", sourceFile);
      return selected;
    },
    minimumFoundation: () => input.minimumFoundation,
  });
}
