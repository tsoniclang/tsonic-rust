import type { Node } from "@tsonic/tsts";
import type {
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
  RustLifetimeRef,
} from "../../target-model/semantics/index.js";

export interface RustSourceGenericParameterContract {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly parameter: RustGenericParameter;
}

export interface RustSourceGenericContract {
  readonly declaration: Node;
  readonly generics: RustGenerics;
  readonly parameters: readonly RustSourceGenericParameterContract[];
}

export interface RustSourceGenericParameterIdentityContract {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly argument: RustGenericArgument;
}

export interface RustSourceGenericIdentityContract {
  readonly declaration: Node;
  readonly parameters: readonly RustSourceGenericParameterIdentityContract[];
  readonly arguments: readonly RustGenericArgument[];
}

export interface RustSourceGenericIndex {
  contractFor(declaration: Node | undefined): RustSourceGenericContract | undefined;
  identityContractFor(declaration: Node | undefined): RustSourceGenericIdentityContract | undefined;
  parameterFor(declaration: Node | undefined): RustSourceGenericParameterContract | undefined;
  allContracts(): readonly RustSourceGenericContract[];
  lifetimeOutlives(longer: RustLifetimeRef, shorter: RustLifetimeRef): boolean;
}
