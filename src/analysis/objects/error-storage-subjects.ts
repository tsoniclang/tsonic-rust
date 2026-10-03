import type { Node } from "@tsonic/tsts";

export interface RustErrorStorageSubject {
  readonly kind: "value" | "return" | "receiver";
  readonly node: Node;
}

export function createRustErrorStorageSubjects() {
  const values = new Map<Node, RustErrorStorageSubject>();
  const returns = new Map<Node, RustErrorStorageSubject>();
  const receivers = new Map<Node, RustErrorStorageSubject>();
  return (node: Node | undefined, kind: RustErrorStorageSubject["kind"] = "value"): RustErrorStorageSubject | undefined => {
    if (node === undefined) return undefined;
    const subjects = kind === "value" ? values : kind === "return" ? returns : receivers;
    let selected = subjects.get(node);
    if (selected === undefined) {
      selected = Object.freeze({ kind, node });
      subjects.set(node, selected);
    }
    return selected;
  };
}
