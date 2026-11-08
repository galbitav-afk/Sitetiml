// Copies ffmpeg.wasm (core + its module worker) into public/ so long uploads
// can be split in the browser. The worker must be served as-is: when bundled,
// its dynamic import of the core breaks. Runs on postinstall.
import { cpSync, mkdirSync, existsSync } from "node:fs";
const core = "node_modules/@ffmpeg/core/dist/esm";
const ff = "node_modules/@ffmpeg/ffmpeg/dist/esm";
if (existsSync(core) && existsSync(ff)) {
  mkdirSync("public/ffmpeg", { recursive: true });
  for (const f of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) cpSync(`${core}/${f}`, `public/ffmpeg/${f}`);
  for (const f of ["worker.js", "const.js", "errors.js"]) cpSync(`${ff}/${f}`, `public/ffmpeg/${f}`);
  console.log("ffmpeg copied to public/ffmpeg");
}
