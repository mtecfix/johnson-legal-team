// Johnson Legal Blog — Enhanced with filtering, navigation, and attractive layout
const BLOG_DIR = 'content/blog';

document.addEventListener('DOMContentLoaded', () => {
  const slug = new URLSearchParams(window.location.search).get('post');
  slug ? renderSinglePost(slug) : renderList();
});

// ─── LIST VIEW ──────────────────────────────────────────────────
async function renderList() {
  const listEl = document.getElementById('postList');
  const filtersEl = document.getElementById('blogFilters');
  
  try {
    const { posts } = await CMSContent.fetchManifest(BLOG_DIR);
    if (!posts || !posts.length) {
      listEl.innerHTML = `
        <div class="col-12 empty-state">
          <i class="fas fa-newspaper"></i>
          <h3>Coming Soon</h3>
          <p class="text-muted">We're working on helpful legal articles for you. Check back soon!</p>
        </div>`;
      return;
    }

    // Sort by date descending
    posts.sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || ''));

    // Extract unique categories and months
    const categories = [...new Set(posts.map(p => p.category).filter(Boolean))];
    const months = [...new Set(posts.map(p => (p.publish_date || '').substring(0, 7)))].sort().reverse();

    // Render filter nav
    if (filtersEl) {
      filtersEl.innerHTML = buildFilterNav(categories, months, posts.length);
      attachFilterEvents(posts, listEl);
    }

    // Render posts
    renderCards(posts, listEl);

  } catch (err) {
    console.error('Blog load error:', err);
    listEl.innerHTML = '<div class="col-12"><p class="text-danger">Could not load posts. Please try again later.</p></div>';
  }
}

function buildFilterNav(categories, months, totalPosts) {
  const categoryIcons = {
    'Criminal Defense': 'fa-gavel',
    'Traffic Tickets': 'fa-car',
    'Expungements': 'fa-eraser',
    'Personal Injury': 'fa-user-injured',
    'Estate Planning': 'fa-file-contract',
    'Firm News': 'fa-newspaper'
  };

  const catChips = categories.map(cat => {
    const icon = categoryIcons[cat] || 'fa-tag';
    return `<button class="filter-chip" data-category="${CMSContent.escapeHtml(cat)}"><i class="fas ${icon}"></i> ${CMSContent.escapeHtml(cat)}</button>`;
  }).join('');

  const monthOptions = months.map(m => {
    const d = new Date(m + '-15');
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return `<option value="${m}">${label}</option>`;
  }).join('');

  return `
    <div class="filter-bar">
      <div class="filter-section">
        <span class="filter-label"><i class="fas fa-folder"></i> Category</span>
        <div class="filter-chips">
          <button class="filter-chip active" data-category="all"><i class="fas fa-th-large"></i> All</button>
          ${catChips}
        </div>
      </div>
      <div class="filter-row">
        <div class="filter-section filter-section-sm">
          <span class="filter-label"><i class="fas fa-calendar"></i> Month</span>
          <select class="filter-select" id="monthFilter">
            <option value="all">All Months</option>
            ${monthOptions}
          </select>
        </div>
        <div class="filter-section filter-section-sm">
          <span class="filter-label"><i class="fas fa-search"></i> Search</span>
          <input type="text" class="filter-input" id="searchFilter" placeholder="Search articles...">
        </div>
        <div class="filter-results">
          <span id="resultCount">${totalPosts}</span> article${totalPosts !== 1 ? 's' : ''}
        </div>
      </div>
    </div>`;
}

function attachFilterEvents(posts, listEl) {
  let activeCategory = 'all';
  let activeMonth = 'all';
  let searchTerm = '';

  // Category chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeCategory = chip.dataset.category;
      applyFilters();
    });
  });

  // Month select
  const monthSelect = document.getElementById('monthFilter');
  if (monthSelect) {
    monthSelect.addEventListener('change', () => {
      activeMonth = monthSelect.value;
      applyFilters();
    });
  }

  // Search
  const searchInput = document.getElementById('searchFilter');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchTerm = searchInput.value.toLowerCase();
      applyFilters();
    });
  }

  function applyFilters() {
    const filtered = posts.filter(p => {
      const matchCat = activeCategory === 'all' || p.category === activeCategory;
      const matchMonth = activeMonth === 'all' || (p.publish_date || '').startsWith(activeMonth);
      const matchSearch = !searchTerm || 
        (p.title || '').toLowerCase().includes(searchTerm) ||
        (p.excerpt || '').toLowerCase().includes(searchTerm) ||
        (p.category || '').toLowerCase().includes(searchTerm);
      return matchCat && matchMonth && matchSearch;
    });
    renderCards(filtered, listEl);
    const countEl = document.getElementById('resultCount');
    if (countEl) countEl.textContent = filtered.length;
  }
}

