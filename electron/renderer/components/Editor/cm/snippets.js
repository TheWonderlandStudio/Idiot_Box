// cm/snippets.js — per-language snippet lists (snippetCompletion).
//
// POLICY: defaults first — jo language package khud deta hai (keywords,
// snippets, tag/property completion) wo waisa hi rehta hai. Yahan SIRF gaps
// hain: aise templates jo package me NAHI hain (duplicate labels nahi, taaki
// popup me double entries na dikhen).
//   js/ts   -> package snippets (function/for/if/class/import/interface/type)
//              already included; yahan sirf extras (log/arrow/export/comp/...)
//   html/css-> package tag+attribute / property completion already included;
//              html customs poori tarah hata diye (label collide hote)
//   python/java/cpp/php/rust/json/yaml -> package me koi snippets nahi;
//              poori lists yahin hain
//   sql     -> package keywords already included; yahan statement templates
//   md/xml  -> package me sirf HTML-tag/schema completion; templates yahin
//
// Har list tabhi active hoti hai jab uski language active ho — attach
// languages.js me language instance ke data.of({ autocomplete: source }) se hota
// hai (built-in completions bache rehte hain, merge hota hai — replace nahi).
// sql / yaml ke paas koi Language instance NAHI hai, isliye unke snippets
// data.of se SKIP hote hain (languages.js me language-swap ke sath lagte hain).

import { snippetCompletion } from "@codemirror/autocomplete";

const S = (template, label, detail, type) =>
  snippetCompletion(template, { label, detail, type: type || "snippet" });

export const SNIPPETS = {
  // Package dups hataye (function/for/if/try/import/class/interface/type) —
  // sirf extras jo package me NAHI hain.
  javascript: [
    S("console.log(${value});", "log", "console.log()"),
    S("const ${name} = (${args}) => {\n\t${body}\n};", "arrow", "arrow function"),
    S("export default ${value};", "export", "export default"),
  ],
  jsx: [
    S("console.log(${value});", "log", "console.log()"),
    S("function ${Name}(${props}) {\n\treturn (\n\t\t${jsx}\n\t);\n}", "comp", "function component"),
    S("const [${state}, set${State}] = useState(${init});", "state", "useState"),
    S("useEffect(() => {\n\t${effect}\n\treturn () => {\n\t\t${cleanup}\n\t};\n}, [${deps}]);", "effect", "useEffect"),
  ],
  typescript: [
    S("console.log(${value});", "log", "console.log()"),
  ],
  tsx: [
    S("function ${Name}(${props}: ${Props}) {\n\treturn (\n\t\t${jsx}\n\t);\n}", "comp", "typed component"),
    S("const [${state}, set${State}] = useState<${Type}>(${init});", "state", "typed useState"),
    S("interface ${Props} {\n\t${prop}: ${type};\n}", "props", "props interface"),
  ],
  python: [
    // "print" hataya — package globalCompletion me builtin hai (double entry hoti)
    S("def ${name}(${args}):\n\t${body}", "def", "function"),
    S("class ${Name}:\n\tdef __init__(self${args}):\n\t\t${body}", "class", "class"),
    S("if ${cond}:\n\t${body}", "if", "if statement"),
    S("for ${x} in ${items}:\n\t${body}", "for", "for loop"),
    S("try:\n\t${body}\nexcept ${Err} as ${e}:\n\t${handle}", "try", "try/except"),
    S("import ${module}", "import", "import"),
    S("with open(${path}) as ${f}:\n\t${body}", "with", "with open()"),
  ],
  java: [
    S("System.out.println(${value});", "sout", "println"),
    S("public static void main(String[] args) {\n\t${body}\n}", "main", "main method"),
    S("public class ${Name} {\n\t${body}\n}", "class", "class"),
    S("for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${body}\n}", "for", "for loop"),
    S("if (${cond}) {\n\t${body}\n}", "if", "if statement"),
  ],
  cpp: [
    S("#include <${header}>", "inc", "#include"),
    S("int main() {\n\t${body}\n\treturn 0;\n}", "main", "main"),
    S("std::cout << ${value} << std::endl;", "cout", "cout"),
    S("for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${body}\n}", "for", "for loop"),
    S("class ${Name} {\npublic:\n\t${body}\n};", "class", "class"),
  ],
  // html: package tag+attribute completion already included — customs hataye
  // (labels collide hote: div/a/img double dikhte). Isliye html key hi nahi hai.
  css: [
    S("${selector} {\n\t${prop}: ${value};\n}", "rule", "rule"),
    S("@media (${query}) {\n\t${body}\n}", "media", "@media"),
    S("display: flex;\nalign-items: center;\njustify-content: center;", "flex", "flex center"),
  ],
  json: [
    S("\"${key}\": \"${value}\"", "kv", "key: value"),
    S("\"${key}\": {\n\t${body}\n}", "obj", "nested object"),
    S("\"${key}\": [${items}]", "arr", "array"),
  ],
  php: [
    S("<?php\n${body}", "php", "<?php"),
    S("echo ${value};", "echo", "echo"),
    S("function ${name}(${args}) {\n\t${body}\n}", "fn", "function"),
    S("if (${cond}) {\n\t${body}\n}", "if", "if statement"),
  ],
  rust: [
    S("fn main() {\n\t${body}\n}", "main", "main"),
    S("fn ${name}(${args}) -> ${ret} {\n\t${body}\n}", "fn", "function"),
    S("let mut ${name} = ${value};", "let", "let mut"),
    S("println!(\"${fmt}\", ${args});", "print", "println!"),
    S("if ${cond} {\n\t${body}\n}", "if", "if"),
  ],
  markdown: [
    S("# ${heading}", "h1", "heading"),
    S("## ${heading}", "h2", "heading 2"),
    S("- ${item}", "ul", "list item"),
    S("1. ${item}", "ol", "numbered item"),
    S("[${text}](${url})", "link", "link"),
    S("```${lang}\n${code}\n```", "code", "fenced block"),
  ],
  sql: [
    S("SELECT ${cols} FROM ${table};", "select", "SELECT"),
    S("INSERT INTO ${table} (${cols}) VALUES (${vals});", "insert", "INSERT"),
    S("UPDATE ${table} SET ${col} = ${val} WHERE ${cond};", "update", "UPDATE"),
    S("CREATE TABLE ${name} (\n\t${col} ${type}\n);", "create", "CREATE TABLE"),
  ],
  xml: [
    S("<${tag}${attrs}>${body}</${tag}>", "tag", "element"),
    S("<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "decl", "XML prolog"),
  ],
  yaml: [
    S("${key}: ${value}", "kv", "key: value"),
    S("${key}:\n  - ${item}", "list", "list"),
  ],
};

// CompletionSource factory: sirf tab di hui language ke liye items do.
export const snippetSourceFor = (langId) => {
  const list = SNIPPETS[langId] || [];
  if (!list.length) return null;
  return () => ({ options: list });
};
