



import { execFileSync } from "node:child_process";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const BOW = [
  ".####......####.",
  ".######..######.",
  ".##..##oo##..##.",
  ".##..##oo##..##.",
  ".##..##oo##..##.",
  ".######oo######.",
  ".####..oo..####.",
  "......####......",
  ".....##..##.....",
  "....###..###....",
  "....##....##....",
];
const INK = "#ff5c94";
const SIZE = 1024;
const CELL = 40;

const ink = [];
BOW.forEach((row, y) => [...row].forEach((cell, x) => { if (cell !== ".") ink.push({ x, y, half: cell === "o" }); }));
const origin = (key) => SIZE / 2 - (Math.min(...ink.map((p) => p[key])) + Math.max(...ink.map((p) => p[key])) + 1) * CELL / 2;
const [originX, originY] = [origin("x"), origin("y")];
const rects = ink.map(({ x, y, half }) => `<rect x="${originX + x * CELL}" y="${originY + y * CELL}" width="${CELL}" height="${CELL}"${half ? ` opacity=".5"` : ""}/>`);

const assets = path.join(import.meta.dirname, "..", "assets");
const doc = path.join(assets, "shinbo.icon");
execFileSync("mkdir", ["-p", path.join(doc, "Assets")]);
writeFileSync(path.join(doc, "Assets", "bow.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" fill="${INK}">${rects.join("")}</svg>\n`);
writeFileSync(path.join(doc, "icon.json"), `${JSON.stringify({
  fill: { "automatic-gradient": "extended-srgb:0.07059,0.07059,0.07059,1.00000" },
  groups: [{ layers: [{ "image-name": "bow.svg", name: "Bow" }], shadow: { kind: "neutral", opacity: 0.5 }, translucency: { enabled: true, value: 0.5 } }],
  "supported-platforms": { circles: ["watchOS"], squares: "shared" },
}, null, 2)}\n`);




execFileSync("/Applications/Xcode.app/Contents/Developer/usr/bin/actool", [doc, "--compile", assets, "--app-icon", "Shinbo", "--include-all-app-icons", "--output-partial-info-plist", path.join(assets, "icon.plist"), "--platform", "macosx", "--minimum-deployment-target", "12.0"], { stdio: "ignore" });
renameSync(path.join(assets, "Shinbo.icns"), path.join(assets, "shinbo.icns"));
rmSync(path.join(assets, "icon.plist"));
rmSync(path.join(assets, "Assets.car"));




const iconset = path.join(assets, "shinbo.iconset");
execFileSync("iconutil", ["-c", "iconset", path.join(assets, "shinbo.icns"), "-o", iconset]);
renameSync(path.join(iconset, "icon_128x128@2x.png"), path.join(assets, "shinbo-dock.png"));
rmSync(iconset, { recursive: true });
