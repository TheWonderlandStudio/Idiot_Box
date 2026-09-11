// cm/snippets.js — per-language snippet lists (snippetCompletion).
//
// Har list tabhi active hoti hai jab uski language active ho — attach
// languages.js me language instance ke data.of({ autocomplete: src }) se hota
// hai (built-in completions bache rehte hain, merge hota hai — replace nahi).
// sql / yaml ke paas koi Language instance NAHI hai, isliye unke snippets
// data.of se SKIP hote hain (languages.js me language-swap ke sath lagte hain).

import { snippetCompletion } from "@codemirror/autocomplete";

const S = (template, label, detail, type) =>
  snippetCompletion(template, { label, detail, type: type || "snippet" });

export const SNIPPETS = {
  javascript: [
    S("console.log(${value});", "log", "console.log()"),
    S("function ${name}(${args}) {\n\t${body}\n}", "fn", "function"),
    S("const ${name} = (${args}) => {\n\t${body}\n};", "arrow", "arrow function"),
    S("if (${cond}) {\n\t${body}\n}", "if", "if statement"),
    S("for (let ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${body}\n}", "for", "for loop"),
    S("try {\n\t${body}\n} catch (${err}) {\n\t${handle}\n}", "try", "try/catch"),
    S("import ${name} from \"${module}\";", "import", "import"),
    S("export default ${value};", "export", "export default"),
  ],
  jsx: [
    S("console.log(${value});", "log", "console.log()"),
    S("function ${Name}(${props}) {\n\treturn (\n\t\t${jsx}\n\t);\n}", "comp", "function component"),
    S("const [${state}, set${State}] = useState(${init});", "state", "useState"),
    S("useEffect(() => {\n\t${effect}\n\treturn () => {\n\t\t${cleanup}\n\t};\n}, [${deps}]);", "effect", "useEffect"),
    S("import React from \"react\";", "react", "import React"),
  ],
  typescript: [
    S("console.log(${value});", "log", "console.log()"),
    S("function ${name}(${args}): ${ret} {\n\t${body}\n}", "fn", "typed function"),
    S("interface ${Name} {\n\t${prop}: ${type};\n}", "iface", "interface"),
    S("type ${Name} = ${type};", "type", "type alias"),
    S("if (${cond}) {\n\t${body}\n}", "if", "if statement"),
    S("for (let ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${body}\n}", "for", "for loop"),
  ],
  tsx: [
    S("function ${Name}(${props}: ${Props}) {\n\treturn (\n\t\t${jsx}\n\t);\n}", "comp", "typed component"),
    S("const [${state}, set${State}] = useState<${Type}>(${init});", "state", "typed useState"),
    S("interface ${Props} {\n\t${prop}: ${type};\n}", "props", "props interface"),
  ],
  python: [
    S("print(${value})", "print", "print()"),
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
  html: [
    S("<div${attrs}>\n\t${body}\n</div>", "div", "<div>"),
    S("<${tag}${attrs}>${body}</${tag}>", "tag", "element"),
    S("<a href=\"${url}\">${text}</a>", "a", "link"),
    S("<img src=\"${src}\" alt=\"${alt}\" />", "img", "image"),
    S("<button${attrs}>${text}</button>", "btn", "button"),
  ],
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
