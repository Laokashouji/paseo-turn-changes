import type { Summary } from "./contracts";

export type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  index?: number;
  children: FileTreeNode[];
};

export function buildFileTree(files: Summary["files"], filter = ""): FileTreeNode[] {
  const root: FileTreeNode = { id: "root", name: "", path: "", children: [] };
  const query = filter.trim().toLocaleLowerCase();
  files.forEach((file, index) => {
    if (
      query &&
      ![file.path, file.previousPath ?? ""].some((path) => path.toLocaleLowerCase().includes(query))
    )
      return;
    const parts = file.path.replaceAll("\\", "/").split("/");
    let parent = root;
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const path = parts.slice(0, depth + 1).join("/");
      let folder = parent.children.find((node) => node.index === undefined && node.path === path);
      if (!folder) {
        folder = { id: `dir:${path}`, name: parts[depth] || "/", path, children: [] };
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({
      id: `file:${index}`,
      name: parts.at(-1) || file.path,
      path: file.path,
      index,
      children: [],
    });
  });
  function compact(nodes: FileTreeNode[]): FileTreeNode[] {
    return nodes
      .map((node) => {
        while (
          node.index === undefined &&
          node.children.length === 1 &&
          node.children[0].index === undefined
        ) {
          const child = node.children[0];
          node = { ...child, name: `${node.name}${node.name === "/" ? "" : "/"}${child.name}` };
        }
        return { ...node, children: compact(node.children) };
      })
      .sort(
        (a, b) =>
          Number(a.index !== undefined) - Number(b.index !== undefined) ||
          a.name.localeCompare(b.name),
      );
  }
  return compact(root.children);
}
