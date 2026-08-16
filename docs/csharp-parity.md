# Rust target parity with the C# target

The goal is the broadest exact compilation of valid TypeScript that the target
language can faithfully represent. C# is the mature target and therefore the
implementation baseline, not a license to copy CLR-specific mechanics into
Rust. The machine-checked lane list is `docs/csharp-parity-lanes.json`; the
detailed JavaScript and Node surface inventory remains in
`docs/parity-lanes.json`.

## Classification

- `implemented`: a positive Rust target or generated-Cargo proof exists.
- `implementation-gap`: C# proves the source behavior and Rust has sufficient
  shared evidence, but its target model or lowering is incomplete.
- `contract-gap`: exact lowering needs new target-neutral evidence or a new
  Rust provider contract. The backend must not infer the missing meaning.
- `target-limit`: a faithful implementation needs machinery the Rust target
  deliberately does not possess, or the Rust toolchain exposes no ordinary
  callable contract. The lane stays precisely rejected.
- `shared-rejection`: neither target supports the behavior under the approved
  source-to-source architecture.

## Current architecture

```text
TypeScript source
      |
      v
TSTS selected source semantics
      |
      v
shared Tsonic navigation + artifact contracts
      |
      v
Rust target facts and provider relations
      |
      v
Rust planner -> Rust AST -> printer -> Cargo
```

For example:

```ts
import { HashMap } from "@tsonic/rust/std/collections.js";

const values = new HashMap<string, int32>();
values.insert("answer", 42);
```

TSTS selects the exact virtual constructor and `insert` declaration. Shared
navigation supplies source identity and dependency edges. Rust target
semantics closes `HashMap<string, int32>` and the selected method ABI. The
planner emits a `std::collections::HashMap<String, i32>` value and the selected
Rust call. No phase matches `HashMap` or `insert` by spelling.

## What is already at parity

The difficult execution spine is implemented: ordinary and async functions,
classes, private fields, inheritance and interface dispatch, closures,
optional chains, loops and switch fallthrough, try/catch/finally, synchronous
and asynchronous iteration, bidirectional generators, `yield*`, explicit
resource management, typed locations, raw pointers, and explicit unsafe
regions. These lanes have generated-Cargo or runtime proofs named by the JSON
inventory.

For example, this is not a planned feature; it is a proved Rust lane:

```ts
function* exchange(): Generator<int32, string, int32> {
  const received = yield 1;
  return String(received);
}
```

The generated program preserves `next(value)`, completion, `return(value)`,
`throw(error)`, lazy execution, and cleanup behavior through the target-owned
generator protocol.

## Implementation closure

Default export expressions and source-ordered class static blocks are
implemented and proved by `test/module-and-class-initialization-parity.test.mjs`.
Source-ordered object spread is implemented and proved by
`test/object-construction-parity.test.mjs`. The remaining source-language
closure is ordered by architectural dependency:

1. Class initialization: define the source contract for uninitialized
   target-native static fields before choosing a Rust default.
2. Object construction: close method reads, writes, and spread over the exact
   callable storage now shared by method syntax, function expressions, and
   arrow-valued members.
3. Declaration contracts: close interface index signatures and propagate
   finite generic virtual specializations through open generic callers.
4. Provider breadth: replace the tiny hand-maintained Rust standard-library
   catalog with requested compiler-backed exports, then close representable
   generic bounds, mutable statics, C variadics, and unions.
5. Shared contracts: specify borrowed results, custom receivers, associated
   items, and fixed-array lengths at their owning layer.
6. Surface closure: execute every blocked row in `docs/parity-lanes.json`.

Object-literal method syntax and direct callable-valued properties are already
closed through the same selected contextual contract. For example:

```ts
const counter: Counter = {
  value: 1,
  next: function (delta) {
    this.value += delta;
    return this.value;
  },
};
```

TSTS selects the exact `Counter.next` declaration. Rust stores a callable whose
explicit receiver slot is populated only by a method call; an arrow-valued
member receives an ignored receiver slot and therefore retains lexical `this`.
The target does not classify either form from the `next` spelling.

### Default export example

```ts
// settings.ts
export default loadSettings();

// main.ts
import settings from "./settings.js";
consume(settings);
```

The expression runs once during `settings.ts` module initialization. The
default import reads that exact initialized module binding. A generated Rust
constant is insufficient because `loadSettings()` may have effects; a name
guess is unsound because the export assignment has no authored identifier.

### Static initialization example

```ts
class Registry {
  static first = mark(1);
  static { mark(2); }
  static last = mark(3);
}
```

Rust must run `mark(1)`, `mark(2)`, and `mark(3)` in that order during the
owning module's initialization. Planning fields in one pass and blocks in a
second pass would be wrong even if each fragment were individually valid.

### Object spread example

```ts
const next: Point = { ...source(), x: replacement() };
```

`source()` executes once, its selected fields are copied in source order, and
`replacement()` overwrites `x` afterward. The required fact is a sequence of
exact literal contributions, not only the final field set.

### Generic virtual example

```ts
class Base {
  identity<T>(value: T): T { return value; }
}

const base: Base = new Derived();
base.identity<int32>(1);
base.identity<string>("one");
```

Rust cannot place a generic method in a `dyn` trait. The project is closed,
however, and TSTS supplies both selected instantiations. Rust now emits two
object-safe slots whose parameter and result carriers are specialized from
those exact selected type arguments. Overrides, interface dispatch, and
`super` calls use the same closed specialization plan; no value is erased into
a dynamic carrier and no type argument is inferred from spelling.

The remaining case is an open generic caller:

```ts
function call<T>(base: Base, value: T): T {
  return base.identity<T>(value);
}

call<int32>(base, 1);
call<string>(base, "one");
```

Here the virtual call is open while `call` is checked, but the complete project
still has two finite instantiations. The callable dependency graph must carry
those instantiations into `call` before dynamic-dispatch slots are finalized.
Until that closure exists, Rust rejects at the finite-specialization boundary
rather than guessing or using a boxed universal value.

## Acceptance

Each implementation-gap row must end in:

1. a positive generated-Cargo proof using real TypeScript source;
2. negative evidence tests for absent, conflicting, or ambiguous facts;
3. no checker re-entry, spelling inference, raw AST probing, or compatibility
   path;
4. deterministic diagnostics for the remaining target and contract limits;
5. the complete bounded target suite, Rust Pudding, and Tsumo Rust gates.
