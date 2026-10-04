import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type {
  AstReader,
  Node,
  SourceFile,
  Type,
} from "@tsonic/tsts";
import type {
  SourceDeclaredHeritageEdge,
  SourceProgramNavigation,
} from "@tsonic/target-api/source";
import type { RustExternalProjectBase } from "../../target-model/types/external-project-types.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type {
  RustLifetimeIndex,
  RustSourceGenericParameterContract,
} from "../../target-model/lifetimes/index.js";

export interface RustProjectTypePolicyHost {
  collectImplicitInterfaces(): readonly import("../../target-model/types/project-interfaces.js").RustImplicitInterfaceContract[];
  readonly ast: AstReader;
  readonly names: RustNamePlan;
  readonly navigation: SourceProgramNavigation;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly thrownClassDeclarations: ReadonlySet<Node>;
  readonly sourceCreatedErrorOrigins: readonly Node[];
  normalizeCarrier(carrier: TargetTypeRef): TargetTypeRef;
  genericParametersFor(declaration: Node): readonly RustSourceGenericParameterContract[] | undefined;
  isRepresentationAlias(declaration: Node): boolean;
  externallyExtensible(declaration: Node): boolean;
  targetNameForCallable(declaration: Node): string | undefined;
  sourcePackageComponentForFile(fileName: string): string | undefined;
  resolveSelectedType(
    authoredTypeNode: Node | undefined,
    selectedType: Type,
    heritage: Node,
  ): TargetTypeRef | undefined;
  resolveExternalHeritage(edge: SourceDeclaredHeritageEdge): RustExternalProjectBase | undefined;
}

export interface RustProjectTypePolicyRegistry extends RustProjectTypePolicy {
  initialize(host: RustProjectTypePolicyHost): RustProjectTypePolicy;
  isInitialized(): boolean;
  seal(): RustProjectTypePolicy;
}
