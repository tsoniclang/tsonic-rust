// Structured Rust output model for the static-native construct set. The
// printer is the only place this model becomes text.

import type {
  RustAssignmentOperator,
  RustBinaryOperator,
  RustPrimitiveTypeName,
} from "../../common/rust-syntax.js";

export type RustType =
  | { readonly kind: "primitive"; readonly name: RustPrimitiveTypeName }
  | { readonly kind: "string" }
  | { readonly kind: "str-ref" }
  | { readonly kind: "unit" }
  | { readonly kind: "named"; readonly path: string; readonly lifetimeArguments?: readonly string[]; readonly typeArguments?: readonly RustType[] }
  | { readonly kind: "fixed-array"; readonly element: RustType; readonly length: number }
  | { readonly kind: "slice-ref"; readonly element: RustType; readonly mutable: boolean }
  | { readonly kind: "tuple"; readonly elements: readonly RustType[] };

export type RustExpr =
  | { readonly kind: "int-literal"; readonly text: string }
  | { readonly kind: "float-literal"; readonly text: string }
  | { readonly kind: "bool-literal"; readonly value: boolean }
  | { readonly kind: "none" }
  | { readonly kind: "string-literal"; readonly value: string }
  | { readonly kind: "str-literal"; readonly value: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "unary"; readonly operator: "-" | "!"; readonly operand: RustExpr }
  | { readonly kind: "binary"; readonly operator: RustBinaryOperator; readonly left: RustExpr; readonly right: RustExpr }
  | { readonly kind: "conditional"; readonly condition: RustExpr; readonly whenTrue: RustExpr; readonly whenFalse: RustExpr }
  | { readonly kind: "assignment"; readonly operator: RustAssignmentOperator; readonly target: RustExpr; readonly value: RustExpr }
  | { readonly kind: "call"; readonly path: string; readonly args: readonly RustExpr[] }
  | { readonly kind: "associated-call"; readonly owner: RustType; readonly method: string; readonly args: readonly RustExpr[] }
  | { readonly kind: "method-call"; readonly receiver: RustExpr; readonly method: string; readonly args: readonly RustExpr[] }
  | { readonly kind: "field"; readonly receiver: RustExpr; readonly name: string }
  | { readonly kind: "index"; readonly receiver: RustExpr; readonly index: RustExpr }
  | {
      readonly kind: "block";
      readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
      readonly value: RustExpr;
    }
  | { readonly kind: "evaluate-then"; readonly effect: RustExpr; readonly value: RustExpr }
  | { readonly kind: "string-concat"; readonly parts: readonly RustExpr[] }
  | { readonly kind: "reference"; readonly expr: RustExpr; readonly mutable?: boolean }
  | { readonly kind: "vec-literal"; readonly elements: readonly RustExpr[] }
  | { readonly kind: "slice-literal"; readonly elements: readonly RustExpr[] }
  | { readonly kind: "closure"; readonly params: readonly { readonly name: string; readonly byRefCopy: boolean }[]; readonly body: RustExpr }
  | {
      readonly kind: "closure-block";
      readonly params: readonly { readonly name: string; readonly mutable: boolean }[];
      readonly move: boolean;
      readonly async: boolean;
      readonly body: RustBlock;
    }
  | { readonly kind: "await"; readonly expr: RustExpr }
  | { readonly kind: "try"; readonly expr: RustExpr }
  | { readonly kind: "struct-literal"; readonly path: string; readonly fields: readonly { readonly name: string; readonly value: RustExpr }[] }
  | { readonly kind: "tuple-literal"; readonly elements: readonly RustExpr[] };

