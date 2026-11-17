import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { promisify } from "node:util";

const chrome = process.env.CHROME_BIN || (process.platform === "win32"
  ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
  : process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");
const mimeTypes = { ".html": "text/html", ".js": "text/javascript" };
const server = createServer(async (req, res) => {
  const path = req.url === "/tests/" ? "/tests/index.html" : req.url;
  if (!/^\/(tests|src|reference)\/[\w.-]+\.(html|js)$/.test(path)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const file = await readFile(new URL(`..${path}`, import.meta.url));
    res.writeHead(200, { "Content-Type": mimeTypes[extname(path)] }).end(file);
  } catch {
    res.writeHead(404).end();
  }
});

const temp = await realpath(tmpdir());
const profile = await mkdtemp(join(temp, "ascent-browser-test-"));
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { stdout } = await promisify(execFile)(chrome, [
    "--headless", "--disable-gpu", "--no-first-run", "--dump-dom",
    "--virtual-time-budget=15000", `--user-data-dir=${profile}`,
    `http://127.0.0.1:${server.address().port}/tests/`,
  ], { timeout: 30000, windowsHide: true });
  const summary = stdout.match(/<p id="summary">([^<]*)<\/p>/)?.[1];
  const results = stdout.match(/<pre id="results">([\s\S]*?)<\/pre>/)?.[1];
  console.log(summary || "Browser did not produce a test summary");
  if (results) console.log(results);
  if (!/^[1-9]\d* passed, 0 failed$/.test(summary ?? "")) process.exitCode = 1;
} finally {
  server.close();
  const resolved = await realpath(profile);
  if (dirname(resolved) === temp) {
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
}
