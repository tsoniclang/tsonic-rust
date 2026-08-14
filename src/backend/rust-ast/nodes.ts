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
  | { readonly kind: "never" }
  | { readonly kind: "named"; readonly path: string; readonly lifetimeArguments?: readonly string[]; readonly typeArguments?: readonly RustType[] }
  | { readonly kind: "trait-object"; readonly trait: RustType }
  | { readonly kind: "reference"; readonly referent: RustType; readonly mutable: boolean }
  | { readonly kind: "raw-pointer"; readonly pointee: RustType; readonly mutable: boolean }
  | { readonly kind: "fixed-array"; readonly element: RustType; readonly length: number }
  | { readonly kind: "slice-ref"; readonly element: RustType; readonly mutable: boolean }
  | { readonly kind: "function-pointer"; readonly parameters: readonly RustType[]; readonly result: RustType; readonly abi?: readonly string[]; readonly isUnsafe?: boolean }
  | { readonly kind: "tuple"; readonly elements: readonly RustType[] };

export type RustPattern =
  | { readonly kind: "wildcard" }
  | { readonly kind: "binding"; readonly name: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "tuple"; readonly elements: readonly RustPattern[] }
  | {
      readonly kind: "tuple-variant";
      readonly path: string;
      readonly elements: readonly RustPattern[];
    };

export type RustExpr =
  | { readonly kind: "int-literal"; readonly text: string }
  | { readonly kind: "float-literal"; readonly text: string }
  | { readonly kind: "bool-literal"; readonly value: boolean }
  | { readonly kind: "none" }
  | { readonly kind: "string-literal"; readonly value: string }
  | { readonly kind: "str-literal"; readonly value: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "bottom"; readonly expression: RustExpr }
  | { readonly kind: "unary"; readonly operator: "-" | "!"; readonly operand: RustExpr }
  | { readonly kind: "dereference"; readonly pointer: RustExpr }
  | { readonly kind: "numeric-cast"; readonly expression: RustExpr; readonly target: RustPrimitiveTypeName }
  | { readonly kind: "binary"; readonly operator: RustBinaryOperator; readonly left: RustExpr; readonly right: RustExpr }
  | { readonly kind: "range"; readonly start: RustExpr; readonly end: RustExpr }
  | { readonly kind: "conditional"; readonly condition: RustExpr; readonly whenTrue: RustExpr; readonly whenFalse: RustExpr }
  | {
      readonly kind: "match";
      readonly expression: RustExpr;
      readonly arms: readonly {
        readonly pattern: RustPattern;
        readonly expression: RustExpr;
      }[];
    }
  | { readonly kind: "matches"; readonly expression: RustExpr; readonly pattern: RustPattern }
  | { readonly kind: "assignment"; readonly operator: RustAssignmentOperator; readonly target: RustExpr; readonly value: RustExpr }
  | { readonly kind: "call"; readonly path: string; readonly args: readonly RustExpr[] }
  | { readonly kind: "invoke"; readonly callee: RustExpr; readonly args: readonly RustExpr[] }
  | { readonly kind: "associated-value"; readonly owner: RustType; readonly name: string }
  | { readonly kind: "associated-call"; readonly owner: RustType; readonly trait?: RustType; readonly method: string; readonly args: readonly RustExpr[] }
  | { readonly kind: "method-call"; readonly receiver: RustExpr; readonly method: string; readonly args: readonly RustExpr[] }
  | { readonly kind: "field"; readonly receiver: RustExpr; readonly name: string }
  | { readonly kind: "index"; readonly receiver: RustExpr; readonly index: RustExpr }
  | {
      readonly kind: "block";
      readonly bindings: readonly {
        readonly name: string;
        readonly value: RustExpr;
        readonly mutable?: boolean;
        readonly attrs?: readonly string[];
      }[];
      readonly value: RustExpr;
    }
  | { readonly kind: "unsafe"; readonly expression: RustExpr }
  | { readonly kind: "evaluate-then"; readonly effect: RustExpr; readonly discard: "unit" | "value"; readonly value: RustExpr }
  | { readonly kind: "string-concat"; readonly parts: readonly RustExpr[] }
  | {
      readonly kind: "format-write";
      readonly writer: RustExpr;
      readonly format: string;
      readonly args: readonly RustExpr[];
    }
  | { readonly kind: "reference"; readonly expr: RustExpr; readonly mutable?: boolean }
  | { readonly kind: "vec-literal"; readonly elements: readonly RustExpr[] }
  | { readonly kind: "slice-literal"; readonly elements: readonly RustExpr[] }
  | { readonly kind: "closure"; readonly params: readonly { readonly name: string; readonly byRefCopy: boolean }[]; readonly move?: boolean; readonly body: RustExpr }
  | {
      readonly kind: "closure-block";
      readonly params: readonly { readonly name: string; readonly mutable: boolean; readonly byRefCopy?: boolean }[];
      readonly move: boolean;
      readonly async: boolean;
      readonly body: RustBlock;
    }
  | { readonly kind: "await"; readonly expr: RustExpr }
  | {
      readonly kind: "try";
      readonly expr: RustExpr;
      readonly errorDomain: RustErrorDomain;
    }
  | { readonly kind: "return-expression"; readonly expr?: RustExpr }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "struct-literal"; readonly path: string; readonly fields: readonly { readonly name: string; readonly value: RustExpr }[] }
  | { readonly kind: "tuple-literal"; readonly elements: readonly RustExpr[] };

export type RustErrorDomain = "runtime" | "project";

