// Structured Rust output model for the static-native construct set. The
// printer is the only place this model becomes text.

import type {
  RustAssignmentOperator,
  RustBinaryOperator,
  RustPrimitiveTypeName,
} from "../../target-model/syntax/tokens.js";

export type RustLifetime =
  | { readonly kind: "static" }
  | { readonly kind: "placeholder" }
  | { readonly kind: "named"; readonly name: string };

export type RustConstArgument =
  | { readonly kind: "integer"; readonly value: bigint }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "char"; readonly value: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "infer" };

export type RustGenericArgument =
  | { readonly kind: "lifetime"; readonly lifetime: RustLifetime }
  | { readonly kind: "type"; readonly type: RustType }
  | { readonly kind: "const"; readonly value: RustConstArgument }
  | {
      readonly kind: "associated-equality";
      readonly name: string;
      readonly genericArguments: readonly RustGenericArgument[];
      readonly type: RustType;
    }
  | {
      readonly kind: "associated-bounds";
      readonly name: string;
      readonly genericArguments: readonly RustGenericArgument[];
      readonly bounds: readonly RustTypeBound[];
    };

export type RustCallGenericArgument = Extract<
  RustGenericArgument,
  { readonly kind: "type" | "const" }
>;

export type RustTypeBound =
  | { readonly kind: "trait"; readonly path: string }
  | { readonly kind: "trait-type"; readonly trait: RustType }
  | { readonly kind: "lifetime"; readonly lifetime: RustLifetime }
  | {
      readonly kind: "callable";
      readonly trait: "Fn" | "FnMut" | "FnOnce";
      readonly binder: readonly RustLifetimeParameter[];
      readonly parameters: readonly RustType[];
      readonly result: RustType;
    }
  | { readonly kind: "maybe-sized" };

export interface RustLifetimeParameter {
  readonly kind: "lifetime";
  readonly name: string;
  readonly outlives: readonly RustLifetime[];
}

export interface RustOrdinaryTypeParameter {
  readonly kind: "type";
  readonly name: string;
  readonly bounds: readonly RustTypeBound[];
  readonly defaultType?: RustType;
}

export interface RustConstParameter {
  readonly kind: "const";
  readonly name: string;
  readonly type: RustType;
  readonly defaultValue?: RustConstArgument;
}

export type RustGenericParameter =
  | RustLifetimeParameter
  | RustOrdinaryTypeParameter
  | RustConstParameter;

export type RustWherePredicate =
  | {
      readonly kind: "lifetime";
      readonly lifetime: RustLifetime;
      readonly outlives: readonly RustLifetime[];
    }
  | {
      readonly kind: "type";
      readonly type: RustType;
      readonly bounds: readonly RustTypeBound[];
      readonly binder?: readonly RustLifetimeParameter[];
    };

export interface RustGenerics {
  readonly parameters: readonly RustGenericParameter[];
  readonly wherePredicates: readonly RustWherePredicate[];
}

export const emptyRustGenerics: RustGenerics = Object.freeze({
  parameters: Object.freeze([]),
  wherePredicates: Object.freeze([]),
});

