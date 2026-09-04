// Quick verification for languageDetect.mjs — run with:
//   node electron/renderer/components/Editor/languageDetect.test.mjs
import { detectLanguageFromContent, sniffCHeader, LANG_OPTIONS } from "./languageDetect.mjs";

const cases = [
  ["shebang python", "#!/usr/bin/env python3\nprint('hi')", "python"],
  ["shebang bash", "#!/bin/bash\necho hi", "shellscript"],
  ["shebang node", "#!/usr/bin/env node\nconsole.log(1)", "javascript"],
  ["shebang ruby", "#!/usr/bin/ruby\nputs 1", "ruby"],
  ["shebang perl", "#!/usr/bin/perl\nuse strict;", "perl"],
  ["shebang pwsh", "#!/usr/bin/env pwsh\nWrite-Host hi", "powershell"],
  ["shebang Rscript", "#!/usr/bin/env Rscript\nlibrary(ggplot2)", "r"],
  ["vim modeline", "# config\n# vim: set ft=yaml :\nkey: 1", "yaml"],
  ["emacs modeline", "# -*- mode: ruby -*-\nputs 1", "ruby"],
  ["xml prolog", "<?xml version=\"1.0\"?>\n<root/>", "xml"],
  ["html doctype", "<!DOCTYPE html>\n<html>", "html"],
  ["php tag", "<?php echo 1;", "php"],
  ["bat echo", "@echo off\r\nset x=1", "bat"],
  ["dockerfile content", "FROM node:20\nRUN npm ci\nCOPY . .", "dockerfile"],
  ["makefile content", "build:\n\tgo build ./...\n", "makefile"],
  ["json doc", '{\n  "a": 1\n}', "json"],
  ["go main", "package main\n\nfunc main() {}", "go"],
  ["rust main", "fn main() {\n let mut x = 1;\n}", "rust"],
  ["java main", "public static void main(String[] a) {}", "java"],
  ["csharp", "using System;\nConsole.WriteLine(1);", "csharp"],
  ["cpp include", "#include <vector>\nint main(){}", "cpp"],
  ["sql", "SELECT a FROM t WHERE x = 1;", "sql"],
  ["lua", "local function f()\nend", "lua"],
  ["swift ui", "import SwiftUI\nstruct C: View {}", "swift"],
  ["dart flutter", "import 'package:flutter/material.dart';", "dart"],
  ["python def", "def foo():\n    import os\n", "python"],
  ["ruby block", "def foo\n  1\nend", "ruby"],
  ["shell if", "if [ -f x ]; then\necho y\nfi", "shellscript"],
  ["groovy pipeline", "pipeline {\n agent any\n}", "groovy"],
  ["handlebars", "<h1>{{title}}</h1>", "handlebars"],
  ["clojure", "(ns foo.core)\n(defn bar [])", "clojure"],
  ["markdown fence", "# T\n```js\n1\n```\n", "markdown"],
  ["rst directive", "Title\n=====\n.. note:: hi", "restructuredtext"],
  ["ini sections", "[a]\nx=1\n[b]\ny=2", "ini"],
  ["log timestamps", "2024-01-01 10:00:00 start\n2024-01-01 10:00:01 ok\n2024-01-01 10:00:02 end", "log"],
  ["powershell", "$x = 1\nWrite-Host $x", "powershell"],
  ["r assign", "df <- read.csv('a')\nlibrary(dplyr)", "r"],
  ["perl my", "my $x = 1;\nprint $x;", "perl"],
  ["vb", "Sub Main()\nDim x\nEnd Sub", "vb"],
  ["julia", "function f(x)\nreturn x\nend", "julia"],
  ["coffee arrow", "sq = (x) -> x * x", "coffeescript"],
  ["diff", "--- a\n+++ b\n@@ -1 +1 @@", "diff"],
  ["objc", "@implementation Foo\n@end", "objective-c"],
  ["razor", "@page \"/x\"\n<h1>hi</h1>", "razor"],
  ["pug doctype", "doctype html\nhtml\n head", "jade"],
  ["prose stays null", "just some plain english text here\nnothing special", null],
  ["empty stays null", "   \n  ", null],
];

let pass = 0, fail = 0;
for (const [name, input, want] of cases) {
  const got = detectLanguageFromContent(input)?.id ?? null;
  const ok = got === want && (want === null || LANG_OPTIONS.includes(got));
  if (ok) pass++;
  else { fail++; console.log(`FAIL ${name}: want=${want} got=${got}`); }
}
// C header sniffing
const hCpp = sniffCHeader("#pragma once\nclass Foo {};");
const hC = sniffCHeader("#ifndef X\nint foo(void);");
if (hCpp === "cpp") pass++; else { fail++; console.log(`FAIL h-cpp: got=${hCpp}`); }
if (hC === "c") pass++; else { fail++; console.log(`FAIL h-c: got=${hC}`); }

console.log(`\n${pass} passed, ${fail} failed (${cases.length + 2} total)`);
process.exit(fail ? 1 : 0);
