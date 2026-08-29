import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFallibleErrorBoundary } from "../../target-model/operations/error-boundary.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export interface RustSourceModuleBootstrap {
  readonly id: string;
  readonly path: string;
  readonly errorBoundary: RustFallibleErrorBoundary;
  readonly errorCarrier?: TargetTypeRef;
}

export interface RustSourceModuleConstruction {
  readonly expression: Node;
  readonly sourceFile: SourceFile;
  readonly targetSourceFile: SourceFile;
  readonly moduleArgument: Node;
  readonly sourceArgumentIndex: number;
  readonly targetArgumentIndex: number;
  readonly bootstrap: RustSourceModuleBootstrap;
}

export interface RustSourceModuleConstructionIndex {
  construction(node: Node): RustSourceModuleConstruction | undefined;
  entries(): readonly RustSourceModuleConstruction[];
  from(sourceFile: SourceFile): readonly RustSourceModuleConstruction[];
  targets(): readonly SourceFile[];
  bootstraps(): readonly RustSourceModuleBootstrap[];
}

export interface RustSourceModuleAnalysisIssue {
  readonly code: string;
  readonly node: Node;
  readonly message: string;
}

export interface RustSourceModuleAnalysis {
  readonly index: RustSourceModuleConstructionIndex;
  readonly issues: readonly RustSourceModuleAnalysisIssue[];
}
