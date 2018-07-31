# Edsger

Concatenative programming language.

Useful scripts in this directory:
- `egi`: interactive repl (= `node edsger.js repl`)
- `egc <src> <dst>`: compile `<src>` to bytecode (= `node edsger.js compile <src> <dst>`)
- `egd <src>`: disassemble bytecode (= `node edsger.js disassemble <src>`)
- `eg <src>`: run compiled bytecode (= `node edsger.js run <src>`)

# Basics

```python
# line comment
```

Simple values (string and numeric literals) are pushed onto the stack:
```python
1 2 3
# [1,2,3]
```

Function application is postfix:
```bash
"hello, " "world" ++
# ["hello, world"]
```

# Functions

Define functions using `≡` or `==`:
```python
0 tri ≡ 0
n tri ≡ n [n 1 -] tri + # square brackets are superfluous; just for visual grouping

100 tri
# [5050]
```

Define multiple cases at once by chaining equations together:
```scheme
0 even? ≡ 1 odd? ≡ true
1 even? ≡ 0 odd? ≡ false
n even? ≡ n 1 - odd?
n odd? ≡ n 1 - even?
```

Quote by wrapping code in parentheses (the output shown is the compiled bytecode):
```python
(1 +)
# [[3,0,0,0,1,15]]
```

Unquote using the function application operator `.`:
```python
1 (1 +) .
# [2]
```

Define and apply an anonymous function with `λ` or `\` and `→` or `->`:
```python
1 2 λ a b → b a
# [2,1]
```

Anonymous functions can also have multiple cases:
```python
1 λ 0 → "zero"
    _ → "something else"
# ["something else"]
```

## Custom data types

Define tagged variant "types" with `data` (they're really just pairs of the form `[tag, values]`).

e.g. a boolean data type (after this declaration, `true` and `false` will push their corresponding tagged pairs onto the stack):
```haskell
data true | false
```

Custom data types can also be used in pattern matching:
```haskell
true show ≡ "true"
false show ≡ "false"
```

Tags can also take arguments. e.g. an option type:
```haskell
data _ itself | nothing
```

If the underscore is replaced with an identifier, the compiler will automatically generate accessors.

e.g. a list. `tail` and `head` are autogenerated partial functions that extract the first and second fields
of a `cons` pair.
```haskell
data nil | tail head cons
```

## Miscellaneous sugar

A `where` clause defines local bindings:
```haskell
n fib ≡ 1 1 n fib' instead where
  _ a instead ≡ a
  a b 0 fib' ≡ a b
  a b n fib' ≡ [a b +] a [n 1 -] fib'
```

A `{lhs|rhs}` comprehension intersperses an expression on the rhs between all but first two items of lhs. For example,
```haskell
data nil | tail head cons
{nil 1 2 3 4 5 6 7 8 9 10 | cons}
```
becomes
```python
nil 1 cons 2 cons 3 cons 4 cons 5 cons 6 cons 7 cons 8 cons 9 cons 10 cons
# [a list from 1 to 10]
```
and
```python
{1 2 3 4 5 6 7 8 9 10 | + 2 *}
```
becomes
```python
1 2 + 2 * 3 + 2 * 4 + 2 * 5 + 2 * 6 + 2 * 7 + 2 * 8 + 2 * 9 + 2 * 10 + 2 *
# [3560]
```

# Whitespace

Edsger is whitespace-sensitive. Most of the rules are adapted from my
[parenthesizer](https://github.com/johnli0135/parenthesizer),
with keywords and semicolons taking the place of opening and closing parentheses.

Use `node edsger.js preprocess <src>` to see how semicolons are inferred from indentation.
