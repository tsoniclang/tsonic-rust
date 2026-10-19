import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustProjectConstructorSignature, RustProjectTypeDefinition } from "../types/project-types.js";
import type { RustFrameCallableDefinition } from "./frame-callables.js";

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
  readonly unpublishedMutations: ReadonlySet<Node>;
  readonly physicalDeclarations: ReadonlyMap<Node, Node>;
  readonly retainedFieldIdentities: ReadonlySet<Node>;
  readonly retainedReferenceIdentities: ReadonlySet<Node>;
  readonly completesNormally: boolean;
  readonly publishesReceiver: boolean;
  readonly mutatesPublishedFields: boolean;
  readonly emission: {
    readonly frame: RustFrameCallableDefinition | undefined;
    readonly exposure: { readonly declaration: Node; readonly expression: Node; readonly carrier: TargetTypeRef } | undefined;
    readonly preparations: ReadonlyMap<Node, RustConstructionPreparationSelection>;
  };
}
