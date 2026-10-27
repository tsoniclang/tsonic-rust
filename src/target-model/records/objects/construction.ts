import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectConstructorSignature, RustProjectTypeDefinition } from "../../types/project-types.js";
import type { RustFrameCallableDefinition } from "../callables/frame-callables.js";
import type { RustFinalizedSourceInput } from "../operations/finalized-operation.js";
import type { RustExternalProjectBase } from "../../types/external-project-types.js";

export type RustExternalInitialization =
  | { readonly kind: "empty" }
  | { readonly kind: "value" | "optional"; readonly input: RustFinalizedSourceInput };

export interface RustConstructionEmissionRecords {
  readonly implicitConstructorParameters: { readonly get: (signature: RustProjectConstructorSignature, carrier: TargetTypeRef) => readonly RustImplicitConstructorParameter[] | undefined };
  readonly externalProjectInitialization: { readonly get: (call: Node) => RustExternalInitialization | undefined };
  readonly inheritedExternalInitialization: { readonly get: (signature: RustProjectConstructorSignature) => { readonly name: string } | undefined };
  readonly externalProjectBase: { readonly get: (definition: RustProjectTypeDefinition) => RustExternalProjectBase | undefined };
}

export interface RustImplicitConstructorParameter {
  readonly declaration: Node;
  readonly name: string;
  readonly carrier: TargetTypeRef;
}

export interface RustConstructionField {
  readonly declaration: Node;
  readonly owner: RustProjectTypeDefinition;
  readonly carrier: TargetTypeRef;
  readonly initializer?: Node;
  readonly absenceDefault: boolean;
  readonly externallyInitialized: boolean;
}

export interface RustConstructionLayer {
  readonly definition: RustProjectTypeDefinition;
  readonly signature: RustProjectConstructorSignature;
  readonly constructor: Node | undefined;
  readonly baseCall?: Node;
  readonly fields: readonly RustConstructionField[];
  readonly statements: readonly Node[];
}

export interface RustConstructionExpression {
  readonly node: Node;
  readonly kind: "receiver" | "field" | "capture";
  readonly declaration?: Node;
  readonly receiver?: Node;
}

export interface RustConstructionPoint {
  readonly node: Node;
  readonly layer: RustProjectTypeDefinition;
  readonly initializedFields: readonly Node[];
  readonly possiblyInitializedFields: readonly Node[];
  readonly published: boolean;
  readonly publishBefore: boolean;
  readonly publishAfter: boolean;
  readonly publishMissingElse: boolean;
}

export type RustConstructionProjection =
  | { readonly kind: "fixed-self"; readonly expression: RustConstructionExpression }
  | { readonly kind: "local"; readonly expression: RustConstructionExpression; readonly declaration: Node; readonly storage: "value" | "frame" | "captured" }
  | { readonly kind: "receiver"; readonly expression: RustConstructionExpression; readonly node: Node; readonly carrier: TargetTypeRef; readonly projection: "identity" | "polymorphic" };

export interface RustConstructionPreparationSelection {
  readonly point: RustConstructionPoint;
  readonly layer: RustConstructionLayer;
  readonly retainsFrame: boolean;
  readonly projections: readonly RustConstructionProjection[];
}

export interface RustAdmittedConstruction {
  readonly definition: RustProjectTypeDefinition;
  readonly layers: readonly RustConstructionLayer[];
  readonly fields: readonly RustConstructionField[];
  readonly expressions: readonly RustConstructionExpression[];
  readonly points: ReadonlyMap<Node, RustConstructionPoint>;
  readonly returns: ReadonlyMap<Node, RustProjectTypeDefinition>;
  readonly earlyReturnLayers: ReadonlySet<RustProjectTypeDefinition>;
  readonly completingLayers: ReadonlySet<RustProjectTypeDefinition>;
  readonly localFieldDeclarations: ReadonlySet<Node>;
  readonly mutableFieldLocals: ReadonlyMap<RustProjectTypeDefinition | undefined, ReadonlySet<Node>>;
  /** Fields whose initializer value is always overwritten before it can be observed (evaluated for its effects). */
  readonly unobservedInitializers: ReadonlySet<Node>;
  readonly physicalDeclarations: ReadonlyMap<Node, Node>;
  readonly retainedFieldIdentities: ReadonlySet<Node>;
  readonly retainedReferenceIdentities: ReadonlySet<Node>;
  readonly completesNormally: boolean;
  readonly publishesReceiver: boolean;
  readonly mutableReceiver: boolean;
  readonly emission: {
    readonly canFallThrough: boolean;
    readonly frame: RustFrameCallableDefinition | undefined;
    readonly exposure: { readonly declaration: Node; readonly expression: Node; readonly carrier: TargetTypeRef } | undefined;
    readonly preparations: ReadonlyMap<Node, RustConstructionPreparationSelection>;
  };
}
