// Shared helpers for rendering Decap-managed markdown content on the static site.
// Exposed as a global `CMSContent` object (no build step / module bundler here).
window.CMSContent = (function () {
  // Minimal YAML front-matter parser. Handles flat scalar keys and simple
  // "- item" lists (for fields like tags). Nested objects are not needed for
  // the current content model.
  function parseFrontMatter(raw) {
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!match) return { data: {}, body: raw };
    const data = {};
    let currentList = null;
    match[1].split('\n').forEach(line => {
      const listItem = line.match(/^\s*-\s+(.*)$/);
      if (listItem && currentList) {
        data[currentList].push(stripQuotes(listItem[1].trim()));
        return;
      }
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const rest = line.slice(idx + 1).trim();
      if (!key) return;
      if (rest === '') { data[key] = []; currentList = key; }
      else { data[key] = stripQuotes(rest); currentList = null; }
    });
    return { data, body: match[2] };
  }

  function stripQuotes(s) { return s.replace(/^["']|["']$/g, ''); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function safeSlug(s) { return String(s).replace(/[^a-z0-9\-]/gi, ''); }

  function formatDate(s) {
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // Fetch a markdown entry by folder + slug, returning { data, body }.
  async function fetchEntry(folder, slug) {
    const res = await fetch(`${folder}/${safeSlug(slug)}.md`);
    if (!res.ok) throw new Error(`Entry error ${res.status}`);
    return parseFrontMatter(await res.text());
  }

  // Fetch a JSON manifest (index.json) for a collection folder.
  async function fetchManifest(folder) {
    const res = await fetch(`${folder}/index.json`);
    if (!res.ok) throw new Error(`Manifest error ${res.status}`);
    return res.json();
  }

  return { parseFrontMatter, escapeHtml, safeSlug, formatDate, fetchEntry, fetchManifest };
})();
