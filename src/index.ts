import TurndownService from "turndown";

const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1)/i;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    try {
      const { searchParams } = new URL(request.url);
      const target = searchParams.get("url");
      const regexParam = searchParams.get("regex");

      if (!target) {
        return new Response("Missing `url` param", { status: 400 });
      }

      // Validate URL
      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
        if (!["http:", "https:"].includes(targetUrl.protocol)) throw new Error();
      } catch {
        return new Response("Invalid `url` param", { status: 400 });
      }

      if (BLOCKED_HOSTS.test(targetUrl.hostname)) {
        return new Response("Forbidden target", { status: 403 });
      }

      // Fetch remote page
      const remoteResponse = await fetch(targetUrl.toString(), {
        method: request.method,
        redirect: "follow",
      });

      // ── No regex → plain proxy ──────────────────────────────────────────
      if (!regexParam) {
        const headers = new Headers(remoteResponse.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(remoteResponse.body, {
          status: remoteResponse.status,
          headers,
        });
      }

      // ── regex present → extract + convert to Markdown ───────────────────
      let filterRegex: RegExp;
      try {
        filterRegex = new RegExp(regexParam, "gis");
      } catch {
        return new Response("Invalid `regex` param", { status: 400 });
      }

      const html = await remoteResponse.text();
      const matches = [...html.matchAll(filterRegex)];

      if (matches.length === 0) {
        return new Response("No matches found", { status: 404 });
      }

      const matchedHtml = matches.map((m) => m[0]).join("\n");

      // Turndown: flatten everything to plain readable Markdown text
      const td = new TurndownService({
        headingStyle: "atx",          // # H1, ## H2 ...
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
      });

      // Tables → plain text rows (no | pipes |)
      td.addRule("table-to-text", {
        filter: ["table"],
        replacement(_, node) {
          const rows: string[] = [];
          (node as HTMLElement).querySelectorAll("tr").forEach((tr) => {
            const row = Array.from(tr.querySelectorAll("th, td"))
              .map((c) => c.textContent?.trim() ?? "")
              .filter(Boolean)
              .join("  ");
            if (row) rows.push(row);
          });
          return "\n\n" + rows.join("\n") + "\n\n";
        },
      });

      // Strip noise: scripts, styles, nav, footer
      td.remove(["script", "style", "nav", "footer", "iframe"]);

      const markdown = td.turndown(matchedHtml);

      return new Response(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`Proxy error: ${msg}`, { status: 502 });
    }
  },
};
