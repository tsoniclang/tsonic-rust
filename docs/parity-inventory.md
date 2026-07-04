# C# parity inventory

Classification of every JS/Node lane relative to the C# target. Each lane
is exactly one of: implemented (positive runtime proof in the generated
Cargo bank), hard-rejected (architecture; zero-artifact proof), or blocked
by a named external contract (exact repro pinned in tests).

## Implemented

- Array: literals, index/at, length, push, includes, indexOf, join, map,
  filter, reduce, some, every, find, findIndex, findLast, findLastIndex;
  sparse lane via JsArray.
- String: length, toUpperCase, toLowerCase, includes, startsWith,
  endsWith, indexOf, slice, at, charAt, codePointAt, padStart, padEnd,
  repeat, trim, trimStart, trimEnd, concat via +, split, replace, search,
  match, matchAll (constant patterns).
- RegExp: constant literals and new RegExp with literal arguments over the
  oracle-proven subset; test, replace, split, search, global match with
  null coalescing; regexp property reads.
- Math: floor, ceil, trunc, abs, sqrt, pow (exact f64 semantics).
- JSON: parse, stringify, stringify with null replacer and closed numeric
  or string space, over the closed JsValue carrier.
- Map, Set: constructors, get/set/has/delete/add, size, SameValueZero.
  Set algebra rows (union, intersection, difference, symmetricDifference,
  isSubsetOf, isSupersetOf, isDisjointFrom) are runtime-proven and lower
  when project lib settings expose the declarations.
- Date: UTC carrier constructors, now, parse, UTC, getTime, valueOf,
  toISOString, toJSON, UTC getters.
- Node: path, os, fs, fs/promises (async signatures over synchronous file
  operations), process (cwd, exit, value exports, env with null-preserving
  reads, fallible execPath property), Buffer, URL, URLSearchParams, legacy
  url.parse/format with the UrlObject carrier, crypto (randomUUID,
  randomBytes, createHash, createHmac), util (closed string helpers,
  inspect over closed JsValue, format with closed placeholders).
- Error model, async/await, callbacks, tuples, fixed arrays, records,
  string-literal unions, generics, statics — see README.

## Hard-rejected by architecture

- Open reflection and dynamic member access; eval and embedded engines.
- Dynamic RegExp patterns and constructs outside the oracle subset (lazy
  quantifiers, backreferences, lookaround, named groups, word-boundary
  assertions, unicode property escapes, flags d s u v y).
- JSON replacer functions and custom toJSON dispatch.
- Math lanes whose Rust semantics differ from JS (round, min, max, random).
- Process termination side effects beyond exit(code).

## Blocked by named external contracts

- Discriminated-union narrowing: requires public TSTS narrowing facts
  (repro pinned in test/r8-completion.test.mjs).
- Locale string operations, normalization: requires an ICU contract.
- Local-timezone Date lanes: requires a tzdata contract.
- Streams, fs.watch, event subscriptions: requires stream/event carrier
  contracts.
- Fixed-size arrays beyond homogeneous tuples: requires source-core
  length facts.
- RegExp exec and non-global match result consumption (the match-result
  carrier and its member rows exist): requires optional-chaining or
  option-narrowing lanes for nullable object results.
- String.matchAll consumption: requires iterator carrier lanes.
