import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";

export interface RustNamePlan {
  readonly diagnostics: readonly TargetDiagnostic[];
  nameForDeclaration(declaration: Node | undefined): string | undefined;
  functionNameForDeclaration(declaration: Node | undefined): string | undefined;
  callableValueNameForDeclaration(declaration: Node | undefined): string | undefined;
  nameForSourceType(fileName: string, sourceName: string): string | undefined;
}
