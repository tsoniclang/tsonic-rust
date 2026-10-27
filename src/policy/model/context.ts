import type { AstReader, ExtensionFactSubject, Node, SourceFile } from "@tsonic/tsts";
import type { SourceFileSemantics, SourceLiteralIndex, TargetSourceProgram } from "@tsonic/target-api/source";

import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { TsonicPointerReturnQueries, TsonicMemoryBindingIndex } from "@tsonic/source-core/facts";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { RustSourceCallableQueries } from "../../target-model/records/callables/source-callables.js";
import type { RustRetainedEnvironmentQueries } from "../../target-model/records/callables/retained-environments.js";

export interface RustSourcePolicyContext {
  readonly integerRanges: import("../../target-model/records/operations/integer-ranges.js").RustIntegerRangeIndex;
  readonly callableRepresentation: "signature" | "storage" | "construction";
  readonly typeDefinitions: RustTypeDefinitions;
  readonly source: TargetSourceProgram;
  readonly sourceStorage: SourceStorageQueries;
  readonly sourceCallables: RustSourceCallableQueries;
  readonly retainedEnvironments: RustRetainedEnvironmentQueries;
  readonly pointerReturns: TsonicPointerReturnQueries;
  readonly memoryBindings: TsonicMemoryBindingIndex;
  readonly ast: AstReader;
  readonly literalValues: SourceLiteralIndex;
  readonly sourceFiles: readonly SourceFile[];
  readonly records: RustProgramRecords;
  readonly names: RustNamePlan;
  readonly sourceLifetimes: RustLifetimeIndex;
  semantics(sourceFile: SourceFile): SourceFileSemantics;
  semanticsFor(node: Node): SourceFileSemantics;
}

export function rustPolicyNode(
  context: Pick<RustSourcePolicyContext, "ast">,
  subject: ExtensionFactSubject | undefined,
): Node | undefined {
  if (subject === undefined) {
    return undefined;
  }
  return context.ast.kind(subject as Node) === undefined
    ? undefined
    : subject as Node;
}
