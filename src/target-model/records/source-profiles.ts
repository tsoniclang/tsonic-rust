import type { Node } from "@tsonic/tsts";

export interface RustSourceProfileErrorContract {
  readonly value: Node;
  readonly instance: Node;
  readonly constructors: readonly Node[];
  readonly fields: Readonly<{ name: Node; message: Node; stack: Node }>;
}
