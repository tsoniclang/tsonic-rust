import type { SourceFile } from "@tsonic/tsts";
import type { RustSourceFileOutputIdentity } from "../../names/source-output-identities.js";
import type { RustTargetConfiguration } from "../../configuration/model.js";
import type { RustCargoDependency } from "../../project/model.js";
import type { RustFoundation } from "../../foundation/model.js";
import type { RustInitializationErrorRecords } from "../errors/error-regions.js";
import type { RustBinaryExecution, RustBinaryHookPlan } from "../operations/binary-execution.js";
import type { RustFallibleErrorBoundary } from "../../operations/error-boundary.js";
import type { TargetTypeRef } from "../../types/model.js";

export interface RustProgramEmission {
  readonly configuration: RustTargetConfiguration;
  readonly identities: ReadonlyMap<string, RustSourceFileOutputIdentity>;
  readonly sourceFiles: readonly SourceFile[];
  readonly runtimeReferences: {
    readonly cargoDependencies: readonly RustCargoDependency[];
    readonly activeCrates: readonly string[];
    readonly foundation: RustFoundation;
    readonly minimumFoundationByCrate: ReadonlyMap<string, RustFoundation>;
  };
  readonly initialization: Pick<RustInitializationErrorRecords, "entrySourceFile" | "root" | "binary">;
  readonly hooks: readonly RustBinaryHookPlan[];
  readonly execution: RustBinaryExecution;
  readonly initializerFunctionBase: string;
  readonly linkedComponentIds: readonly string[];
  readonly workerDispatch: readonly {
    readonly bootstrap: {
      readonly id: string;
      readonly path: string;
      readonly errorBoundary: RustFallibleErrorBoundary;
      readonly errorCarrier?: TargetTypeRef;
    };
    readonly targets: readonly SourceFile[];
  }[];
}

export interface RustProgramEmissionRecords {
  readonly programEmission: { readonly get: () => RustProgramEmission | undefined };
}
