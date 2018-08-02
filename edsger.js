// -------------------- lexer + preprocessor --------------------

const path = process.argv[2];
const is_num = s => !isNaN(s);
const is_str = s => typeof s === "string" || s instanceof String;
const is_space = c => /\s/.test(c);
const is_open_brace = c => c.length === 1 && /\[|\{|\(/.test(c);
const is_close_brace = c => c.length === 1 && /\)|\}|\]/.test(c);
const is_brace = c => is_open_brace(c) || is_close_brace(c);
const is_superfluous_brace = c => c === "[" || c === "]";
const terminator = ";";
const is_special = c => c === "|" || c == terminator || is_brace(c);

// String -> [Token ~ String]
function lex(s, with_coords=false) {
  let tokens = [];
  let token = "";
  let token_length = 0;
  let row = 0;
  let col = 0;
  const maybe_push = () => {
    if (token != "") {
      if (with_coords) {
        tokens.push([token, row, col - token_length]);
      } else
        tokens.push(token);
      token = "";
      token_length = 0;
    }
  };
  const push = token => {
    maybe_push();
    if (with_coords)
      tokens.push([token, row, col - token.length]);
    else
      tokens.push(token);
  }

  const states = { DEFAULT: 0, SYMBOL: 1, STRING: 2, STRESC: 3 };
  let state = states.DEFAULT;
  for (const c of s + " ") {
    switch (state) {
      case states.DEFAULT:
        if (is_space(c))
          continue;
        else if (c === "\"") {
          state = states.STRING;
          token_length = 1;
          token = c;
        } else if (is_special(c))
          push(c);
        else {
          state = states.SYMBOL;
          token = c;
          token_length = 1;
        }
        break;
      case states.SYMBOL:
        if (is_space(c)) {
          maybe_push();
          state = states.DEFAULT;
        } else if (is_special(c)) {
          push(c);
        } else {
          token += c;
          ++token_length;
        }
        break;
      case states.STRING:
        ++token_length;
        token += c;
        if (c === "\\") {
          state = states.STRESC;
        } else if (c === "\"") {
          maybe_push();
          state = states.DEFAULT;
        }
        break;
      case states.STRESC:
        ++token_length;
        token += c;
        state = states.STRING;
        break;
    }
    if (c === "\n") {
      col = 0;
      ++row;
    } else
      ++col;
  }

  return tokens;
}

