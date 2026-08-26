// Demo extension for the ibx extension host.
// Proves: activation, command registration, completion provider registration.

const vscode = require("vscode");

exports.activate = (context) => {
  context.subscriptions.push(
    vscode.commands.registerCommand("demo.hello", () => {
      return "hello-from-demo-extension";
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "json", scheme: "file" },
      {
        provideCompletionItems() {
          return [
            new vscode.CompletionItem(
              "demoCompletion",
              vscode.CompletionItemKind.Snippet
            ),
          ];
        },
      },
      '"'
    )
  );
};

exports.deactivate = () => {};