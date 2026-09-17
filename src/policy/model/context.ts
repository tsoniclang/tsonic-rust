import type {
  AstReader,
  ExtensionFactSubject,
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { TsonicPointerReturnQueries, TsonicMemoryBindingIndex } from "@tsonic/source-core/facts";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

export interface RustSourcePolicyContext {
  readonly typeDefinitions: RustTypeDefinitions;
  readonly source: TargetSourceProgram;
  readonly pointerReturns: TsonicPointerReturnQueries;
  readonly memoryBindings: TsonicMemoryBindingIndex;
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
  readonly names: RustNamePlan;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly diagnostics: TargetDiagnostic[];
  semantics(sourceFile: SourceFile): SourceFileSemantics;
  semanticsFor(node: Node): SourceFileSemantics;
}

export function rustPolicyNode(
  context: RustSourcePolicyContext,
  subject: ExtensionFactSubject | undefined,
): Node | undefined {
  if (subject === undefined) {
    return undefined;
  }
  return context.ast.kind(subject as Node) === undefined
    ? undefined
    : subject as Node;
}