export type RustStmt =
  | { readonly kind: "let"; readonly name: string; readonly mutable: boolean; readonly type?: RustType; readonly init?: RustExpr; readonly attrs?: readonly string[] }
  | { readonly kind: "expr"; readonly expr: RustExpr }
  | { readonly kind: "assign"; readonly target: RustExpr; readonly operator: RustAssignmentOperator; readonly value: RustExpr }
  | { readonly kind: "return"; readonly expr?: RustExpr }
  | { readonly kind: "tail"; readonly expr: RustExpr }
  | { readonly kind: "if"; readonly condition: RustExpr; readonly then: RustBlock; readonly else?: RustBlock }
  | { readonly kind: "loop"; readonly label?: string; readonly body: RustBlock; readonly neverFallsThrough?: boolean }
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
      readonly tail?: true;
      readonly propagate: boolean;
      readonly dispatchReturn: boolean;
      readonly dispatchTargets: readonly {
        readonly kind: "loop" | "switch" | "label";
        readonly id: number;
        readonly label: string;
        readonly continuePrelude?: readonly RustStmt[];
      }[];
      readonly terminates: boolean;
    }
  | { readonly kind: "index-assign"; readonly receiver: RustExpr; readonly index: RustExpr; readonly value: RustExpr }
  | { readonly kind: "scope"; readonly label?: string; readonly body: RustBlock }
  | { readonly kind: "unsafe-scope"; readonly body: RustBlock }
  | { readonly kind: "throw"; readonly error: RustExpr; readonly tail?: true }
  | {
      readonly kind: "try-scope";
      readonly bodyName: string;
      readonly flowName: string;
      readonly finallyName?: string;
      readonly returnType: RustType;
      readonly fallible: boolean;
      readonly asynchronous: boolean;
      readonly body: RustBlock;
      readonly bodyFallible: boolean;
      readonly bodyTerminates: boolean;
      readonly tail?: true;
      readonly catchClause?: {
        readonly binding: string;
        readonly body: RustBlock;
        readonly fallible: boolean;
        readonly terminates: boolean;
      };
      readonly finallyClause?: {
        readonly body: RustBlock;
        readonly fallible: boolean;
        readonly terminates: boolean;
      };
      readonly propagate: boolean;
      readonly dispatchReturn: boolean;
      readonly dispatchTargets: readonly {
        readonly kind: "loop" | "switch" | "label";
        readonly id: number;
        readonly label: string;
        readonly continuePrelude?: readonly RustStmt[];
      }[];
      readonly terminates: boolean;
    };

export interface RustBlock {
  readonly innerAttrs?: readonly string[];
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

export type RustSelfParam = "ref" | "mut-ref" | "rc";

export type RustVisibility = "private" | "crate" | "public";

export interface RustStructField {
  readonly name: string;
  readonly type: RustType;
  readonly visibility: RustVisibility;
}

export interface RustImplFunction {
  readonly name: string;
  readonly visibility: RustVisibility;
  readonly attrs?: readonly string[];
  readonly isAsync?: boolean;
  readonly isUnsafe?: boolean;
  readonly fallible?: boolean;
  readonly typeParams?: readonly RustTypeParameter[];
  readonly selfParam?: RustSelfParam;
  readonly params: readonly RustFunctionParam[];
  readonly returnType?: RustType;
  readonly body: RustBlock;
}

export interface RustTraitFunction {
  readonly name: string;
  readonly attrs?: readonly string[];
  readonly isUnsafe?: boolean;
  readonly fallible?: boolean;
  readonly selfParam?: RustSelfParam;
  readonly params: readonly RustFunctionParam[];
  readonly returnType?: RustType;
}

export type RustItem =
  | {
      readonly kind: "function";
      readonly name: string;
      readonly visibility: RustVisibility;
      readonly attrs?: readonly string[];
      readonly isAsync?: boolean;
      readonly isUnsafe?: boolean;
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
      readonly visibility: RustVisibility;
      readonly type: RustType;
      readonly value: RustExpr;
    }
  | {
      readonly kind: "thread-local";
      readonly attrs?: readonly string[];
      readonly name: string;
      readonly visibility: RustVisibility;
      readonly type: RustType;
      readonly value: RustExpr;
    }
  | { readonly kind: "mod-decl"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly string[] }
  | { readonly kind: "struct"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly string[]; readonly derives: readonly string[]; readonly typeParams?: readonly RustTypeParameter[]; readonly fields: readonly RustStructField[] }
  | { readonly kind: "trait"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly string[]; readonly typeParams?: readonly RustTypeParameter[]; readonly superTraits?: readonly RustType[]; readonly functions: readonly RustTraitFunction[] }
  | { readonly kind: "impl"; readonly typeParams?: readonly RustTypeParameter[]; readonly trait?: RustType; readonly target: RustType; readonly functions: readonly RustImplFunction[] }
  | { readonly kind: "enum"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly string[]; readonly derives: readonly string[]; readonly variants: readonly { readonly name: string; readonly discriminant?: string; readonly fields?: readonly RustType[] }[] }
  | { readonly kind: "type-alias"; readonly name: string; readonly visibility: RustVisibility; readonly typeParams?: readonly RustTypeParameter[]; readonly target: RustType }
  | { readonly kind: "use"; readonly path: string; readonly alias?: string; readonly visibility?: RustVisibility };

export interface RustSourceFileModel {
  readonly headerComment: string;
  readonly innerAttrs?: readonly string[];
  readonly items: readonly RustItem[];
}

export const rustGeneratedHeaderComment = "Generated by the Tsonic Rust target. Do not edit.";

export function createRustSourceFile(
  items: readonly RustItem[],
  innerAttrs: readonly string[] = [],
): RustSourceFileModel {
  return {
    headerComment: rustGeneratedHeaderComment,
    ...(innerAttrs.length === 0 ? {} : { innerAttrs }),
    items,
  };
}
