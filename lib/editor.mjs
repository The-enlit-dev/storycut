// Local caption editor: http://localhost:<port> — view, create, edit, delete, retime and style captions
// over the actual recording. Saves to captions.json (with a backup of every previous version).
import http from "node:http";
import path from "node:path";
import { createReadStream, statSync, existsSync, copyFileSync } from "node:fs";
import { loadConfig, loadStyle } from "./config.mjs";
import { projectPaths } from "./build.mjs";
import { captionCss } from "./css.mjs";
import { validateCaptions, CAPTION_STYLE_KEYS } from "./captions.mjs";
import { readJSON, writeJSON, readText, ensureDir, probe, ENGINE_DIR } from "./util.mjs";

const FONTS = ["Inter", "Montserrat", "Outfit", "Nunito", "Oswald", "League Gothic", "Archivo Black", "Space Mono", "IBM Plex Mono", "JetBrains Mono", "EB Garamond", "Playfair Display", "Source Code Pro", "Roboto", "Open Sans", "Lato", "Poppins"];

export function serveEditor(dir, { port = 4747, host = "127.0.0.1" } = {}) {
  const P = projectPaths(dir);
  const cfg = loadConfig(dir, { required: true });
  const proj = readJSON(P.project);
  const style = loadStyle(proj.style || cfg.style, cfg);
  const recFile = path.join(dir, proj.recording);
  const info = probe(recFile);
  const mime = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4" };

  const state = () => {
    const doc = readJSON(P.captions);
    const effective = { ...style.captions, ...(cfg.captions.style || {}), ...(doc.style || {}) };
    return {
      project: proj.name,
      isVideo: info.hasVideo,
      duration: info.duration,
      captions: doc,
      effectiveStyle: effective,
      styleKeys: CAPTION_STYLE_KEYS,
      fonts: FONTS,
      colors: style.colors,
      styleFonts: style.fonts,
      ground: style.colors.bg,
      words: existsSync(P.transcript) ? readJSON(P.transcript).words.map((w) => ({ t: w.text, s: w.start, e: w.end, p: w.p })) : [],
      issues: validateCaptions(doc, { maxCps: cfg.captions.maxCharsPerSecond, rangeEnd: info.duration }),
    };
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(readText(path.join(ENGINE_DIR, "editor", "index.html")));
      }
      if (req.method === "GET" && url.pathname === "/api/state") return json(res, state());
      if (req.method === "POST" && url.pathname === "/api/css") {
        const body = await readBody(req);
        return text(res, captionCss(style, { ...style.captions, ...(cfg.captions.style || {}), ...(body || {}) }), "text/css");
      }
      if (req.method === "PUT" && url.pathname === "/api/captions") {
        const doc = await readBody(req);
        if (!doc || !Array.isArray(doc.captions)) return json(res, { error: "bad document" }, 400);
        for (const c of doc.captions) {
          if (typeof c.start !== "number" || typeof c.end !== "number" || !(c.end > c.start)) return json(res, { error: `caption ${c.id}: end must be after start` }, 400);
          if (!c.words?.length) c.words = [{ text: c.text, start: c.start, end: c.end }];
        }
        doc.captions.sort((a, b) => a.start - b.start);
        const bak = ensureDir(path.join(dir, "work", "captions-history"));
        if (existsSync(P.captions)) copyFileSync(P.captions, path.join(bak, `captions-${Date.now()}.json`));
        writeJSON(P.captions, doc);
        return json(res, { ok: true, issues: validateCaptions(doc, { maxCps: cfg.captions.maxCharsPerSecond, rangeEnd: info.duration }) });
      }
      if (req.method === "GET" && url.pathname === "/media") return stream(req, res, recFile, mime[path.extname(recFile).toLowerCase()] || "application/octet-stream");
      res.writeHead(404);
      res.end("not found");
    } catch (e) {
      json(res, { error: String(e.message || e) }, 500);
    }
  });
  server.listen(port, host);
  return { server, url: `http://${host === "0.0.0.0" ? "localhost" : host}:${port}` };
}

function json(res, data, code = 200) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}
function text(res, data, type) {
  res.writeHead(200, { "content-type": type });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : null);
      } catch (e) {
        reject(e);
      }
    });
  });
}
function stream(req, res, file, type) {
  const size = statSync(file).size;
  const range = req.headers.range;
  if (range) {
    const [a, b] = range.replace("bytes=", "").split("-");
    const start = Number(a);
    const end = b ? Number(b) : size - 1;
    res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
  createReadStream(file).pipe(res);
}