export type RustStmt =
  | { readonly kind: "let"; readonly name: string; readonly mutable: boolean; readonly type?: RustType; readonly init: RustExpr }
  | { readonly kind: "expr"; readonly expr: RustExpr }
  | { readonly kind: "assign"; readonly target: RustExpr; readonly operator: RustAssignmentOperator; readonly value: RustExpr }
  | { readonly kind: "return"; readonly expr?: RustExpr }
  | { readonly kind: "tail"; readonly expr: RustExpr }
  | { readonly kind: "if"; readonly condition: RustExpr; readonly then: RustBlock; readonly else?: RustBlock }
  | { readonly kind: "loop"; readonly label?: string; readonly body: RustBlock }
  | { readonly kind: "while"; readonly label?: string; readonly condition: RustExpr; readonly body: RustBlock }
  | { readonly kind: "while-let-some"; readonly label?: string; readonly binding: string; readonly bindingMutable?: boolean; readonly expression: RustExpr; readonly body: RustBlock }
  | { readonly kind: "for"; readonly label?: string; readonly binding: string; readonly bindingMutable?: boolean; readonly iterable: RustExpr; readonly body: RustBlock }
  | { readonly kind: "if-let-some"; readonly binding: string; readonly expression: RustExpr; readonly body: RustBlock }
  | { readonly kind: "break"; readonly label?: string }
  | { readonly kind: "continue"; readonly label?: string }
  | {
      readonly kind: "completion-exit";
      readonly completion: "return" | "break" | "continue";
      readonly resultWrapped: boolean;
      readonly tail?: true;
      readonly expr?: RustExpr;
      readonly loopId?: number;
    }
  | {
      readonly kind: "resource-scope";
      readonly flowName: string;
      readonly cleanupName: string;
      readonly returnType: RustType;
      readonly fallible: boolean;
      readonly asynchronous: boolean;
      readonly body: RustBlock;
      readonly cleanup: RustBlock;
      readonly propagate: boolean;
      readonly dispatchReturn: boolean;
      readonly dispatchLoops: readonly {
        readonly id: number;
        readonly label: string;
        readonly continuePrelude: readonly RustStmt[];
      }[];
      readonly terminates: boolean;
    }
  | { readonly kind: "index-assign"; readonly receiver: RustExpr; readonly index: RustExpr; readonly value: RustExpr }
  | { readonly kind: "scope"; readonly body: RustBlock }
  | { readonly kind: "throw"; readonly message: RustExpr; readonly tail?: true }
  | { readonly kind: "try-catch"; readonly body: RustBlock; readonly catchBinding: string; readonly catchBody: RustBlock };

export interface RustBlock {
  readonly statements: readonly RustStmt[];
}

export interface RustFunctionParam {
  readonly name: string;
  readonly type: RustType;
  readonly mutable?: boolean;
}

export type RustTypeBound =
  | { readonly kind: "trait"; readonly path: string }
  | { readonly kind: "lifetime"; readonly name: string };

export interface RustTypeParameter {
  readonly name: string;
  readonly bounds: readonly RustTypeBound[];
}

export type RustSelfParam = "ref" | "mut-ref";

export interface RustStructField {
  readonly name: string;
  readonly type: RustType;
  readonly pub: boolean;
}

export interface RustImplFunction {
  readonly name: string;
  readonly pub: boolean;
  readonly attrs?: readonly string[];
  readonly isAsync?: boolean;
  readonly fallible?: boolean;
  readonly selfParam?: RustSelfParam;
  readonly params: readonly RustFunctionParam[];
  readonly returnType?: RustType;
  readonly body: RustBlock;
}

export type RustItem =
  | {
      readonly kind: "function";
      readonly name: string;
      readonly pub: boolean;
      readonly attrs?: readonly string[];
      readonly isAsync?: boolean;
      readonly fallible?: boolean;
      readonly typeParams?: readonly RustTypeParameter[];
      readonly params: readonly RustFunctionParam[];
      readonly returnType?: RustType;
      readonly body: RustBlock;
    }
  | {
      readonly kind: "const";
      readonly attrs?: readonly string[];
      readonly name: string;
      readonly pub: boolean;
      readonly type: RustType;
      readonly value: RustExpr;
    }
  | { readonly kind: "mod-decl"; readonly name: string; readonly pub: boolean }
  | { readonly kind: "struct"; readonly name: string; readonly pub: boolean; readonly attrs?: readonly string[]; readonly derives: readonly string[]; readonly fields: readonly RustStructField[] }
  | { readonly kind: "impl"; readonly name: string; readonly functions: readonly RustImplFunction[] }
  | { readonly kind: "enum"; readonly name: string; readonly pub: boolean; readonly derives: readonly string[]; readonly variants: readonly { readonly name: string; readonly discriminant?: string }[] }
  | { readonly kind: "use"; readonly path: string; readonly alias?: string };

export interface RustSourceFileModel {
  readonly headerComment: string;
  readonly items: readonly RustItem[];
}

export const rustGeneratedHeaderComment = "Generated by the Tsonic Rust target. Do not edit.";

export function createRustSourceFile(items: readonly RustItem[]): RustSourceFileModel {
  return { headerComment: rustGeneratedHeaderComment, items };
}
