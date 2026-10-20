import type { SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { SourceBinaryEntryIssue } from "@tsonic/target-api/source";
import type { RustModuleInitializationPlan, RustModuleInitializationRequirement } from "../../../target-model/records/module-initialization.js";
import type { RustFoundation } from "../../../target-model/foundation/model.js";

export function createRustModuleInitializationRecords(input: {
  readonly issues: readonly SourceBinaryEntryIssue[];
  readonly requirements: ReadonlyMap<SourceFile, RustModuleInitializationRequirement>;
  readonly minimumFoundation: RustFoundation;
  readonly stateIndependentCycles: ReadonlySet<SourceFile>;
}): RustModuleInitializationPlan {
  const requirements = new WeakMap(input.requirements);
  const cycles = new WeakSet(input.stateIndependentCycles);
  return Object.freeze({
    issues: input.issues,
    requirementFor(sourceFile: SourceFile): RustModuleInitializationRequirement {
      const selected = requirements.get(sourceFile);
      if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "A module initialization query requires an admitted source file.", sourceFile);
      return selected;
    },
    minimumFoundation: () => input.minimumFoundation,
    hasStateIndependentCycle: (sourceFile: SourceFile) => cycles.has(sourceFile),
  });
}
