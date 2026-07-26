import http from "node:http";
import { execFile } from "node:child_process";

const TARGET = "https://foreverealize.me";
const UA = "CCBot";
const PORT = process.env.PORT || 8787;

// Why shell out to curl instead of node:http2?
//
// Cloudflare only injects the hidden cdn-cgi/content link for clients it
// classifies as bots-to-trap, and that decision keys on the TLS + HTTP/2
// *fingerprint* combined with the source IP. From a residential IP, Node's
// http2 fingerprint is let through and gets the link. From a datacenter/VPS IP,
// Cloudflare tells Node's fingerprint apart from curl's and serves Node the
// plain (link-less) page — while curl on the exact same host still gets the
// link. Forging curl's fingerprint from Node isn't practical, so we just use
// the client that provably works on the host: curl (HTTP/2).
function h2get(urlStr) {
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      ["-s", "--http2", "-A", UA, "--max-time", "30", urlStr],
      { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (err, stdout) => {
        if (err) return reject(new Error("curl failed: " + err.message));
        resolve({ status: 200, body: stdout });
      }
    );
  });
}

// Matches the hidden content-signal anchor, e.g.
// <a href="https://foreverealize.me/cdn-cgi/content?id=...." aria-hidden="true" ...></a>
// The href is what we care about; the id changes on every request.
const CONTENT_LINK_RE =
  /<a\b[^>]*\bhref=["'](https?:\/\/[^"']*\/cdn-cgi\/content\?id=[^"']+)["'][^>]*>/i;

// Fingerprints of a Cloudflare challenge / block page — used to explain a
// missing content link (typically means this egress IP is being challenged).
const CHALLENGE_MARKERS = [
  "Just a moment",
  "challenge-platform",
  "cf_chl_opt",
  "_cf_chl",
  "Enable JavaScript and cookies to continue",
  "Attention Required",
  "Sorry, you have been blocked",
  "cf-mitigated",
];

// A plain link, not a button+script: the labyrinth pages carry a
// `Content-Security-Policy: default-src 'none'` meta tag that blocks all inline
// JS (and inline styles). Link navigation is never blocked by CSP, so href="/"
// reliably loads another page. We also strip the CSP tag below so the inline
// styling actually applies.
const POPUP = `
<a href="/" id="__another_one" style="position:fixed;bottom:16px;right:16px;z-index:2147483647;display:inline-block;text-decoration:none;cursor:pointer;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;border-radius:999px;padding:10px 18px;font-size:14px;font-weight:600;color:#fff;background:#111;box-shadow:0 4px 14px rgba(0,0,0,.35)">Another one!</a>
`;

// The labyrinth pages set `default-src 'none'` via a meta tag, which blocks our
// injected inline styles. We re-serve the page, so strip that CSP tag.
const CSP_META_RE =
  /<meta[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi;

function injectPopup(html) {
  html = html.replace(CSP_META_RE, "");
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
    // No link found. Cloudflare served the plain (link-less) page. Report what we
    // got so the cause is visible instead of a blank-looking dump.
    const markers = CHALLENGE_MARKERS.filter((m) => root.body.includes(m));
    const title = (root.body.match(/<title>([^<]*)<\/title>/i) || [])[1] || "(none)";
    const report =
      `No cdn-cgi/content link found in the response from ${TARGET}.\n` +
      `status:            ${root.status}\n` +
      `body length:       ${root.body.length}\n` +
      `<title>:           ${title}\n` +
      `challenge markers: ${markers.length ? markers.join(", ") : "none"}\n` +
      (markers.length
        ? `\n=> Cloudflare returned a challenge page for this request.\n`
        : `\n=> Plain page, no labyrinth injected. Confirm curl gets the link on this\n` +
          `   host: curl -s --http2 -A CCBot ${TARGET} | grep -c 'cdn-cgi/content?id='\n`) +
      `\n----- raw body -----\n`;
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(report + root.body);
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
