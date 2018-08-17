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
n tri == n (n 1 -) tri + # parentheses are superfluous; just for visual grouping

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

Quote by wrapping code in square brackets:
```bash
do [1 +]
# [3 0 0 0 1 32]
```

Unquote using the function application operator `.`:
```bash
do 1 [1 +] .
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
data bool == true | false
```

After this declaration, you can pattern match on the tags `true` and `false`:
```haskell
true show == "true"
false show == "false"
```

You can also match on all values of some type by tagging pattern variables with the type name:
```haskell
a bool f == "got a bool" # only matches if a is true or false
```

The primitive types `integer`, `number`, `string`, and `function` have corresponding type names,
so you can match on them as well:
```haskell
_ integer f == "got an integer"
_ number f == "got a number"
"abc" f == "got the string `abc'"
_ string f == "got a string"
[1 +] f == "got a successor function"
_ function f == "got a function"
```
Pattern matching on "quoted function literals" just compares compiled bytecode.

Variant tags can also take arguments. For example, here's an option type:
```haskell
data option == _ itself | nothing
```
You can also omit the type name (`option` in this case) if you don't want to be able to pattern match
on it.

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
are taken from the stack. For example,
```haskell
"a"
nil "b" cons "c" cons
[++] <-head
```
evaluates to the list `["b", "ac"]` because when applying `[++]`, `"a"` is taken from the stack and `"c"` is taken from the head of the list.

Pattern variables prefixed by a backtick are interpreted as as-patterns:
```haskell
(a b cons) `c destruct-and-copy == a b c
nil destruct-and-copy == nil nil nil

do nil 1 cons destruct-and-copy
# nil 1 (nil 1 cons)
```

Functions can be overloaded by defining patterns that match on different tags.

e.g. this `map` function works on both lists and options:
```haskell
nothing f map == nothing
a itself f map == a f . itself

nil f map == nil
t h cons f map == t f map h f . cons
```

Internally, accessors are just autogenerated functions that perform pattern matching, so they can be
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
#       Pattern ('1 integer) is unreachable.
#       Previous patterns were:
#         ('1 number)
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

## `for` blocks

Since function overloading relies on pattern matching, it can be hard to define functions tacitly,
resulting in a lot of repeated code.
For example, the [latex](https://github.com/johnli0135/edsger/blob/master/lib/latex.eg) 
module overloads the arithmetic operators `+` `-` `*` and `/` in order to handle arithmetic on `expr` objects,
which represent LaTex expressions. These overloaded function definitions essentially just pass the objects on
to a helper function, `binop`:
```haskell
data _ _ expr

a b expr c d expr + == a b expr c d expr "+" 60 binop
a b expr c d expr - == a b expr c d expr "-" 60 binop
a b expr c d expr * == a b expr c d expr "\\cdot " 50 binop
a b expr c d expr = == a b expr c d expr "=" 100 binop
a b expr c d expr lt == a b expr c d expr "<" 70 binop
a b expr c d expr gt == a b expr c d expr ">" 70 binop
a b expr c d expr le == a b expr c d expr "\\le " 70 binop
a b expr c d expr ge == a b expr c d expr "\\ge " 70 binop
a b expr c d expr , == a b expr c d expr "," 70 binop
```

This is really repetitive, but if we could eta-reduce each definition, writing things like
```haskell
+ == "+" 60 binop
```
instead, then these definitions would match against any input, which is too broad--any future definition
of `+` would be considered an unreachable pattern.

A `for` block factors out these repetitions while leaving the function open for additional overloads:
```python
for _ _ expr
  + == "+" 60 binop
  - == "-" 60 binop
  * == "\\cdot " 50 binop
  = == "=" 100 binop
  lt == "<" 70 binop
  gt == ">" 70 binop
  le == "\\le " 70 binop
  ge == "\\ge " 70 binop
  , == "," 70 binop
```

It desugars into normal function definitions with as-patterns:
```python
_ _ expr `a _ _ expr `b + == a b "+" 60 binop
_ _ expr `a _ _ expr `b - == a b "-" 60 binop
_ _ expr `a _ _ expr `b * == a b "\\cdot " 50 binop
_ _ expr `a _ _ expr `b = == a b "=" 100 binop
_ _ expr `a _ _ expr `b lt == a b "<" 70 binop
_ _ expr `a _ _ expr `b gt == a b ">" 70 binop
_ _ expr `a _ _ expr `b le == a b "\\le " 70 binop
_ _ expr `a _ _ expr `b ge == a b "\\ge " 70 binop
_ _ expr `a _ _ expr `b , == a b "," 70 binop
```

## Miscellaneous

Some unicode characters get replaced with ascii approximations during preprocessing:
- `λ` becomes `\`
- `≡` becomes `==`
- `→` becomes `->`
- `←` becomes `<-`
- `≠` becomes `/=`
- `≤` becomes `=<`
- `≥` becomes `>=`
- Greek letters become their names (`α` becomes `alpha`, `Γ` becomes `Gamma`, etc.)

A `where` clause defines local bindings for a function definition:
```haskell
n fib == 1 1 n fib' instead where
  _ a instead == a
  a b 0 fib' == a b
  a b n fib' == (a b +) a (n 1 -) fib'
```

The `bytecode` keyword lets you write bytecode directly.
For example, here are definitions of the arithmetic operators:
```haskell
a number b number + == bytecode 9 2 9 1 16
a number b number * == bytecode 9 2 9 1 17
a number b number - == bytecode 9 2 9 1 18
a number b number / == bytecode 9 2 9 1 19
```

Code inside a `with` block will apply a given function to literals (numbers, integers, and strings)
and unbound variables (which are converted to string literals). This can be useful for defining
DSLs, since it lets you add implicit embellishments to literal values.

For example, the [latex](https://github.com/johnli0135/edsger/blob/master/lib/latex.eg) 
module uses this to define a small DSL that generates LaTeX code:
```python
import latex

do with latex
     x 2 ^ 2 / C + x der x =

# ("\\frac{\\mathrm{d}}{\\mathrm{d}x}{\\left(\\frac{{x}^{2}}{2}+C\\right)}=x" 100 expr)
```

`with` can also be useful for defining lists of literals:
```python
nil with cons 1 2 3 4 5
# (((((nil 1 cons) 2 cons) 3 cons) 4 cons) 5 cons)
```

## Whitespace

Edsger is whitespace-sensitive. Most of the rules are adapted from my
[parenthesizer](https://github.com/johnli0135/parenthesizer),
with keywords and semicolons taking the place of opening and closing parentheses.

Use `node edsger.js preprocess <src>` to see how semicolons are inferred from indentation.
