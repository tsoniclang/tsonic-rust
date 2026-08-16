import type {
  AstReader,
  ExtensionFactSubject,
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetDiagnostic,
  TargetSourceProgram,
} from "@tsonic/target-api";
import type { RustSemanticModel } from "./model.js";
import type { RustNamePlan } from "../common/rust-name-plan.js";

export interface RustSourcePolicyContext {
  readonly source: TargetSourceProgram;
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustSemanticModel;
  readonly names: RustNamePlan;
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
