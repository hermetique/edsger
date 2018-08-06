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
# 1 2 3
```

Function application is postfix:
```bash
do "hello, " "world" ++
# "hello, world"
```

Define functions with `==`:
```bash
0 tri == 0
n tri == n [n 1 -] tri + # square brackets are superfluous; just for visual grouping

do 100 tri
# 5050
```

Define multiple cases at once by chaining equations together:
```scheme
0 even? == 1 odd? == true
1 even? == 0 odd? == false
n even? == n 1 - odd?
n odd? == n 1 - even?
```

Quote by wrapping code in parentheses:
```bash
do (1 +)
# (3 0 0 0 1 32)
```

Unquote using the function application operator `.`:
```bash
do 1 (1 +) .
# 2
```

Define and apply an anonymous function with `\` and `->`:
```bash
do 1 2 \ a b -> b a
# 2 1
```

Anonymous functions can also have multiple cases:
```bash
do 1 \ 0 -> "zero"
       _ -> "something else"
# "something else"
```

## Data types and pattern matching

Define tagged variant types with `data`.

e.g. a boolean data type:
```haskell
data true | false
```

The type doesn't really have an explicit name, but you can pattern match on the tags `true` and `false`:
```haskell
true show == "true"
false show == "false"
```

Tags can also take arguments. e.g. an option type:
```haskell
data _ itself | nothing
```

Functions can be overloaded by just defining patterns that match on different tags.

e.g. this `map` function works on both lists and options:
```haskell
nothing f map == nothing
a itself f map == a f . itself

nil f map == nil
t h cons f map == t f map h f . cons
```

The primitive types `integer`, `number`, and `string` have corresponding unary tags, which let you match on them
as well:
```haskell
a integer f == "got an integer"
a number f == "got a number"
a string f == "got a string"
_ f == "got something else"
```

If the underscores in a data declaration are replaced with an identifier `id`, that identifier
can be used like a record field.
The compiler will automatically generate three helper functions:
- `a id` (get): extract the value of `id` field in `a`
- `a b ->id` (set): modify `a` by setting its `id` field to `b`
- `a f <-id` (update): modify `a` by applying `f` to its `id` field

For example,
```haskell
data nil | tail head cons
```
will generate partial functions `tail`, `->tail`, `<-tail`, `head`, `->head`, and `<-head` that
manipulate the first and second fields of a `cons` pair.

If the updater isn't a function of 1 argument, any other arguments that it might require
are just taken from the stack. For example,
```haskell
"a"
nil "b" cons "c" cons
(++) <-head
```
evaluates to the list `["b", "ac"]` because when applying `(++)`, `"a"` is taken from the stack and `"c"` is taken from the head of the list.

Since accessors are just autogenerated functions that perform pattern matching, they can be
overloaded as well.

e.g. with the data declarations below, `head` and `tail` work on both lists and creatures:
```haskell
data nil | tail head cons
data head body tail creature
```

## Exhaustiveness and reachability

All pattern matches must be exhaustive and reachable--the compiler automatically deduces the least general possible type that covers all the given patterns in a function definition or lambda expression and checks the patterns with respect to it.

e.g. the lambda expression below has a pattern containing the `nil` tag, so the compiler deduces that it takes a list as input and complains that the `cons` case is not handled:
```bash
bad == \ nil -> 1
# Error:
#   In a definition of `bad':
#     In a lambda expression:
#       Patterns are not exhaustive:
#         (nil)
#       The following inferred cases are not satisfied:
#         (_? _? cons?)
```
Conversely, the final pattern in this lambda expression is unreachable, since numbers include integers:
```bash
bad == \ a number -> "got number"; a integer -> "got integer"
# Error:
#   In a definition of `bad':
#     In a lambda expression:
#       Pattern (1 intvar) is unreachable.
#       Previous patterns were:
#         (1 numvar)
```

Inference is recursive--for example, the compiler infers the type "optional list whose first item (if it exists) is an integer" for the following lambda expression:
```bash
bad == \ nil 3 cons itself -> 1
# Error:
#   In a definition of `bad':
#     In a lambda expression:
#       Patterns are not exhaustive:
#         (((nil) (3 int) cons) itself)
#       The following inferred cases are not satisfied:
#         nothing?
#         (nil? itself?)
#         ((nil? (integer? ≠ 3) cons?) itself?)
#         (((_? _? cons?) integer? cons?) itself?)
```

Since new cases can be added to function definitions at any time, function definitions are only checked 
after an entire file has been imported or compiled.

e.g. trying to compile this file
```haskell
import prelude

nil bad == 1
1 bad == 1
false bad == 1
"abc" bad == 1
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
      (integer? ≠ 1)
      true?
      (string? ≠ "abc")
```

## Miscellaneous

Some unicode characters get replaced with ascii approximations during preprocessing:
- `λ` becomes `\`
- `≡` becomes `==`
- `→` becomes `->`
- `←` becomes `<-`
- `≠` becomes `/=`

A `where` clause defines local bindings:
```haskell
n fib == 1 1 n fib' instead where
  _ a instead == a
  a b 0 fib' == a b
  a b n fib' == [a b +] a [n 1 -] fib'
```

The `bytecode` keyword lets you write bytecode directly.
For example, here are definitions of the arithmetic operators:
```haskell
a number b number + == bytecode 9 2 9 1 16
a number b number * == bytecode 9 2 9 1 17
a number b number - == bytecode 9 2 9 1 18
a number b number / == bytecode 9 2 9 1 19
```

## Whitespace

Edsger is whitespace-sensitive. Most of the rules are adapted from my
[parenthesizer](https://github.com/johnli0135/parenthesizer),
with keywords and semicolons taking the place of opening and closing parentheses.

Use `node edsger.js preprocess <src>` to see how semicolons are inferred from indentation.
