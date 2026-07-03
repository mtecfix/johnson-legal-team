// Renders the Practice Areas collection managed by Decap CMS.
// No ?area= param  -> directory of all areas (from index.json manifest).
// ?area=slug        -> detail view (markdown body + FAQs from front matter).
//
// NOTE: the FAQ list uses a nested front-matter structure that the lightweight
// parser in content.js does not decode. For the detail view we re-read the
// nested FAQ block here with a small purpose-built parser.
const PA_DIR = 'content/practice-areas';

document.addEventListener('DOMContentLoaded', () => {
  const slug = new URLSearchParams(window.location.search).get('area');
  slug ? renderDetail(slug) : renderDirectory();
});

async function renderDirectory() {
  const el = document.getElementById('areaList');
  el.style.display = 'flex';
  try {
    const { areas } = await CMSContent.fetchManifest(PA_DIR);
    if (!areas || !areas.length) { el.innerHTML = '<p class="text-muted">No practice areas yet.</p>'; return; }
    const esc = CMSContent.escapeHtml;
    const sorted = areas.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    el.innerHTML = sorted.map(a => `
      <div class="col-md-6 col-lg-4">
        <div class="card h-100 shadow-sm">
          <div class="card-body d-flex flex-column">
            <div class="mb-2 fs-2 text-primary"><i class="${esc(a.icon || 'fas fa-balance-scale')}"></i></div>
            <h5 class="card-title">${esc(a.title)}</h5>
            <p class="card-text text-muted small">${esc(a.short_description || '')}</p>
            <a href="practice-area.html?area=${encodeURIComponent(a.slug)}" class="btn btn-sm btn-primary mt-auto align-self-start">Learn more</a>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    console.error(err);
    el.innerHTML = '<p class="text-danger">Could not load practice areas.</p>';
  }
}

async function renderDetail(slug) {
  const view = document.getElementById('areaView');
  view.style.display = 'block';
  try {
    const res = await fetch(`${PA_DIR}/${CMSContent.safeSlug(slug)}.md`);
    if (!res.ok) throw new Error(`Entry error ${res.status}`);
    const raw = await res.text();
    const { data, body } = CMSContent.parseFrontMatter(raw);

    document.getElementById('areaTitle').textContent = data.title || 'Practice Area';
    document.getElementById('areaIcon').className = data.icon || 'fas fa-balance-scale';
    const img = document.getElementById('areaImage');
    if (data.hero_image) { img.src = data.hero_image; img.alt = data.title || ''; }
    else { img.style.display = 'none'; }
    document.getElementById('areaBody').innerHTML = marked.parse(body);

    renderFaqs(parseFaqs(raw), data.title);
  } catch (err) {
    console.error(err);
    view.innerHTML = '<p class="text-danger">Practice area not found.</p><a href="practice-area.html">Back</a>';
  }
}

// Parse the nested `faqs:` block from front matter into [{question, answer}].
function parseFaqs(raw) {
  const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return [];
  const lines = fm[1].split('\n');
  const start = lines.findIndex(l => /^faqs:\s*$/.test(l));
  if (start === -1) return [];
  const faqs = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // dedented back to a top-level key
    const q = line.match(/^\s*-\s*question:\s*(.*)$/);
    const a = line.match(/^\s*answer:\s*(.*)$/);
    if (q) { if (cur) faqs.push(cur); cur = { question: unquote(q[1]), answer: '' }; }
    else if (a && cur) { cur.answer = unquote(a[1]); }
  }
  if (cur) faqs.push(cur);
  return faqs;
}

function unquote(s) { return s.trim().replace(/^["']|["']$/g, ''); }

function renderFaqs(faqs, titleForIds) {
  if (!faqs.length) return;
  const wrap = document.getElementById('areaFaqs');
  const acc = document.getElementById('faqAccordion');
  const esc = CMSContent.escapeHtml;
  acc.innerHTML = faqs.map((f, i) => `
    <div class="accordion-item">
      <h3 class="accordion-header" id="faqH${i}">
        <button class="accordion-button ${i ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#faqC${i}">
          ${esc(f.question)}
        </button>
      </h3>
      <div id="faqC${i}" class="accordion-collapse collapse ${i ? '' : 'show'}" data-bs-parent="#faqAccordion">
        <div class="accordion-body">${esc(f.answer)}</div>
      </div>
    </div>`).join('');
  wrap.style.display = 'block';
}
