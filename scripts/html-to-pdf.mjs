import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(path.join(__dirname, ".."));

const htmlFile = "compte-rendu-ubuntu-ollama-deepseek.html";
const outputPath = path.join(
  projectRoot,
  "documents",
  "compte-rendu-ubuntu-ollama-deepseek.pdf"
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

function isInsideRoot(root, candidate) {
  const r = path.resolve(root) + path.sep;
  const c = path.resolve(candidate);
  return c === path.resolve(root) || c.startsWith(r);
}

function createStaticServer(root) {
  return new Promise((resolve, reject) => {
    const server = http
      .createServer(async (req, res) => {
        try {
          const url = new URL(req.url || "/", "http://127.0.0.1");
          let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
          if (rel === "") rel = "index.html";
          const abs = path.resolve(path.join(root, rel));
          if (!isInsideRoot(root, abs)) {
            res.writeHead(403);
            return res.end("Interdit");
          }
          const stat = await fs.stat(abs).catch(() => null);
          if (!stat || !stat.isFile()) {
            res.writeHead(404);
            return res.end("Non trouvé");
          }
          const ext = path.extname(abs).toLowerCase();
          const type = MIME[ext] || "application/octet-stream";
          const data = await fs.readFile(abs);
          res.setHeader("Content-Type", type);
          res.end(data);
        } catch (e) {
          res.writeHead(500);
          res.end(String(e?.message || e));
        }
      })
      .listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const IMAGE_COUNT = 37;

async function warnIfMissingImages() {
  const imgDir = path.join(projectRoot, "img", "tp2");
  const missing = [];
  for (let i = 1; i <= IMAGE_COUNT; i++) {
    const n = String(i).padStart(2, "0");
    const png = path.join(imgDir, `${n}.png`);
    if (!(await fileExists(png))) missing.push(n);
  }
  if (missing.length) {
    console.warn(
      `Attention : ${missing.length} fichier(s) .png manquant(s) (attendu : 01.png … ${String(IMAGE_COUNT).padStart(2, "0")}.png dans img/tp2/).`
    );
    console.warn(
      `Dossier : ${path.join(projectRoot, "img", "tp2")} — puis relancez npm run pdf:compte-rendu.`
    );
  }
}

/**
 * Rétrocompat : si seul un .jpg existe pour un numéro, on pointe le .jpg (le HTML ne référence que des .png).
 */
async function patchImageExtensions(html) {
  let out = html;
  for (let i = 1; i <= IMAGE_COUNT; i++) {
    const n = String(i).padStart(2, "0");
    const pPng = path.join(projectRoot, "img", "tp2", `${n}.png`);
    const pJpg = path.join(projectRoot, "img", "tp2", `${n}.jpg`);
    if (!(await fileExists(pPng)) && (await fileExists(pJpg))) {
      out = out.split(`tp2/${n}.png`).join(`tp2/${n}.jpg`);
    }
  }
  return out;
}

function injectBaseHref(html, baseUrl) {
  if (/<base\s+href=/i.test(html)) return html;
  return html.replace(/<head(\s[^>]*)?>/i, `<head$1>\n  <base href="${baseUrl}">`);
}

await warnIfMissingImages();

const server = await createStaticServer(projectRoot);
const port = server.address().port;
const baseDocuments = `http://127.0.0.1:${port}/documents/`;

const htmlPath = path.join(projectRoot, "documents", htmlFile);
let html = await fs.readFile(htmlPath, "utf8");
html = await patchImageExtensions(html);
html = injectBaseHref(html, baseDocuments);

const browser = await puppeteer.launch({ headless: "new" });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 120000 });
  await page.pdf({
    path: outputPath,
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
  });
  console.log("PDF généré : " + outputPath);
} finally {
  await browser.close();
  server.close();
}