function renderCards(posts, container) {
  const esc = CMSContent.escapeHtml;
  
  if (!posts.length) {
    container.innerHTML = `
      <div class="col-12 empty-state">
        <i class="fas fa-filter"></i>
        <h3>No Articles Found</h3>
        <p class="text-muted">Try adjusting your filters or search terms.</p>
      </div>`;
    return;
  }

  // Featured post (first/newest) + grid for the rest
  const [featured, ...rest] = posts;
  
  const featuredHtml = `
    <div class="col-12 mb-4">
      <div class="featured-post">
        <div class="featured-post-image">
          ${featured.featured_image 
            ? `<img src="${esc(featured.featured_image)}" alt="${esc(featured.title)}">`
            : `<div class="featured-placeholder"><i class="fas fa-balance-scale"></i></div>`}
        </div>
        <div class="featured-post-content">
          <span class="post-badge">${esc(featured.category || 'News')}</span>
          <h2><a href="blog.html?post=${encodeURIComponent(featured.slug)}">${esc(featured.title)}</a></h2>
          <p class="featured-excerpt">${esc(featured.excerpt || '')}</p>
          <div class="post-meta-row">
            <span><i class="fas fa-calendar-alt"></i> ${CMSContent.formatDate(featured.publish_date)}</span>
            <span><i class="fas fa-user"></i> Johnson Legal Team</span>
          </div>
          <a href="blog.html?post=${encodeURIComponent(featured.slug)}" class="read-more-btn">Read Full Article <i class="fas fa-arrow-right"></i></a>
        </div>
      </div>
    </div>`;

  const restHtml = rest.map(p => `
    <div class="col-md-6 col-lg-4">
      <article class="blog-card card">
        <div class="card-img-wrapper">
          ${p.featured_image 
            ? `<img src="${esc(p.featured_image)}" class="card-img-top" alt="${esc(p.title)}">`
            : `<div class="card-img-top card-placeholder"><i class="fas fa-balance-scale"></i></div>`}
          <span class="card-badge">${esc(p.category || 'News')}</span>
        </div>
        <div class="card-body">
          <h5 class="card-title"><a href="blog.html?post=${encodeURIComponent(p.slug)}">${esc(p.title)}</a></h5>
          <p class="card-text">${esc(p.excerpt || '')}</p>
          <div class="card-footer-row">
            <span class="meta"><i class="fas fa-calendar-alt"></i> ${CMSContent.formatDate(p.publish_date)}</span>
            <a href="blog.html?post=${encodeURIComponent(p.slug)}" class="read-more">Read <i class="fas fa-chevron-right"></i></a>
          </div>
        </div>
      </article>
    </div>`).join('');

  container.innerHTML = featuredHtml + restHtml;
}

// ─── SINGLE POST VIEW ───────────────────────────────────────────
async function renderSinglePost(slug) {
  document.getElementById('postList').style.display = 'none';
  document.getElementById('blogHero').style.display = 'none';
  document.getElementById('blogFilters').style.display = 'none';
  const view = document.getElementById('postView');
  view.style.display = 'block';

  try {
    const { data, body } = await CMSContent.fetchEntry(BLOG_DIR, slug);
    document.title = `${data.title || 'Blog Post'} | Johnson Legal Team`;

    const publishDate = CMSContent.formatDate(data.publish_date);
    const readTime = Math.max(3, Math.ceil(body.split(' ').length / 250));

    view.innerHTML = `
      <div class="post-container">
        <a href="blog.html" class="back-link"><i class="fas fa-arrow-left"></i> All Articles</a>
        
        ${data.featured_image ? `<img src="${data.featured_image}" alt="${CMSContent.escapeHtml(data.title)}" class="post-featured-img">` : ''}
        
        <div class="post-header">
          <span class="post-badge">${CMSContent.escapeHtml(data.category || 'News')}</span>
          <h1>${CMSContent.escapeHtml(data.title || 'Untitled')}</h1>
          <div class="post-meta">
            <span><i class="fas fa-calendar-alt"></i> ${publishDate}</span>
            <span><i class="fas fa-clock"></i> ${readTime} min read</span>
            <span><i class="fas fa-user"></i> ${CMSContent.escapeHtml(data.author || 'Johnson Legal Team')}</span>
          </div>
        </div>
        
        <div class="post-body">${marked.parse(body)}</div>
        
        <div class="post-tags">
          ${(data.tags || []).map(t => `<span class="tag-chip"><i class="fas fa-tag"></i> ${CMSContent.escapeHtml(t)}</span>`).join('')}
        </div>

        <div class="post-cta">
          <div class="cta-icon"><i class="fas fa-phone-alt"></i></div>
          <div class="cta-content">
            <h3>Need Legal Guidance?</h3>
            <p>Our team has the experience and dedication to fight for your rights. Contact us for a free, confidential consultation.</p>
          </div>
          <a href="contact.html" class="cta-btn">Free Consultation <i class="fas fa-arrow-right"></i></a>
        </div>

        <div class="post-nav">
          <a href="blog.html" class="back-link"><i class="fas fa-th-large"></i> Browse All Articles</a>
        </div>
      </div>`;

  } catch (err) {
    console.error(err);
    view.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-circle"></i>
        <h3>Post Not Found</h3>
        <p class="text-muted">Sorry, we couldn't find that article.</p>
        <a href="blog.html" class="back-link"><i class="fas fa-arrow-left"></i> Back to Blog</a>
      </div>`;
  }
}
