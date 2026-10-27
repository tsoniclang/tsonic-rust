import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectTypeDefinition } from "../../types/project-types.js";
import type { RustObjectRepresentation } from "../objects/object-representation.js";
import type { RustSourceCallableSpecializationVariant } from "../callables/callable-emission.js";
import type { RustRecordFamily } from "../program.js";
import type { RustProjectMethodDispatchVariant } from "../operations/method-dispatch.js";

export interface RustMethodEmissionVariant {
  readonly name: string | undefined;
  readonly moduleName: string;
  readonly moduleVisibility: "public" | "crate" | "private";
  readonly promiseBody: boolean;
  readonly specialization: RustSourceCallableSpecializationVariant | undefined;
}

export interface RustMethodDeclarationEmission {
  readonly kind: "body" | "overload";
  readonly name: string;
  readonly isStatic: boolean;
  readonly visibility: "public" | "private";
  readonly staticSlot: string | undefined;
  readonly owner: RustProjectTypeDefinition;
  readonly environment: { readonly declaration: Node; readonly carrier: TargetTypeRef; readonly name: string;
    readonly genericParameterIndexes: readonly number[] } | undefined;
  readonly override: { readonly name: string; readonly representation: RustObjectRepresentation } | undefined;
  readonly variants: readonly RustMethodEmissionVariant[];
}

export interface RustMethodEmissionRecords {
  readonly methodDispatch: { readonly get: (declaration: Node, arguments_: readonly TargetTypeRef[]) => RustProjectMethodDispatchVariant | undefined };
  readonly methodDeclaration: RustRecordFamily<RustMethodDeclarationEmission>;
  readonly classMethods: RustRecordFamily<readonly Node[]>;
}
