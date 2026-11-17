import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";

const chrome = process.env.CHROME_BIN || (process.platform === "win32"
  ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
  : process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");
const mimeTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const { promise: completed, resolve: finish, reject: fail } = Promise.withResolvers();
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (req.method === "POST" && pathname === "/tests/result") {
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 64 * 1024) throw new Error("Browser test report too large");
      }
      const report = JSON.parse(body);
      res.writeHead(204).end();
      finish(report);
    } catch (error) {
      res.writeHead(400).end();
      fail(error);
    }
    return;
  }
  const path = pathname === "/tests/" ? "/tests/index.html" : pathname;
  if (!/^\/(tests|src|reference)\/[\w.-]+\.(html|js|css)$/.test(path)) {
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
let browser;
let browserClosed;
let timeout;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let diagnostics = "";
  browser = spawn(chrome, [
    "--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
    `http://127.0.0.1:${server.address().port}/tests/?report=1`,
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  browser.stderr.setEncoding("utf8").on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-4000);
  });
  browser.once("error", fail);
  browserClosed = new Promise((resolve) => {
    browser.once("close", (code, signal) => {
      fail(new Error(`Chrome exited before reporting results (${code ?? signal}).\n${diagnostics}`));
      resolve();
    });
  });
  timeout = setTimeout(() => {
    fail(new Error(`Timed out waiting for Chrome test results.\n${diagnostics}`));
  }, 45000);
  const { summary, results, details } = await completed;
  console.log(summary);
  if (details) console.log(details);
  if (!(results?.passed > 0 && results.failed === 0)) process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  browser?.kill();
  await browserClosed;
  server.close();
  const resolved = await realpath(profile);
  if (dirname(resolved) === temp) {
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
}