export type RustType =
  | { readonly kind: "infer" }
  | { readonly kind: "primitive"; readonly name: RustPrimitiveTypeName }
  | { readonly kind: "string" }
  | { readonly kind: "str" }
  | { readonly kind: "unit" }
  | { readonly kind: "never" }
  | {
      readonly kind: "named";
      readonly path: string;
      readonly identity?: string;
      readonly genericArguments?: readonly RustGenericArgument[];
    }
  | {
      readonly kind: "qualified";
      readonly owner: RustType;
      readonly trait?: RustType;
      readonly member: string;
      readonly genericArguments?: readonly RustGenericArgument[];
    }
  | {
      readonly kind: "trait-object";
      readonly principal: RustType;
      readonly autoTraits: readonly RustType[];
      readonly lifetime?: RustLifetime;
    }
  | {
      readonly kind: "impl-trait";
      readonly bounds: readonly RustTypeBound[];
      readonly outlives: readonly RustLifetime[];
      readonly captures: readonly RustLifetime[];
    }
  | {
      readonly kind: "reference";
      readonly referent: RustType;
      readonly mutable: boolean;
      readonly lifetime?: RustLifetime;
    }
  | { readonly kind: "raw-pointer"; readonly pointee: RustType; readonly mutable: boolean }
  | { readonly kind: "fixed-array"; readonly element: RustType; readonly length: RustConstArgument }
  | { readonly kind: "slice"; readonly element: RustType }
  | {
      readonly kind: "function-pointer";
      readonly binder?: readonly RustLifetimeParameter[];
      readonly parameters: readonly RustType[];
      readonly result: RustType;
      readonly abi?: readonly string[];
      readonly isUnsafe?: boolean;
    }
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
  | { readonly kind: "char-literal"; readonly value: string }
  | { readonly kind: "string-literal"; readonly value: string }
  | { readonly kind: "str-literal"; readonly value: string }
  | { readonly kind: "owned-string-from-borrowed-str"; readonly expression: RustExpr }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "bottom"; readonly expression: RustExpr }
  | { readonly kind: "unary"; readonly operator: "-" | "!"; readonly operand: RustExpr }
  | { readonly kind: "dereference"; readonly pointer: RustExpr }
  | { readonly kind: "numeric-cast"; readonly expression: RustExpr; readonly target: RustPrimitiveTypeName }
  | { readonly kind: "binary"; readonly operator: RustBinaryOperator; readonly left: RustExpr; readonly right: RustExpr }
  | { readonly kind: "range"; readonly start: RustExpr; readonly end: RustExpr; readonly inclusive?: boolean }
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
  | { readonly kind: "call"; readonly path: string; readonly genericArguments?: readonly RustCallGenericArgument[]; readonly args: readonly RustExpr[] }
  | { readonly kind: "invoke"; readonly callee: RustExpr; readonly args: readonly RustExpr[] }
  | { readonly kind: "associated-value"; readonly owner: RustType; readonly trait?: RustType; readonly name: string }
  | { readonly kind: "associated-call"; readonly owner: RustType; readonly trait?: RustType; readonly method: string; readonly genericArguments?: readonly RustCallGenericArgument[]; readonly args: readonly RustExpr[] }
  | {
      readonly kind: "method-call";
      readonly receiver: RustExpr;
      readonly method: string;
      readonly genericArguments?: readonly RustCallGenericArgument[];
      readonly args: readonly RustExpr[];
      readonly receiverMode?: "value" | "ref" | "mut-ref";
    }
  | { readonly kind: "field"; readonly receiver: RustExpr; readonly name: string }
  | { readonly kind: "index"; readonly receiver: RustExpr; readonly index: RustExpr }
  | {
      readonly kind: "block";
      readonly innerAttrs?: readonly string[];
      readonly bindings: readonly {
        readonly name: string;
        readonly value: RustExpr;
        readonly type?: RustType;
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
      readonly resultErrorType: RustType;
      readonly operandErrorType: RustType;
    }
  | { readonly kind: "return-expression"; readonly expr?: RustExpr }
  | { readonly kind: "unreachable"; readonly message: string }
  | {
      readonly kind: "struct-literal";
      readonly path: string;
      readonly fields: readonly { readonly name: string; readonly value: RustExpr }[];
      readonly base?: RustExpr;
    }
  | { readonly kind: "tuple-literal"; readonly elements: readonly RustExpr[] };

export type {
  RustErrorDomain,
} from "../../target-model/operations/error-boundary.js";

export type RustStmt =
  | { readonly kind: "let"; readonly name: string; readonly mutable: boolean; readonly type?: RustType; readonly init?: RustExpr; readonly attrs?: readonly string[] }
  | { readonly kind: "expr"; readonly expr: RustExpr }
  | { readonly kind: "assign"; readonly target: RustExpr; readonly operator: RustAssignmentOperator; readonly value: RustExpr }
  | { readonly kind: "return"; readonly expr?: RustExpr }
  | { readonly kind: "tail"; readonly expr: RustExpr }
  | { readonly kind: "if"; readonly condition: RustExpr; readonly then: RustBlock; readonly else?: RustBlock; readonly elseIf?: true; readonly attrs?: readonly string[] }
  | { readonly kind: "loop"; readonly label?: string; readonly body: RustBlock; readonly neverFallsThrough?: boolean }
  | { readonly kind: "while"; readonly label?: string; readonly condition: RustExpr; readonly body: RustBlock; readonly attrs?: readonly string[] }
  | { readonly kind: "while-let-some"; readonly label?: string; readonly binding: string; readonly bindingMutable?: boolean; readonly expression: RustExpr; readonly body: RustBlock }
  | { readonly kind: "for"; readonly label?: string; readonly binding: string; readonly bindingMutable?: boolean; readonly iterable: RustExpr; readonly body: RustBlock; readonly attrs?: readonly string[] }
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

export type RustSelfParam =
  | { readonly kind: "value" }
  | { readonly kind: "reference"; readonly mutable: boolean; readonly lifetime?: RustLifetime }
  | { readonly kind: "rc" };

export type RustVisibility = "private" | "crate" | "public";

export interface RustStructField {
  readonly name: string;
  readonly type: RustType;
  readonly visibility: RustVisibility;
  readonly attrs?: readonly string[];
}

export interface RustImplFunction {
  readonly name: string;
  readonly visibility: RustVisibility;
  readonly attrs?: readonly string[];
  readonly isAsync?: boolean;
  readonly isUnsafe?: boolean;
  readonly errorType?: RustType;
  readonly generics: RustGenerics;
  readonly selfParam?: RustSelfParam;
  readonly params: readonly RustFunctionParam[];
  readonly returnType?: RustType;
  readonly body: RustBlock;
}

export interface RustTraitFunction {
  readonly name: string;
  readonly attrs?: readonly string[];
  readonly isUnsafe?: boolean;
  readonly errorType?: RustType;
  readonly generics: RustGenerics;
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
      readonly errorType?: RustType;
      readonly generics: RustGenerics;
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
      readonly constInitializer: boolean;
    }
  | { readonly kind: "mod-decl"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly string[] }
  | { readonly kind: "struct"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly string[]; readonly derives: readonly string[]; readonly generics: RustGenerics; readonly fields: readonly RustStructField[] }
  | { readonly kind: "trait"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly string[]; readonly generics: RustGenerics; readonly superTraits?: readonly RustType[]; readonly functions: readonly RustTraitFunction[] }
  | { readonly kind: "impl"; readonly generics: RustGenerics; readonly trait?: RustType; readonly target: RustType; readonly functions: readonly RustImplFunction[] }
  | { readonly kind: "enum"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly string[]; readonly derives: readonly string[]; readonly generics: RustGenerics; readonly variants: readonly { readonly name: string; readonly discriminant?: string; readonly fields?: readonly RustType[] }[] }
  | { readonly kind: "type-alias"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly string[]; readonly generics: RustGenerics; readonly target: RustType }
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
