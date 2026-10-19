import type { TsonicSafetyApplicationFact, TsonicSafetyBuilderFact, TsonicUnsafeContextFact } from "@tsonic/source-core/facts";
import type { TargetSafetyApplication, TargetSafetyOperation } from "@tsonic/target-api/analysis";

export type RustSafetyApplication = TargetSafetyApplication<TsonicSafetyApplicationFact>;
export type RustSafetyOperation = TargetSafetyOperation<TsonicUnsafeContextFact, TsonicSafetyBuilderFact>;
