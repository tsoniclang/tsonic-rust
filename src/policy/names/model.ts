import type { Node } from "@tsonic/tsts";

export interface RustNamePlan {
  nameForDeclaration(declaration: Node | undefined): string | undefined;
  functionNameForDeclaration(declaration: Node | undefined): string | undefined;
  nameForSourceType(fileName: string, sourceName: string): string | undefined;
}
