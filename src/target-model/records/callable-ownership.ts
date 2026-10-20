import type { Node } from "@tsonic/tsts";

export interface RustCallableOwnershipCapture {
  readonly callable: Node;
  readonly declaration: Node;
  readonly kind: "lexical" | "field" | "receiver";
  readonly references: readonly Node[];
}

export interface RustCallableOwnershipReceiverRelation {
  readonly callable: Node;
  readonly selectedDeclaration: Node;
  readonly storageDeclaration: Node;
  readonly access: Node;
  readonly receiver: Node;
  readonly receiverOwner: Node;
}

export interface RustCallableOwnershipComponent {
  readonly identity: Node;
  readonly ownerDeclaration: Node;
  readonly kind: "lexical" | "class";
  readonly activationScope: Node;
  readonly callableDeclarations: readonly Node[];
  readonly slotDeclarations: readonly Node[];
  readonly captures: readonly RustCallableOwnershipCapture[];
  readonly externalCaptures: readonly RustCallableOwnershipCapture[];
  readonly receiverRelations: readonly RustCallableOwnershipReceiverRelation[];
  readonly creationIdentity: "per-evaluation";
}

export interface RustCallableActivation {
  readonly kind: "lexical" | "class";
  readonly ownerDeclaration: Node;
  readonly activationScope: Node;
  readonly components: readonly RustCallableOwnershipComponent[];
  readonly callableDeclarations: readonly Node[];
  readonly slotDeclarations: readonly Node[];
  readonly externalCaptures: readonly RustCallableOwnershipCapture[];
}

export interface RustCallableOwnershipIssue {
  readonly node: Node;
  readonly reason: string;
}

export interface RustCallableOwnershipComponentQueries {
  readonly components: readonly RustCallableOwnershipComponent[];
  readonly issues: readonly RustCallableOwnershipIssue[];
  failureReason(): string | undefined;
  componentForCallable(declaration: Node): RustCallableOwnershipComponent | undefined;
  componentForSlot(declaration: Node): RustCallableOwnershipComponent | undefined;
  isCyclicCallable(declaration: Node): boolean;
  isCyclicSlot(declaration: Node): boolean;
  isIndependentCallable(declaration: Node): boolean;
  instanceReceiverOwner(receiver: Node): Node | undefined;
}
export interface RustCallableOwnershipComponentPublication {
  readonly components: readonly RustCallableOwnershipComponent[];
  readonly issues: readonly RustCallableOwnershipIssue[];
  readonly failure: string | undefined;
  readonly callableComponents: ReadonlyMap<Node, RustCallableOwnershipComponent>;
  readonly slotComponents: ReadonlyMap<Node, RustCallableOwnershipComponent>;
  readonly canonicalSlots: ReadonlyMap<Node, Node>;
  readonly cyclicCallables: ReadonlySet<Node>;
  readonly cyclicSlots: ReadonlySet<Node>;
  readonly independentCallables: ReadonlySet<Node>;
  readonly receiverOwners: ReadonlyMap<Node, Node>;
}
