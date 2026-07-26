import http from "node:http";
import http2 from "node:http2";

const TARGET = "https://foreverealize.me";
const UA = "CCBot";
const PORT = process.env.PORT || 8787;

// Cloudflare only injects the hidden cdn-cgi/content link for HTTP/2+ clients.
// Node's fetch()/undici speaks HTTP/1.1, so it never sees the link — hence this
// dedicated HTTP/2 client for the upstream requests.
function h2get(urlStr) {
  const url = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const client = http2.connect(url.origin);
    client.on("error", reject);
    const req = client.request({
      ":method": "GET",
      ":path": url.pathname + url.search,
      "user-agent": UA,
    });
    const chunks = [];
    let status;
    req.on("response", (h) => (status = h[":status"]));
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      client.close();
      resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
    });
    req.on("error", reject);
    req.end();
  });
}

// Matches the hidden content-signal anchor, e.g.
// <a href="https://foreverealize.me/cdn-cgi/content?id=...." aria-hidden="true" ...></a>
// The href is what we care about; the id changes on every request.
const CONTENT_LINK_RE =
  /<a\b[^>]*\bhref=["'](https?:\/\/[^"']*\/cdn-cgi\/content\?id=[^"']+)["'][^>]*>/i;

const POPUP = `
<div id="__another_one" style="position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <button id="__another_one_btn" style="cursor:pointer;border:0;border-radius:999px;padding:10px 18px;font-size:14px;font-weight:600;color:#fff;background:#111;box-shadow:0 4px 14px rgba(0,0,0,.35)">
    Another one!
  </button>
</div>
<script>
  document.getElementById('__another_one_btn').addEventListener('click', function () {
    location.reload();
  });
</script>
`;

function injectPopup(html) {
  const idx = html.toLowerCase().lastIndexOf("</body>");
  if (idx !== -1) return html.slice(0, idx) + POPUP + html.slice(idx);
  return html + POPUP;
}

async function handle(res) {
  // 1. Fetch the origin as CCBot over HTTP/2.
  const root = await h2get(TARGET);

  // 2. Find the hidden cdn-cgi/content link.
  const match = root.body.match(CONTENT_LINK_RE);
  if (!match) {
    // No link found — hand back the raw page as plaintext so it isn't rendered.
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(root.body);
    return;
  }

  // 3. Load that URL (also as CCBot over HTTP/2).
  const content = await h2get(match[1]);

  // 4. Inject the "Another one!" refresh popup and send it.
  res.writeHead(content.status || 200, { "content-type": "text/html; charset=utf-8" });
  res.end(injectPopup(content.body));
}

http
  .createServer((req, res) => {
    handle(res).catch((err) => {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("Upstream error: " + err.message);
    });
  })
  .listen(PORT, () => console.log(`labyrinth-explorer on http://localhost:${PORT}`));