// String -> String without comments and with semicolons in place of indentation
function preprocess(s) {
  let lines = s.split("\n")
               .filter(a => a.trim().length != 0)
               .map(a => a.replace(/#.+$/, ""))
               .map(a => a.replace(/\s+$/, ""))
               .map(a => [a.length - a.trim().length, a.trim()]);
  lines.push([0, ""]);

  let new_lines = [];
  let stack = [];
  const add_terminator = () => { new_lines[new_lines.length - 1] += terminator };
  const dedent = new_level => {
    while (stack.length > 0) {
      const [is_hard, level, is_eq] = stack[stack.length - 1];
      if (is_hard || level < new_level)
        break;
      add_terminator();
      stack.pop();
    }
  };
  const hard_terminate = () => {
    while (true) {
      if (stack.length === 0)
        throw "Unbalanced parenthesis";
      const [is_hard, level, is_eq] = stack.pop();
      if (is_hard)
        break;
      add_terminator();
    }
  };
  const pop = () => {
    if (stack.length > 0 && !stack[stack.length - 1][0])
      stack.pop();
  }
  const last_indent = () => stack.length > 0 ? stack[stack.length - 1][1] : 0;

  for (const [indent, line] of lines) {
    dedent(indent);
    new_lines.push("");
    for (const [token, row, col] of lex(line, with_coords=true)) {
      if (is_open_brace(token))
        stack.push([true, col + indent, false]);
      else if (is_close_brace(token))
        hard_terminate();
      else if (token === terminator)
        pop();
      else switch (token) {
        case "λ": case "\\": case "→": case "->": case "data": case "import": case "do":
        case "bytecode":
          stack.push([false, col + indent, false]);
          break;
        case "where":
          stack.push([false, last_indent(), false]);
          break;
        case "==": case "≡": {
          if (stack.length > 0) {
            let [_, __, is_eq] = stack[stack.length - 1];
            if (!is_eq)
              stack.push([false, indent, true]);
          } else
            stack.push([false, indent, true]);
        } break;
      }
      if (!is_superfluous_brace(token))
        new_lines[new_lines.length - 1] += token + " ";
    }
  }

  return new_lines.join("\n");
}

function preprocess_file(file) {
  let fs = require("fs");
  let s;
  try {
    s = fs.readFileSync(file, "utf-8");
  } catch (e) {
    console.log("Error: Couldn't open file `" + file + "'");
    process.exit();
  }
  console.log(preprocess(s));
}

// -------------------- parser --------------------

const parse_failed = result => typeof result === "string" || result instanceof String;
const pure = a => new Parser(s => [s, a]);
class Parser {
  constructor(f, name="") {
    this.f = f;
    this.name = name;
  }
  parse(s) { return this.f(s) }
  bind(f) {
    return new Parser(s => {
      let result = this.parse(s);
      if (parse_failed(result))
        return result;
      let a;
      [s, a] = result;
      return f(a).parse(s);
    });
  }
  or(q) {
    return new Parser(s => {
      let result = this.parse(s);
      if (parse_failed(result))
        return q.parse(s);
      return result;
    }).label("`" + this.name + "' or `" + q.name + "'");
  }
  left(q) {
    return this.bind(a => q.bind(_ => pure(a)))
               .label("`" + this.name + "' followed by `" + q.name + "'");
  }
  right(q) {
    return this.bind(_ => q).label("`" + this.name + "' followed by `" + q.name + "'");
  }
  guard(p, msg="guard failed") {
    return new Parser(s => {
      let result = this.parse(s);
      if (parse_failed(result))
        return result;
      let a;
      [s, a] = result;
      if (!p(a))
        return msg;
      return result;
    });
  }
  many() {
    return new Parser(s => {
      let results = [];
      while (true) {
        let result = this.parse(s);
        if (parse_failed(result))
          break;
        let a;
        [s, a] = result;
        results.push(a);
      }
      return [s, results];
    }).label("zero or more `" + this.name + "'");
  }
  terminated_by(q) {
    return new Parser(s => {
      let results = [];
      while (true) {
        if (s.length === 0)
          return "Unexpected end of input";
        let result = q.parse(s);
        if (!parse_failed(result)) {
          let _; [s, _] = result;
          break;
        }
        result = this.parse(s);
        if (parse_failed(result))
          return "Expected `" + this.name + "' but got `" + s + "'";
        let a; [s, a] = result;
        results.push(a);
      }
      return [s, results];
    }).label("zero or more `" + this.name + "' terminated by `" + q.name + "'");
  }
  separated_by(q) {
    return new Parser(s => {
      let results = [];
      while (true) {
        if (s.length === 0)
          return "Unexpected end of input";
        let a = this.parse(s);
        if (parse_failed(a))
          return "Expected `" + this.name + "' but got `" + s + "'";
        [s, a] = a;
        results.push(a);
        a = q.parse(s);
        if (parse_failed(a))
          break;
        let _; [s, _] = a;
      }
      return [s, results];
    }).label("one or more `" + this.name + "' separated by `" + q.name + "'");
  }
  some() {
    return this.many().guard(results => results.length > 0, "expected at least 1 `" + this.name + "'")
                      .label("one or more `" + this.name + "'");
  }
  label(name) {
    return new Parser(this.f, name);
  }
}

// a single term
const one = new Parser(s => s.length === 0 ? "Unexpected end of input" : [s.slice(1), s[0]]).label("token");
const term = one.guard(s => s !== terminator && s !== "where").bind(s => {
  const unescaped = s => {
    s = s.substring(1, s.length - 1);
    let result = "";
    let escaping = false;
    for (const c of s) {
      if (escaping) {
        switch (c) {
          case "n": result += "\n"; break;
          case "t": result += "\t"; break;
          case "\\": result += "\\"; break;
        }
        escaping = false;
      } else if (c === "\\")
        escaping = true;
      else
        result += c;
    }
    return result;
  };
  if (s.length === 0)
    return pure(s);
  else if (s[0] === "'")
    return pure(["var", s.substring(1)]);
  else if (s[0] === "\"")
    return pure(["str", unescaped(s)]);
  else if (is_num(s)) {
    let a = parseFloat(s);
    if (Number.isInteger(a) && !/\./.test(s))
      return pure(["int", parseInt(s)]);
    return pure(["num", a]);
  }
  return pure(s);
}).label("term");

// for recursive definitions
const rec_expr = new Parser(s => expression.parse(s));

// a unique token
const exact = token => one.guard(t => t === token).label(token);

// "data" definitions
const datadef_entry = one.guard(t => t !== terminator && t !== "|").many().label("data entry");
const datadef = exact("data").right(datadef_entry.separated_by(exact("|")))
                             .left(exact(terminator)).bind(entries =>
                pure(["data"].concat(entries))).label("data definition");

// pattern (which can show up in function definitions and in lambdas)
const pattern_terminated_by = p => term.terminated_by(p).bind(terms =>
                              pure(terms.map(a => a === "_" ? ["wild"] : a)).bind(pat =>
                              pure(["pattern"].concat(pat)))).label("pattern terminated by `" + p.name + "'");

// needed for where clause: first ; closes where clause, second ; ends statement
const double_terminator = exact(terminator).left(exact(terminator));

// compound expressions (shows up in rhs of function defs and lambdas)
const where_clause = rec_expr.terminated_by(exact("where")).bind(expr =>
                     new Parser(s => definition.parse(s)).terminated_by(double_terminator).bind(defs =>
                     pure(["expr", ["where", defs, ["expr"].concat(expr)]]))).label("where clause");
const simple_statement = rec_expr.terminated_by(exact(terminator)).bind(expr =>
                         pure(["expr"].concat(expr))).label("simple statement");
const statement = where_clause.or(simple_statement).label("statement");

// do block
const do_block = exact("do").right(rec_expr.terminated_by(exact(terminator))).bind(expr =>
                 pure(["expr"].concat(expr)));

// inline bytecode
const bytecode_block = exact("bytecode").right(one.guard(is_num).terminated_by(exact(terminator))).bind(bytes =>
                       pure(["bytecode"].concat(bytes)));

// lambda block
const lambda_char = exact("λ").or(exact("\\"));
const arrow = exact("→").or(exact("->"));
const lambda_case = pattern_terminated_by(arrow).bind(lhs =>
                    statement.bind(rhs =>
                    pure(["case", lhs, rhs])));
const lambda = lambda_char.right(lambda_case.terminated_by(exact(terminator))).bind(cases =>
               pure(["lambda"].concat(cases))).label("lambda");

// quote
const quote = exact("(").right(rec_expr.terminated_by(exact(")"))).bind(quoted =>
              pure(["quote"].concat(quoted))).label("quote");

// comprehension
const comprehension_body = rec_expr.terminated_by(exact("|")).bind(lhs =>
                           rec_expr.terminated_by(exact("}")).bind(rhs =>
                           pure([lhs, rhs])));
const comprehension_expand = sides => {
  const [lhs, rhs] = sides;
  let result = [lhs[0]];
  for (const expr of lhs.slice(1))
    result = result.concat([expr]).concat(rhs);
  return result;
}
const comprehension = exact("{").right(comprehension_body).bind(sides =>
                      pure(["expr"].concat(comprehension_expand(sides)))).label("comprehension");

// 1 subtree of expression
const expression = lambda.or(quote).or(comprehension).or(bytecode_block).or(term);

// function definition
const definition = pattern_terminated_by(exact("==").or(exact("≡"))).some().bind(pats =>
                   statement.bind(expr =>
                   pure(["def", pats, expr]))).label("definition");

// imports
const import_statement = exact("import").right(one.terminated_by(exact(terminator))).bind(imports =>
                         pure(["import"].concat(imports)));

// Parser, [Token] -> [AST] or throw, retry with `do' prefix if repl mode
const collapse = (parser, tokens, repl_mode=false) => {
  let result = parser.parse(tokens);
  if (parse_failed(result))
    throw result;
  if (result[0].length !== 0) {
    if (!repl_mode)
      throw "Couldn't completely parse input";
    return collapse(parser, ["do"].concat(tokens).concat([";"]), repl_mode=false);
  }
  return result[1];
}

// complete parser. [Token] -> [AST] or throw
const parse = (tokens, repl_mode=false) =>
                collapse(definition.or(import_statement).or(datadef).or(do_block).many(),
                         tokens, repl_mode);

// -------------------- bytecode vm --------------------

// intrinsics
const op = {
  OVERFLOW: 0,    // for opcodes > 255
  NULL: 0,        // null terminator
  FAIL: 1,        // stop execution w/ some error message
  IMMSTR: 2,      // load string
  IMMINT: 3,      // load 32-bit integer
  IMMFLOAT: 4,    // load double
  QUOTE: 5,       // load quoted program
  CLOSURE: 6,     // load closure. format:
                  //   n[byte] <n variable indices to store in closure> quoted_program
  APP: 7,         // run quoted program
  TRANSFER: 8,    // move top n items onto the symbol stack
  LOAD: 9,        // push item nth from the top of the symbol stack onto the stack proper. format:
                  //   index[byte] (1 indexed)
  DISCARD: 10,    // pop n items from symbol stack
  DUP: 11,        // duplicate top item
  SWAP: 12,       // swap top 2 items

  CASE: 13,       // case statement. format is:
  CASE_VAR: 0,    //   cases[byte] arity_per_case[byte] case1 quoted_code case2 quoted_code ..
  CASE_INT: 1,    // where each case is:
  CASE_STR: 2,    //   CASE_VAR[byte] var_id[byte] 
  CASE_FLOAT: 3,  // | CASE_INT[byte] integer[int32]
  CASE_TAG32: 4,  // | CASE_STR[byte] string (same encoding as IMMSTR)
  CASE_WILD: 5,   // | CASE_FLOAT[byte] string (same encoding as IMMFLOAT)
  CASE_INTV: 6,   // | CASE_TAG32[byte] tag_id[int32] arity[byte] <arity sub-cases>
  CASE_STRV: 7,   // | CASE_WILD[byte]
  CASE_FLOATV: 8, // | CASE_INTV[byte] var_id[byte] | CASE_STRV[byte] var_id[byte]
                  // | CASE_FLOATV[byte] var_id[byte]
                  // | tag_id[byte] arity[byte] <arity sub-cases> (for tags <= 255)
                  // var_id of 0 is a wild
                  // quoted_code is size[int32] <int32 bytes of code>

  MAKE: 14,       // make a tagged object. format is:
                  //   tag_id[byte] arity[byte]
                  // pops arity items from stack and pushes [tag_id, popped items]
  MAKE32: 15,     // like MAKE, but tag_id is an int32
                  
  ADD: 16,        // arithmetic
  MUL: 17,
  SUB: 18,
  DIV: 19,

  CAT: 20,     // string manipulation
};
let n_intrinsics = Object.keys(op).length;
let words = new Array(n_intrinsics).fill([]);
let word_map = {} // { name: bytecode index }
let primitive_tags = { "integer": op.CASE_INTV, "number": op.CASE_FLOATV, "string": op.CASE_STRV };

// vm state: stack + symbol stack + tags
let stack = [];
let symbols = [];
let tags = {}; // { name: { .id .arity } }
let imported = {}; // track imported files

// simple vm actions
function push(a) { stack.push(a) }
function pop(n=1) { return n === 0 ? [] : stack.splice(-n) }
function peek() { return stack[stack.length - 1] }
function transfer(n) { symbols = symbols.concat(stack.splice(-n)) }
function load(n) { push(symbols[symbols.length - n]) }
function discard(n=1) { return n === 0 ? [] : symbols.splice(-n) }
function dup() { push(peek()) }
function swap() { let second = stack.splice(-2, 1); stack = stack.concat(second) }
function make_tagged(tag, arity) { push([tag, pop(arity)]) }
function bind_tags(arr) {
  for (const entry of arr)
    for (const ident of entry)
      if (ident in word_map)
        throw "Enum identifier `" + ident + "' is already bound";
  const already_bound = Object.keys(tags).length + 9; // VAR, INT, STR, FLOAT, TAG32, etc, are reserved
  for (let i = 0; i < arr.length; ++i) {
    const entry = arr[i];
    const tag = entry[entry.length - 1];
    const accessors = entry.slice(0, entry.length - 1);

    // generate tag for pattern matches
    const id = i + already_bound;
    const arity = accessors.length;
    tags[tag] = { id, arity };

    // generate constructor
    const ctr = id < 256 ? [op.MAKE, id, arity] : [op.MAKE32].concat(to_int32(id)).concat([arity]);
    bind(tag, ctr);

    // generate accessors
    //console.log("accessors =", accessors);
    for (let j = 0; j < accessors.length; ++j) {
      const accessor = accessors[j];
      if (accessor === "_")
        continue; // don't bind placeholder accessors
      let pattern = [];
      for (let k = 0; k < j; ++k)
        pattern.push(["wild"]);
      pattern.push(["var", "a"]);
      for (let k = j + 1; k < accessors.length; ++k)
        pattern.push(["wild"]);
      //console.log("pattern =", pattern, "catch_all =", catch_all);
      let code = ["lambda",
        ["case", ["pattern"].concat(pattern).concat([tag]), ["expr", ["var", "a"]]],
        ["case", ["pattern", ["wild"]],
          ["expr",
            ["str", "Failed to extract `" + accessor + "'"], "fail"
          ]
        ]
      ];
      //console.log("code =", JSON.stringify(code));
      code = compile_lambda(code);
      //console.log("code =", JSON.stringify(code));
      //console.log("code =", disassemble(code));
      bind(accessor, code);
      //console.log("accessor =", accessor, "bound to", JSON.stringify(code));
    }
  }
}
function bind(name, bytes) {
  //console.log("binding =", name);
  const is_case = bytes => bytes.length > 0 && bytes[0] === op.CASE;
  if (!(name in word_map)) {
    words.push(bytes);
    word_map[name] = words.length - 1;
  } else {
    let op = word_map[name];
    if (!is_case(words[op])) // no additional branching possible
      return;
    let cases = words[op][1];
    let arity = words[op][2];
    if (!is_case(bytes)) { // simply add a catch-all case
      ++words[op][1]; // increment case count
      for (let i = 0; i < arity; ++i) // add _ _ ... → a.k.a. a catch-all
        words[op] = words[op].concat([op.CASE_WILD]);
      words[op] = words[op].concat(bytes); // add the code for the catch-all
    } else { // if the new definition is itself a case block, need to check if they are compatible
      let new_cases = bytes[1];
      let new_arity = bytes[2];
      if (new_arity !== arity) // the new case block needs to have compatible cases
        throw "Pre-existing definition has different number of arguments";
      words[op][1] += new_cases;
      words[op] = words[op].concat(bytes.slice(3)); // slice off op.CASE, cases, arity-per-case
                                                    // and just append the new cases
    }
  }
}
function unbind_all(names) {
  //console.log(disassemble(words[word_map["fib'"]]));
  //console.log("word_map");
  //console.log(disassemble(words[word_map["fib"]]));
  //console.log("unbinding =", names);
  for (const name of names)
    delete word_map[name];
}

// -------------------- bytecode helpers --------------------

// [Number] -> String
function encode(bytes) {
  return bytes.map(b => String.fromCharCode(b)).join("");
}

// String -> [Number]
function str2bytes(s) {
  let result = [];
  for (let i = 0; i < s.length; ++i)
    result.push(s.charCodeAt(i));
  return result;
}

// String -> [Number]
function decode(s) {
  return str2bytes(s);
}

function to_int32(a) {
  return [a >>> 24, (a >>> 16) & 255, (a >>> 8) & 255, a & 255];
}

function encode_string(s) {
  let bytes = str2bytes(s);
  return to_int32(bytes.length).concat(bytes);
}

function encode_tagged_value(a) {
  let [tag, values] = a;
  let encoded_values = values.map(encode_value).reduce((a, b) => a.concat(b), []);
  return encoded_values.concat([op.MAKE, tag, values.length]);
}

function encode_value(a) {
  if (Number.isInteger(a))
    return [op.IMMINT].concat(to_int32(a));
  if (is_num(a))
    return [op.IMMFLOAT].concat(encode_string(a.toString()));
  if (!Array.isArray(a))
    return [op.IMMSTR].concat(encode_string(a.toString()));
  return encode_tagged_value(a);
}

//console.log(encode_value([9,[[6,[]],[5,[]]]]));

// [var id] -> bytecode loading the value of each var
function encode_closure(refs) {
  // convert data in symbol stack to bytecode
  let header = refs.map(a => encode_value(symbols[symbols.length - a]))
                   .reduce((a, b) => a.concat(b));

  // emit lambda-case to bind the copied data
  let case_vars = [];
  for (let i = refs.length - 1; i >= 0; --i) // TODO: nasty +1???
    case_vars = case_vars.concat([op.CASE_VAR, i]);

  // 1 case with arity = refs.length
  let lambda = [op.CASE, 1, refs.length].concat(case_vars);

  return header.concat(lambda);
}

function extract_byte(bytes, i=-1) {
  return [bytes[i + 1], i + 1];
}

function extract_int32(bytes, i=-1) {
  return [
    (((((bytes[i + 1] << 8) | bytes[i + 2]) << 8) | bytes[i + 3]) << 8) | bytes[i + 4],
    i + 4
  ];
}

function extract_values_with(f) {
  return function(bytes, i=-1) {
    let values = [];
    let len;
    [len, i] = f(bytes, i);
    //console.log("len =", len, "bytes =", JSON.stringify(bytes), "i =", i);
    for (let j = 0; j < len; ++j)
      values.push(bytes[++i]);
    return [values, i];
  };
}

const extract_values = extract_values_with(extract_int32);
const extract_byte_values = extract_values_with(extract_byte);

function extract_double(bytes, i=-1) {
  let num;
  [num, i] = extract_string(bytes, i);
  if (is_num(num))
    return [parseFloat(num), i];
  else
    throw "Tried to load `" + num + "' as a floating point number";
}

function extract_instr(bytes, i=-1) {
  let b = bytes[i];
  if (b === op.OVERFLOW) {
    let index_width = bytes[++i];
    b = 0;
    for (let j = 0; j < index_width; ++j)
      b = (b << 8) + bytes[i + j + 1];
    i += index_width;
  }
  return [b, i];
}

function extract_string(bytes, i=-1) {
  let value = "";
  let len;
  [len, i] = extract_int32(bytes, i);
  for (let j = 0; j < len; ++j)
    value += String.fromCharCode(bytes[++i]);
  return [value, i];
}

function extract_pattern(arity) {
  const extract_subpattern = (bytes, i) => {
    const get = f => {
      let val;
      [val, i] = f(bytes, i);
      return val;
    };
    const head = get(extract_byte);
    switch (head) {
      case op.CASE_VAR: {
        const id = get(extract_byte) + 1;
        return [["var", id], i];
      }
      case op.CASE_STR: {
        const str = get(extract_string);
        return [["str", str], i];
      }
      case op.CASE_INT: {
        const num = get(extract_int32);
        return [["int", num], i];
      }
      case op.CASE_FLOAT: {
        const num = get(extract_double);
        return [["num", num], i];
      }
      case op.CASE_WILD:
        return [["wild"], i];
      case op.CASE_INTV: {
        const id = get(extract_byte) + 1;
        return [["intvar", id], i];
      }
      case op.CASE_STRV: {
        const id = get(extract_byte) + 1;
        return [["strvar", id], i];
      }
      case op.CASE_FLOATV: {
        const id = get(extract_byte) + 1;
        return [["numvar", id], i];
      }
      default: {
        const tag = head === op.CASE_TAG32 ? get(extract_int32) : head;
        const arity = get(extract_byte);
        const pat = get(extract_pattern(arity));
        return [[tag, pat], i];
      }
    }
  };
  return function(bytes, i=0) {
    let subpatterns = [];
    for (let j = 0; j < arity; ++j) {
      let pat;
      [pat, i] = extract_subpattern(bytes, i);
      subpatterns.push(pat);
    }
    return [subpatterns, i];
  }
}

function pattern_matches(pattern, item=undefined, accu={}) {
  // empty patterns auto-match
  if (pattern.length === 0)
    return {};

  // pattern match on the stack. pattern must be a list of subpatterns
  if (item === undefined) 
    return pattern_matches(pattern, stack.slice(-pattern.length));

  // variables match anything
  if (pattern[0] === "var") { 
    accu[pattern[1]] = item; // accumulate bindings
    return accu;
  }

  // integers
  if (pattern[0] === "int") {
    let num = parseInt(pattern[1]);
    if (!is_num(item) || num !== parseInt(item))
      return null;
    return accu;
  }

  // strings
  if (pattern[0] === "str") {
    let str = pattern[1];
    if (item !== str)
      return null;
    return accu;
  }

  // floats
  if (pattern[0] === "num") {
    let num = parseFloat(pattern[1]);
    const epsilon = 1e-6;
    if (!is_num(item) || Math.abs(num - parseFloat(item)) > epsilon)
      return null;
    return accu;
  }

  // wilds
  if (pattern[0] === "wild")
    return accu;

  // integer variables
  if (pattern[0] === "intvar") {
    if (!is_num(item) || !Number.isInteger(parseFloat(item)))
      return null;
    accu[pattern[1]] = parseInt(item);
    return accu;
  }

  // string variables
  if (pattern[0] === "strvar") {
    if (!is_str(item))
      return null;
    accu[pattern[1]] = item;
    return accu;
  }

  // float variables
  if (pattern[0] === "numvar") {
    if (!is_num(item))
      return null;
    accu[pattern[1]] = parseFloat(item);
    return accu;
  }

  // tags are just numbers > 3
  if (!isNaN(pattern[0])) {
    if (item[0] !== pattern[0]) // mismatching tags = fail
      return null;
    // matching tags = match all the parameters
    let result = pattern_matches(pattern[1], item[1], accu);
    //console.log("result =", result, "patternslice =", pattern.slice(1), item.slice(1), pattern, item);
    return result;
  }

  // two sequences
  if (pattern.length != item.length)
    return null; // mismatching sequence lengths = fail
  for (let i = 0; i < pattern.length; ++i) {
    const tmp = pattern_matches(pattern[i], item[i], accu);
    if (tmp === null)
      return null; // any item in sequence doesn't match = fail
  }
  return accu;
}

function pattern_transfer(matches) {
  for (let i = Object.keys(matches).length; i > 0; --i)
    symbols.push(matches[i]);
}

// opcode -> word name
function pretty(code) {
  for (const word in word_map)
    if (word_map[word] === code)
      return word;
  return code.toString();
}

// [Number] -> String
function disassemble(bytes, indent_by=0) {
  const indent_width = 2;

  let result = [];
  let i;
  const get = f => {
    let value;
    [value, i] = f(bytes, i);
    return value;
  }
  const go = f => put(get(f));
  const put = s => {
    if (result.length === 0)
      result.push("");
    result[result.length - 1] += s;
  };
  const brk = () => result.push("");

  for (i = 0; i < bytes.length; ++i) {
    let b;
    [b, i] = extract_instr(bytes, i);

    let n, values;
    switch (b) {
      case op.FAIL: put("FAIL"); brk(); break;
      case op.IMMSTR: put("STR "); put(JSON.stringify(get(extract_string))); brk(); break;
      case op.IMMINT: put("INT "); go(extract_int32); brk(); break;
      case op.IMMFLOAT: put("FLOAT "); go(extract_double); brk(); break;
      case op.CLOSURE: {
        put("CLOSURE ");
        const n_vars = get(extract_byte);
        for (let j = 0; j < n_vars; ++j)
          put(get(extract_byte) + " ");
        brk();
        } break;
      case op.QUOTE:
        put("QUOTE");
        values = get(extract_values);
        result = result.concat(disassemble(values, indent_by + indent_width));
        brk();
        break;
      case op.APP: put("APP"); brk(); break;
      case op.TRANSFER: put("TRANSFER "); go(extract_byte); brk(); break;
      case op.LOAD: put("LOAD "); go(extract_byte); brk(); break;
      case op.DISCARD: put("DISCARD "); go(extract_byte); brk(); break;
      case op.DUP: put("DUP"); brk(); break;
      case op.SWAP: put("SWAP"); brk(); break;
      case op.CASE: {
        put("CASE");
        const n_cases = get(extract_byte);
        const arity = get(extract_byte);
        let cases = [];
        for (let j = 0; j < n_cases; ++j) {
          const pattern = get(extract_pattern(arity));
          const action = get(extract_values);
          result = result.concat([" ".repeat(indent_width) + JSON.stringify(pattern) + " → "])
                         .concat(disassemble(action, indent_by + indent_width));
        }
        brk();
      } break;
      case op.MAKE: put("MAKE "); go(extract_byte); put(" FROM "); go(extract_byte); brk(); break;
      case op.MAKE32: put("MAKE "); go(extract_int32); put(" FROM "); go(extract_byte); brk(); break;
      case op.ADD: put("ADD"); brk(); break;
      case op.MUL: put("MUL"); brk(); break;
      case op.SUB: put("SUB"); brk(); break;
      case op.DIV: put("DIV"); brk(); break;
      case op.CAT: put("CAT"); brk(); break;
      default:
        result.push(pretty(b)); brk(); break;
    }
  }
  result = result.filter(s => s.trim() !== "").map(s => " ".repeat(indent_by) + s);
  return indent_by === 0 ? result.join("\n") : result;
}

function disassemble_header(bytes) {
  let result = [];
  let word = n_intrinsics;
  let i = 0;
  while (i < bytes.length) {
    let [size, _] = extract_int32(bytes, i - 1);
    i += 4;
    result = result.concat(word + ":")
                   .concat(disassemble(bytes.slice(i, i + size), indent_by=2));
    i += size;
    ++word;
  }
  return result.join("\n");
}

function disassemble_file(file) {
  let fs = require("fs");
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (e) {
    console.log("Error: Couldn't open file `" + file + "'");
    process.exit();
  }
  let bytes = Array.from(buffer);
  let header_size = extract_int32(bytes)[0];
  bytes = bytes.slice(4);
  console.log("---------- header (" + header_size + " bytes) ----------");
  console.log(disassemble_header(bytes.splice(0, header_size)));
  console.log("---------- code (" + bytes.length + " bytes) ----------");
  console.log(disassemble(bytes));
}

// -------------------- bytecode evaluator --------------------

// run a case statement beginning at index i in bytes
function run_case(bytes, i) {
  const get = f => {
    let value;
    [value, i] = f(bytes, i);
    return value;
  }

  const n_cases = get(extract_byte);
  const arity = get(extract_byte);
  let cases = [];
  let done = false;
  for (let j = 0; j < n_cases; ++j) {
    const pattern = get(extract_pattern(arity));
    //console.log("got pattern =", JSON.stringify(pattern), "i =", i,"extracting values...");
    const action = get(extract_values);
    const match = pattern_matches(pattern);
    //console.log("pattern =", JSON.stringify(pattern), "action =", disassemble(action), "match =", match,
    //            "stack =", JSON.stringify(stack));
    if (!done && match !== null) {
      //console.log("before apttern transfer, symbosl =", JSON.stringify(symbols));
      pattern_transfer(match);
      //console.log("after apttern transfer, symbosl =", JSON.stringify(symbols));
      pop(pattern.length);
      //console.log("running action =", disassemble(action), "on stack =", JSON.stringify(stack), "symbols =", JSON.stringify(symbols));
      run(action);
      //console.log("after action, stack =", JSON.stringify(stack));
      //console.log("before discarding", Object.keys(match).length, "items, symbols =", JSON.stringify(symbols));
      discard(Object.keys(match).length);
      //console.log("after discarding, symbols =", JSON.stringify(symbols));
      done = true;
    }
  }

  if (!done)
    throw "Non-exhaustive patterns";

  return i;
}

// evaluate bytecode
function run(bytes) {
  let i;
  const get = f => {
    let value;
    [value, i] = f(bytes, i);
    return value;
  }
  const go = f => push(get(f));
  for (i = 0; i < bytes.length; ++i) {
    let b;
    [b, i] = extract_instr(bytes, i);

    const num = () => parseFloat(pop()[0]);
    const item = () => pop()[0];
    switch (b) {
      case op.FAIL: throw pop(); break;
      case op.IMMSTR: go(extract_string); break;
      case op.IMMINT: go(extract_int32); break;
      case op.IMMFLOAT: go(extract_double); break;
      case op.CLOSURE: {
        let header = encode_closure(get(extract_byte_values));
        let code = get(extract_values);
        push(header.concat(to_int32(code.length)).concat(code));
      } break;
      case op.QUOTE: { let code = get(extract_values); push(code) } break;
      case op.APP: run(item()); break;
      case op.TRANSFER: { let n = get(extract_byte); transfer(n); } break;
      case op.LOAD: { let n = get(extract_byte); load(n); } break;
      case op.DISCARD: { let n = get(extract_byte); discard(n); } break;
      case op.DUP: dup(); break;
      case op.SWAP: swap(); break;
      case op.CASE: i = run_case(bytes, i); break;
      case op.MAKE: { let n = get(extract_byte); let m = get(extract_byte); make_tagged(n, m) } break;
      case op.MAKE32: { let n = get(extract_int32); let m = get(extract_byte); make_tagged(n, m) } break;
      case op.ADD: push(num() + num()); break;
      case op.MUL: push(num() * num()); break;
      case op.SUB: { let a = num(); let b = num(); push(b - a) } break;
      case op.DIV: { let a = num(); let b = num(); push(b / a) } break;
      case op.CAT: { let a = item(); let b = item(); push(b + a) } break;
      default:
        if (b in words) {
          run(words[b]);
        } else {
          throw "Unknown bytecode instruction " + b;
        }
        break;
    }
  }
}

function run_header(bytes) {
  let word = n_intrinsics;
  let i = 0;
  while (i < bytes.length) {
    let [size, _] = extract_int32(bytes, i - 1);
    i += 4;
    words[word] = bytes.slice(i, i + size);
    i += size;
    ++word;
  }
  //console.log("words =", JSON.stringify(words), "bytes =", JSON.stringify(bytes));
}

function run_file(file, print_stack=true) {
  let fs = require("fs");
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (e) {
    console.log("Error: Couldn't open file `" + file + "'");
    process.exit();
  }
  let bytes = Array.from(buffer);
  let header_size = extract_int32(bytes)[0];
  //console.log("header =", JSON.stringify(bytes));
  bytes = bytes.slice(4);
  run_header(bytes.splice(0, header_size));
  run(bytes);
  if (print_stack)
    print();
}

// -------------------- compiler --------------------

// helper: given an of environment, convert an identifier to an id
const to_var_id = (name, env) => {
  for (let i = 0; i < env.length; ++i)
    if (env[env.length - 1 - i] === name)
      return i;
  throw "Unbound identifier `" + name + "'";
}

// helper: check if variable is in an environment
const is_bound = (name, env) => {
  try {
    let id = to_var_id(name, env);
    return true;
  } catch (e) {
    return false;
  }
}

function compile_datadef(datadef) {
  bind_tags(datadef.slice(1));
  return [];
}

// get all bound variables in a pattern
function extract_env(pattern) {
  if (!Array.isArray(pattern)) // tag or unescaped variable
    return (pattern in tags) || (pattern in primitive_tags)
             ? []
             : [pattern];
  let head = pattern[0];
  if (["int", "num", "str", "wild"].includes(head))
    return [];

  let tail = pattern.slice(1);
  const merge = (a, b) => {
    let result = a;
    for (const c of b)
      if (!(c in result))
        result.push(c);
    return result;
  };
  if (head === "var")
    return [tail[0]];
  return tail.map(extract_env).reduce(merge, []);
}

function extract_free_lambda(e, env=[]) {
  let result = [];
  for (const c of e.slice(1)) { // for each case
    let [_, lhs, rhs] = c;
    result = result.concat(extract_free(rhs, env.concat(extract_env(lhs))));
  }
  return result;
}

// get all free variables in an expression
function extract_free(expr, env=[]) {
  let result = [];
  for (const e of expr.slice(1)) {
    if (Array.isArray(e)) {
      let head = e[0];
      let tail = e.slice(1);
      switch (head) {
        //case "where": result = result.concat(extract_free_where(e, env)); break;
        case "lambda": result = result.concat(extract_free_lambda(e, env)); break;
        case "expr": case "quote": result = result.concat(extract_free(e, env)); break;
        case "int": break;
        case "num": break;
        case "str": break;
        case "var": case "intvar": case "numvar": case "strvar":
          if (!is_bound(tail[0], env))
            result.push(tail[0]);
          break;
        default: throw "Bad AST node `" + head + "'";
      }
    } else if (!(e in word_map) && !is_bound(e, env)) // if not a word, treat as unescaped variable
        result.push(e);
  }
  return result;
}

// let s = "do a λ c a → c a";
// console.log(JSON.stringify(parse(lex(preprocess(s)))));
// console.log(extract_free(parse(lex(preprocess(s)))[0]));

function compile_pattern(pattern, env=[]) {
  let result = [];

  for (const pat of pattern.slice(1)) { // slice off "pattern" at root
    // is a tag
    if (!Array.isArray(pat)) {
      const tag = pat;

      if (tag in primitive_tags) { // primitive tags
        if (result.length === 0)
          throw "Bad pattern: primitive tag `" + tag + "' expects a variable but got nothing";
        const arg = result.pop();
        if (!Array.isArray(arg) || arg[0] !== op.CASE_VAR)
          throw "Bad pattern: primitive tag `" + tag + "' expects a variable but got " + arg; // TODO: pretty-print arg
        result.push([primitive_tags[tag], arg[1]]);
      }
      
      else if (!(tag in tags)) { // treat as unescaped variable
        result.push([op.CASE_VAR, to_var_id(tag, env)]);
      }

      // tag
      else {
        const { id, arity } = tags[tag];
        if (result.length < arity)
          throw "Bad pattern: tag `" + tag + "' expects " + arity
                                     + " arguments but is applied to "
                                     + result.length;

        const compiled_id = id < 256 ? [id] : [op.CASE_TAG32].concat(to_int32(id));
        const args = arity === 0 ? [] : result.splice(-arity);

        result.push(compiled_id.concat([arity]).concat(args));
      }
    }
    
    // variable/literal
    else {
      let head = pat[0];
      let tail = pat.slice(1);
      switch (head) {
        case "wild": result.push([op.CASE_WILD]); break;
        case "var": {
          let var_name = tail[0];
          result.push([op.CASE_VAR, to_var_id(var_name, env)]);
        } break;
        case "int": {
          let num = parseInt(tail[0]);
          result.push([op.CASE_INT].concat(to_int32(num)));
        } break;
        case "num": {
          let str = tail[0];
          result.push([op.CASE_FLOAT].concat(encode_string(str.toString())));
        } break;
        case "str": {
          let str = tail[0];
          result.push([op.CASE_STR].concat(encode_string(str)));
        } break;
        case "intvar": {
          let var_name = tail[0];
          result.push([op.CASE_INTV].concat(to_var_id(var_name, env)));
        } break;
        case "numvar": {
          let var_name = tail[0];
          result.push([op.CASE_FLOATV].concat(to_var_id(var_name, env)));
        } break;
        case "strvar": {
          let var_name = tail[0];
          result.push([op.CASE_STRV].concat(to_var_id(var_name, env)));
        } break;
      }
    }
  }

  // smush a tree into a flat array of bytes
  const flatten = a => {
    let result = [];
    for (const b of a)
      if (!Array.isArray(b))
        result.push(b);
      else
        result = result.concat(flatten(b));
    return result;
  };

  return [flatten(result), result.length];
}

function compile_case(pattern, expr, env=[]) {
  env = env.concat(extract_env(pattern));
  //console.log("extract_env gave ", extract_env(pattern));
  let [compiled_pattern, arity] = compile_pattern(pattern, env);
  let compiled_expr = compile_expr(expr, env);
  let expr_header = to_int32(compiled_expr.length);
  return [compiled_pattern.concat(expr_header).concat(compiled_expr), arity];
}

function compile_lambda(lambda, env=[]) {
  let arity = undefined;
  let result = [];

  // for each case
  for (const c of lambda.slice(1)) {
    let [_, pattern, expr] = c; // discard "case" at root
    let [compiled_case, new_arity] = compile_case(pattern, expr, env);

    if (arity === undefined)
      arity = new_arity;
    else if (arity !== new_arity)
      throw "Cases have mismatching numbers of arguments";

    result = result.concat(compiled_case);
  }

  if (arity === undefined)
    arity = 0; // necessary if there were 0 cases

  let case_count = lambda.slice(1).length;
  return [op.CASE, case_count, arity].concat(result);
}

function compile_quote(quote, env=[]) {
  let quoted = ["expr"].concat(quote.slice(1));
  let free = extract_free(quoted);
  //console.log("quoted =", JSON.stringify(quoted));
  //console.log("free =", JSON.stringify(free));
  //console.log("env =", JSON.stringify(env));

  // check for unbound identifiers
  for (const a of free)
    if (!is_bound(a, env))
      throw "Unbound variable `" + a + "'";

  // if no free identifiers, just use ordinary quote
  if (free.length === 0) {
    //console.log("quoted =", quoted);
    let bytes = compile_expr(quoted, env);
    //console.log("byets =", bytes);
    return [op.QUOTE].concat(to_int32(bytes.length)).concat(bytes);
  }

  // otherwise, construct closure
  let closure_ids = free.map(a => to_var_id(a, env) + 1) // TODO: nasty +1
  //console.log("closure_ids =", closure_ids);

  // compile the expr, pretending the closure is the whole environment
  let bytes = compile_expr(quoted, free);

  let header = [op.CLOSURE, closure_ids.length].concat(closure_ids);
  //console.log("header =", JSON.stringify(header));
  //console.log("bytes =", JSON.stringify(bytes));

  return header.concat(to_int32(bytes.length)).concat(bytes);

}

function compile_bytecode(e, env) {
  let bytes = e.slice(1).map(a => parseFloat(a));
  let invalid = bytes.filter(a => a > 255 || !Number.isInteger(a)).length;
  if (invalid > 0)
    throw "Invalid bytecode instruction `" + invalid[0] + "'";
  return bytes;
}

function compile_expr(expr, env=[]) {
  let result = [];
  for (const e of expr.slice(1)) {
    if (Array.isArray(e)) {
      let head = e[0];
      let tail = e.slice(1);
      switch (head) {
        case "where": result = result.concat(compile_where(e, env)); break;
        case "lambda": result = result.concat(compile_lambda(e, env)); break;
        case "int": result = result.concat([op.IMMINT].concat(to_int32(tail[0]))); break;
        case "num": result = result.concat([op.IMMFLOAT].concat(encode_string(tail[0].toString()))); break;
        case "str": result = result.concat([op.IMMSTR].concat(encode_string(tail[0]))); break;
        case "var": result = result.concat([op.LOAD, to_var_id(tail[0], env) + 1]); break; // TODO: nasty +1
        case "quote": result = result.concat(compile_quote(e, env)); break;
        case "expr": result = result.concat(compile_expr(e, env)); break;
        case "bytecode": result = result.concat(compile_bytecode(e, env)); break;
        default: throw "Bad AST node `" + head + "'";
      }
    } else {
      if (!(e in word_map)) { // if not a word, treat as unescaped variable
        if (!is_bound(e, env))
          throw "Unbound identifier `" + e + "'";
        else {
          result = result.concat([op.LOAD, to_var_id(e, env) + 1]); // TODO: nasty +1
          continue;
        }
      }
      let index = word_map[e];
      let index_width = Math.floor(Math.log2(index + 1) / 8);
      if (index_width > 0) {
        result.push(op.OVERFLOW);
        result.push(index_width);
        let instr = [];
        for (let i = 0; i < index_width; ++i) {
          instr.push(index & 255);
          index >>>= 8; 
        }
        result = result.concat(instr.reverse());
      } else
        result.push(index);
    }
  }
  return result;
}

function compile_def(def, return_names=false, env=[]) {
  let [_, patterns, expr] = def;
  let names = [];
  for (const pattern of patterns) {
    let true_pattern = pattern.slice(0, -1); // slice off fn name
    let name = pattern[pattern.length - 1];
    let [compiled_case, arity] = compile_case(true_pattern, expr, env);
    let bytes = [op.CASE, 1, arity].concat(compiled_case);
    bind(name, bytes);
    //console.log("binding ", name, "to", disassemble(bytes));
    names.push(name);
  }
  return return_names ? names : [];
}

function compile_where(ast, env=[]) {
  let [_, defs, expr] = ast;
  let names = [];
  for (const def of defs) {
    //console.log("got def: ", def);
    names = names.concat(compile_def(def, return_names=true, env));
  }
  //console.log("compiled all the defs. compiling expr =", expr);
  let result = compile_expr(expr, env);
  //console.log("unbinding ", names);
  unbind_all(names);
  return result;
}

function compile_import(ast, env=[]) {
  for (const im of ast.slice(1)) {
    if (!(im in imported)) {
      interpret_file(im + ".eg", search_path=true);
      imported[im] = true;
    }
  }
  return [];
}

function compile_ast_node(ast, env=[]) {
  if (!Array.isArray(ast))
    return compile_expr(["expr", ast], env);
  let head = ast[0];
  let tail = ast.slice(1);
  switch (head) {
    case "data": return compile_datadef(ast, env);
    case "def": return compile_def(ast, false, env);
    case "import": return compile_import(ast, env);
    case "expr": return compile_expr(ast, env);
    case "int": case "num": case "str": case "lambda": case "quote":
    case "bytecode":
      return compile_expr(["expr", ast], env);
  }
}

function compile(asts, env=[]) {
  let result = [];
  for (const ast of asts)
    result = result.concat(compile_ast_node(ast, env));
  return result;
}

function compile_words() {
  const compile_word = w => to_int32(w.length).concat(w);
  return words.slice(n_intrinsics).map(compile_word).reduce((a, b) => a.concat(b));
}

function compile_file(src, dest) {
  let fs = require("fs");
  let s;
  try {
    s = fs.readFileSync(src, "utf-8");
  } catch (e) {
    console.log("Error: Couldn't open file `" + src + "'");
    process.exit();
  }
  let bytes = compile(parse(lex(preprocess(s))));
  let compiled_words = compile_words();
  let header = to_int32(compiled_words.length);
  let contents = header.concat(compiled_words).concat(bytes);
  try {
    fs.writeFileSync(dest, Uint8Array.from(contents));
  } catch (e) {
    console.log("Error: Couldn't write to `" + dest + "'");
    process.exit();
  }
}

// -------------------- interpreter/repl --------------------

function print(as_comment=false) {
  const prefix = as_comment ? "# " : "";
  console.log(prefix + JSON.stringify(stack));
}

// String -> () + manipulate stack
function interpret(s, repl_mode=false) {
  let bytes = compile(parse(lex(preprocess(s)), repl_mode));
  //console.log(bytes);
  run(bytes);
  return bytes;
}

function interpret_file(src, search_path=false) {
  let fs = require("fs");
  let s;
  try {
    s = fs.readFileSync(src, "utf-8");
  } catch (e) {
    let flag = true;
    if (search_path) {
      try {
        s = fs.readFileSync(path + "/" + src, "utf-8");
      } catch (e) { flag = false }
    }
    if (!flag)
      throw "Couldn't find file `" + src + "'";
  }
  interpret(s);
}

function debug_interpret(s) {
  console.log("---------- desugared ----------");
  console.log(preprocess(s));
  console.log("---------- ast ----------");
  //console.log(JSON.stringify(lex(preprocess(s))));
  console.log(JSON.stringify(parse(lex(preprocess(s)))));
  console.log("---------- bytecode ----------");
  let bytecode = interpret(s);
  console.log(JSON.stringify(bytecode));
  console.log("---------- result ----------");
  console.log("bound:", JSON.stringify(symbols));
  console.log("words:", JSON.stringify(words));
  console.log("word_map:", JSON.stringify(word_map));
  console.log("tags:", JSON.stringify(tags));
  console.log("state:", JSON.stringify(stack));
}

function debug_repl() {
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");
  let util = require("util");
  process.stdin.on("data", s => {
    if (s.trim().length === 0) return;
    try {
      debug_interpret(s);
    } catch (e) {
      console.log("Error: " + e);
      if (e.stack !== undefined)
        console.log(e.stack);
    }
  });
}

function repl() {
  const prefix = "# ";

  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let util = require("util");
  process.stdin.on("data", s => {
    if (s.trim().length === 0)
      return;
    try {
      interpret(s, repl_mode=true);
      print(as_comment=true);
      console.log();
    } catch (e) {
      console.log("# Error: " + e);
      if (e.stack !== undefined)
        console.log(e.stack);
      console.log();
    }
  });
}

switch (process.argv[3]) {
  case "debug_repl": debug_repl(node=true); break;
  case "repl": repl(); break;
  case "compile": compile_file(process.argv[4], process.argv[5]); break;
  case "run": run_file(process.argv[4]); break;
  case "disassemble": disassemble_file(process.argv[4]); break;
  case "preprocess": preprocess_file(process.argv[4]); break;
  case "load": interpret_file(process.argv[4]); print(as_comment=true); repl(); break;
  default: break;
}

// -------------------- misc tests --------------------

//let s = `
//n fib ≡ 1 1 n fib' instead where
//  a b instead ≡ b 
//  a b 0 fib' ≡ a b
//  a b n fib' ≡ [a b +] a [n 1 -] fib'
//
//1 fib 2 fib 3 fib 4 fib 5 fib 6 fib
//`
////console.log(preprocess(s));
////console.log(where_clause.parse(lex(preprocess(s))));
//debug_interpret(s);
//print(stack);
