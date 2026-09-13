import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFileTree, type FileTreeNode } from "../shared/file-tree";

const files = ["src/api/index.ts", "src/view/index.ts", "README.md", "../../tmp/check.js"].map(
  (path) => ({
    path,
    previousPath: null,
    additions: 1,
    deletions: 0,
    issue: null,
  }),
);
function leaves(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) => (node.index === undefined ? leaves(node.children) : [node]));
}

test("文件树按目录组织，压缩单目录链，同名文件保留原始索引", () => {
  const nodes = buildFileTree(files);
  const src = nodes.find((node) => node.name === "src")!;
  assert.deepEqual(
    src.children.map((node) => node.name),
    ["api", "view"],
  );
  assert.deepEqual(
    leaves([src]).map((node) => node.index),
    [0, 1],
  );
  assert.ok(nodes.some((node) => node.name === "../../tmp"));
  assert.deepEqual(
    leaves(nodes)
      .map((node) => node.index)
      .sort(),
    [0, 1, 2, 3],
  );
});

test("按完整路径和旧名称筛选，不区分大小写，筛选不改变文件索引", () => {
  assert.deepEqual(
    leaves(buildFileTree(files, " VIEW/INDEX ")).map((node) => node.index),
    [1],
  );
  assert.equal(leaves(buildFileTree(files, "index.ts")).length, 2);
  assert.deepEqual(buildFileTree(files, "不存在"), []);
  assert.deepEqual(
    leaves(buildFileTree([{ ...files[0], previousPath: "old.ts" }], "old")).map(
      (node) => node.path,
    ),
    [files[0].path],
  );
  assert.equal(leaves(buildFileTree([{ ...files[0], path: "/tmp/a.ts" }]))[0].path, "/tmp/a.ts");
  assert.equal(
    leaves(buildFileTree([{ ...files[0], path: "C:\\src\\a.ts" }]))[0].path,
    "C:\\src\\a.ts",
  );
});
