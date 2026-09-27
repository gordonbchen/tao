import { cpSync, mkdirSync, rmSync } from "node:fs";

mkdirSync("public", { recursive: true });
rmSync("public/mathjax", { recursive: true, force: true });
cpSync("node_modules/mathjax", "public/mathjax", { recursive: true });
rmSync("public/mathjax-font", { recursive: true, force: true });
cpSync("node_modules/@mathjax/mathjax-newcm-font", "public/mathjax-font", { recursive: true });
