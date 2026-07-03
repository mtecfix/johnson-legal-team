// Search functionality for Johnson Legal Team website

const searchIndex = [
    {
        title: "Home - Michigan Estate Planning Attorney",
        url: "index.html",
        description: "Johnson Legal Team - Your trusted Michigan legal advocates specializing in estate planning",
        keywords: "michigan estate planning attorney johnson legal team birmingham probate wills trusts"
    },
    {
        title: "Estate Planning & Probate",
        url: "probate-estate-planning.html",
        description: "Wills, trusts, estate administration, guardianships",
        keywords: "will trust probate estate planning guardianship conservatorship MCL 700 administration beneficiary executor"
    },
    {
        title: "Expungements",
        url: "expungements.html",
        description: "Clear your criminal record, set aside convictions",
        keywords: "expungement clear record criminal conviction MCL 780.621 automatic marijuana felony misdemeanor employment"
    },
    {
        title: "Misdemeanor Defense",
        url: "misdemeanors.html",
        description: "Assault, DUI/OWI, retail fraud, criminal defense",
        keywords: "misdemeanor assault battery DUI OWI drunk driving retail fraud shoplifting HYTA criminal defense MCL 750"
    },
    {
        title: "Traffic Tickets",
        url: "traffic-tickets.html",
        description: "Speeding, reckless driving, license suspension",
        keywords: "traffic ticket speeding reckless driving license suspension points insurance MCL 257 violation citation"
    },
    {
        title: "About Us",
        url: "about.html",
        description: "Learn about Johnson Legal Team and our attorneys",
        keywords: "about attorney lawyer Birmingham Michigan experience team Rodney Johnson"
    },
    {
        title: "Contact",
        url: "contact.html",
        description: "Get in touch for a consultation",
        keywords: "contact consultation phone email address Birmingham location"
    }
];

// Initialize search functionality
document.addEventListener('DOMContentLoaded', function() {
    const searchInputs = document.querySelectorAll('.search-input');
    
    searchInputs.forEach(input => {
        // Create results container
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'search-results';
        resultsDiv.style.cssText = 'position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #d4af37; border-radius: 0 0 8px 8px; max-height: 400px; overflow-y: auto; display: none; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
        input.parentElement.style.position = 'relative';
        input.parentElement.appendChild(resultsDiv);
        
        // Search on input
        input.addEventListener('input', function(e) {
            const query = e.target.value.trim().toLowerCase();
            
            if (query.length < 2) {
                resultsDiv.style.display = 'none';
                return;
            }
            
            const results = searchIndex.filter(item => {
                return item.title.toLowerCase().includes(query) ||
                       item.description.toLowerCase().includes(query) ||
                       item.keywords.toLowerCase().includes(query);
            });
            
            if (results.length > 0) {
                resultsDiv.innerHTML = results.map(result => `
                    <a href="${result.url}" class="search-result-item" style="display: block; padding: 12px 16px; text-decoration: none; color: #1a365d; border-bottom: 1px solid #e9ecef; transition: background 0.2s;">
                        <div style="font-weight: 600; color: #d4af37; margin-bottom: 4px;">${result.title}</div>
                        <div style="font-size: 0.9rem; color: #6c757d;">${result.description}</div>
                    </a>
                `).join('');
                
                // Add hover effect
                resultsDiv.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('mouseenter', function() {
                        this.style.background = '#f8f9fa';
                    });
                    item.addEventListener('mouseleave', function() {
                        this.style.background = 'white';
                    });
                });
                
                resultsDiv.style.display = 'block';
            } else {
                resultsDiv.innerHTML = `
                    <div style="padding: 16px; text-align: center; color: #6c757d;">
                        <p style="margin-bottom: 8px;">No results found for "${query}"</p>
                        <a href="contact.html" style="color: #d4af37; text-decoration: none; font-weight: 600;">Contact us for help →</a>
                    </div>
                `;
                resultsDiv.style.display = 'block';
            }
        });
        
        // Close results when clicking outside
        document.addEventListener('click', function(e) {
            if (!input.parentElement.contains(e.target)) {
                resultsDiv.style.display = 'none';
            }
        });
        
        // Handle search button click
        const searchBtn = input.parentElement.querySelector('.search-btn');
        if (searchBtn) {
            searchBtn.addEventListener('click', function(e) {
                e.preventDefault();
                if (input.value.trim()) {
                    input.dispatchEvent(new Event('input'));
                }
            });
        }
    });
});
