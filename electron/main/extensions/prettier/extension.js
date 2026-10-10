"use strict";

const path = require("path");
const prettier = require("prettier");

async function formatDocument(document, options) {
  const filePath = document.uri.fsPath;
  const source = document.getText();
  const fileInfo = await prettier.getFileInfo(filePath, { withNodeModules: false });
  if (fileInfo.ignored) throw new Error("File is ignored by .prettierignore");
  if (!fileInfo.inferredParser) {
    throw new Error(`Prettier does not support ${path.extname(filePath) || "this file type"}`);
  }

  const config = (await prettier.resolveConfig(filePath, { editorconfig: true })) || {};
  const formatted = await prettier.format(source, {
    ...config,
    filepath: filePath,
    tabWidth: options.tabSize,
    useTabs: !options.insertSpaces,
  });
  if (formatted === source) return [];

  return [{
    range: {
      start: { line: 0, character: 0 },
      end: document.positionAt(source.length),
    },
    newText: formatted,
  }];
}

function activate(context) {
  const command = context.ibox.commands.registerCommand(
    "prettier.formatDocument",
    () => { throw new Error("Open a text file and run Format Document from the editor."); },
    "Format Document",
    "Prettier",
  );
  const provider = context.ibox.languages.registerDocumentFormattingEditProvider(
    { scheme: "file", language: "*" },
    { provideDocumentFormattingEdits: formatDocument },
  );
  context.subscriptions.push(command, provider);
}

module.exports = { activate };
