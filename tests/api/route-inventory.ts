import fs from "node:fs";
import path from "node:path";

/** All route.ts paths under src/app/api, relative to that folder. */
export function listRouteFiles(): string[] {
  const root = path.resolve(process.cwd(), "src/app/api");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === "route.ts") out.push(path.relative(root, p));
    }
  };
  walk(root);
  return out.sort();
}
