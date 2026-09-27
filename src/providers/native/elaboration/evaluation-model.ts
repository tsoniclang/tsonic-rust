import type { RustNativeDefinitionId, RustNativeNodeId, RustNativeSourceSpan } from "./evidence.js";

export interface RustNativeBodyEvaluation {
  readonly owner: RustNativeDefinitionId;
  readonly parameters: readonly RustNativeNodeId[];
  readonly root: RustNativeNodeId;
  readonly nodes: readonly RustNativeEvaluationNode[];
}

export type RustNativeEvaluationNode = {
  readonly id: RustNativeNodeId;
  readonly source: RustNativeSourceSpan | null;
} & RustNativeEvaluation;

export type RustNativeEvaluation =
  | { readonly kind: "operation"; readonly operation: RustNativeEvaluationOperation; readonly inputs: readonly RustNativeNodeId[] }
  | { readonly kind: "short-circuit"; readonly operator: "and" | "or"; readonly left: RustNativeNodeId; readonly right: RustNativeNodeId }
  | { readonly kind: "if"; readonly condition: RustNativeNodeId; readonly consequent: RustNativeNodeId; readonly alternative: RustNativeNodeId | null }
  | { readonly kind: "match"; readonly input: RustNativeNodeId; readonly arms: readonly RustNativeEvaluationArm[] }
  | { readonly kind: "loop" | "block-expression"; readonly block: RustNativeNodeId }
  | { readonly kind: "block"; readonly statements: readonly RustNativeEvaluationStatement[];
      readonly tail: RustNativeNodeId | null; readonly targetedByBreak: boolean }
  | { readonly kind: "let"; readonly pattern: RustNativeNodeId; readonly initializer: RustNativeNodeId }
  | { readonly kind: "break"; readonly target: RustNativeNodeId; readonly value: RustNativeNodeId | null }
  | { readonly kind: "continue"; readonly target: RustNativeNodeId }
  | { readonly kind: "return"; readonly value: RustNativeNodeId | null }
  | { readonly kind: "become" | "yield"; readonly value: RustNativeNodeId }
  | { readonly kind: "closure" | "const"; readonly definition: RustNativeDefinitionId }
  | { readonly kind: "struct"; readonly fields: readonly RustNativeNodeId[]; readonly tail: RustNativeEvaluationStructTail }
  | { readonly kind: "assembly"; readonly options: number; readonly operands: readonly RustNativeEvaluationAssemblyOperand[] };

export type RustNativeEvaluationOperation =
  | "array" | "tuple" | "call" | "method-call" | "binary" | "unary" | "use" | "cast" | "type-ascription"
  | "drop-temporaries" | "field" | "index" | "borrow" | "repeat" | "unsafe-binder-cast"
  | "assign" | "compound-assign" | "literal" | "path" | "offset-of";

export interface RustNativeEvaluationArm {
  readonly id: RustNativeNodeId;
  readonly pattern: RustNativeNodeId;
  readonly guard: RustNativeNodeId | null;
  readonly body: RustNativeNodeId;
}

export type RustNativeEvaluationStatement =
  | { readonly kind: "let"; readonly id: RustNativeNodeId; readonly pattern: RustNativeNodeId;
      readonly initializer: RustNativeNodeId | null; readonly alternative: RustNativeNodeId | null }
  | { readonly kind: "item"; readonly definition: RustNativeDefinitionId }
  | { readonly kind: "expression"; readonly expression: RustNativeNodeId; readonly semicolon: boolean };

export type RustNativeEvaluationStructTail =
  | { readonly kind: "none" | "defaults" }
  | { readonly kind: "base"; readonly expression: RustNativeNodeId };

export type RustNativeEvaluationAssemblyOperand =
  | { readonly kind: "input" | "function"; readonly expression: RustNativeNodeId }
  | { readonly kind: "output"; readonly expression: RustNativeNodeId | null; readonly late: boolean }
  | { readonly kind: "input-output"; readonly expression: RustNativeNodeId; readonly late: boolean }
  | { readonly kind: "split-input-output"; readonly input: RustNativeNodeId; readonly output: RustNativeNodeId | null; readonly late: boolean }
  | { readonly kind: "const" | "static"; readonly definition: RustNativeDefinitionId }
  | { readonly kind: "label"; readonly block: RustNativeNodeId };
