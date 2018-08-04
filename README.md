# Edsger

Concatenative programming language.

Useful scripts in this directory:
- `egi`: interactive repl (= `node edsger.js /path/to/lib/directory repl`)
- `egc <src> <dst>`: compile `<src>` to bytecode (= `node edsger.js /path/to/lib/directory compile <src> <dst>`)
- `egd <src>`: disassemble bytecode (= `node edsger.js /path/to/lib/directory disassemble <src>`)
- `eg <src>`: run compiled bytecode (= `node edsger.js /path/to/lib/directory run <src>`)

## Basics

```bash
# line comment
```

Simple values (string and numeric literals) are just pushed onto the stack.
```bash
do 1 2 3
# [1,2,3]
```

Function application is postfix:
```bash
do "hello, " "world" ++
# ["hello, world"]
```

Define functions using `≡` or `==`:
```bash
0 tri ≡ 0
n tri ≡ n [n 1 -] tri + # square brackets are superfluous; just for visual grouping

do 100 tri
# [5050]
```

Define multiple cases at once by chaining equations together:
```scheme
0 even? ≡ 1 odd? ≡ true
1 even? ≡ 0 odd? ≡ false
n even? ≡ n 1 - odd?
n odd? ≡ n 1 - even?
```

Quote by wrapping code in parentheses:
```bash
do (1 +)
# [[3,0,0,0,1,15]]
```
The output shown is the compiled bytecode.

Unquote using the function application operator `.`:
```bash
do 1 (1 +) .
# [2]
```

Define and apply an anonymous function with `λ` or `\` and `→` or `->`:
```bash
do 1 2 λ a b → b a
# [2,1]
```

Anonymous functions can also have multiple cases:
```bash
do 1 λ 0 → "zero"
       _ → "something else"
# ["something else"]
```

## Data types

Define tagged variant types with `data`.

e.g. a boolean data type:
```haskell
data true | false
```

The type doesn't really have an explicit name, but you can pattern match on the tags `true` and `false`:
```haskell
true show ≡ "true"
false show ≡ "false"
```

Tags can also take arguments. e.g. an option type:
```haskell
data _ itself | nothing
```

If the underscore is replaced with an identifier, the compiler will automatically generate accessors.

e.g. a list:
```haskell
data nil | tail head cons
```
`tail` and `head` are autogenerated partial functions that extract the first and second fields
of a `cons` pair.

The primitive types `integer`, `number`, and `string` have corresponding unary tags, which let you match on them
as well:
```haskell
a integer f ≡ "got an integer"
a number f ≡ "got a number"
a string f ≡ "got a string"
_ f ≡ "got something else"
```

Functions can be overloaded just by defining patterns that match on different tags.
e.g. this `map` function works on both lists and options:
```haskell
nothing f map ≡ nothing
a itself f map ≡ a f . itself

nil f map ≡ nil
t h cons f map ≡ t f map h f . cons
```

## Exhaustiveness

All pattern matches must be exhaustive--this isn't as strong as exhaustiveness statically typed languages,
but it does help to make sure that all cases you "intended" to consider are covered.

e.g. Changing a data declaration like
```haskell
data true | false
```
to
```haskell
data true | false | dunno
```
will raise compiler errors at the location of every function that needs to be changed in order to handle
the new case.

The compiler automatically deduces the smallest possible type that covers all patterns and checks that the patterns are exhaustive with respect to it.

e.g. the lambda expression below has a pattern containing the `nil` tag, so the compiler deduces that it takes a list as input:
```bash
bad ≡ λ nil → 1
# Error:
#   Patterns are not exhaustive:
#     (nil)
#   The following inferred cases are not satisfied:
#     (_? _? cons?)
```

Inference is recursive--the compiler infers the type "optional list of things that are probably integers" for the following function:
```bash
bad ≡ λ nil 3 cons itself → 1
# Error:
#   In a definition of `bad':
#     In a lambda expression:
#       Patterns are not exhaustive:
#         (((nil) (3 int) cons) itself)
#       The following inferred cases are not satisfied:
#         (nothing?)
#         ((nil?) itself?)?
#         (((nil?) integer? cons?) itself?)?
#         (((_? _? cons?) integer? cons?) itself?)?
```

Since new cases can be added to function definitions at any time, exhaustiveness checking for functions
only happens after an entire file has been imported or compiled.

e.g. trying to compile this file
```haskell
import prelude

nil bad ≡ 1
1 bad ≡ 1
false bad ≡ 1
"abc" bad ≡ 1
```
gives
```
Error:
  In the definition of `bad':
    Patterns are not exhaustive:
      (nil)
      (1 int)
      (false)
      (abc str)
    The following inferred cases are not satisfied:
      (_? _? cons?)
      integer??
      (true?)?
      string??
```

## Miscellaneous

A `where` clause defines local bindings:
```haskell
n fib ≡ 1 1 n fib' instead where
  _ a instead ≡ a
  a b 0 fib' ≡ a b
  a b n fib' ≡ [a b +] a [n 1 -] fib'
```

The `bytecode` keyword lets you write bytecode directly.
For example, here are definitions of the arithmetic operators:
```haskell
a number b number + ≡ bytecode 9 2 9 1 16
a number b number * ≡ bytecode 9 2 9 1 17
a number b number - ≡ bytecode 9 2 9 1 18
a number b number / ≡ bytecode 9 2 9 1 19
```

A `{lhs | rhs}` comprehension intersperses `rhs` between all but first two items of `lhs`. For example,
```haskell
data nil | tail head cons
do {nil 1 2 3 4 5 6 7 8 9 10 | cons}
```
becomes
```bash
do nil 1 cons 2 cons 3 cons 4 cons 5 cons 6 cons 7 cons 8 cons 9 cons 10 cons
# [a list from 1 to 10]
```
and
```bash
do {1 2 3 4 5 6 7 8 9 10 | + 2 *}
```
becomes
```bash
do 1 2 + 2 * 3 + 2 * 4 + 2 * 5 + 2 * 6 + 2 * 7 + 2 * 8 + 2 * 9 + 2 * 10 + 2 *
# [3560]
```

## Whitespace

Edsger is whitespace-sensitive. Most of the rules are adapted from my
[parenthesizer](https://github.com/johnli0135/parenthesizer),
with keywords and semicolons taking the place of opening and closing parentheses.

Use `node edsger.js preprocess <src>` to see how semicolons are inferred from indentation.
