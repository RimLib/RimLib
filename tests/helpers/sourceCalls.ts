import { readFile } from "node:fs/promises";

import ts from "typescript";

export async function sourceCallArguments(path: string, functionName: string): Promise<string[][]> {
  const source = ts.createSourceFile(
    path,
    await readFile(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const printer = ts.createPrinter({ removeComments: true });
  const calls: string[][] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === functionName) {
      calls.push(
        node.arguments.map((argument) =>
          printer.printNode(ts.EmitHint.Expression, argument, source).replace(/\s+/g, " ").trim(),
        ),
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}
