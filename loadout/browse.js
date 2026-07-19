// browse.js - Browse Loadouts page. Rebuilt from the original browse-loadouts page,
// but backed by localStorage (key 'dayzLoadouts') plus bundled example presets
// instead of a server API.

function attrs() { return { healthMin: 0.5, healthMax: 1, quantityMin: -1, quantityMax: -1 }; }
function dset(itemType, simple = [], complex = []) {
  return { itemType, spawnWeight: 1, attributes: attrs(), quickBarSlot: -1,
    simpleChildrenTypes: simple, complexChildrenSets: complex };
}
function slot(slotName, sets) { return { slotName, discreteItemSets: sets }; }

const SAMPLE_LOADOUTS = [
  {
    id: 'sample_fresh', name: 'Fresh Spawn Basics', username: 'Example', sample: true,
    created_at: '2026-01-10T12:00:00Z', updated_at: '2026-01-10T12:00:00Z', downloads: 42,
    data: {
      version: 1, name: 'Fresh Spawn Basics', spawnWeight: 1, characterTypes: [],
      attachmentSlotItemSets: [
        slot('Body', [dset('TShirt_Red')]),
        slot('Legs', [dset('Jeans_Blue')]),
        slot('Feet', [dset('AthleticShoes_Blue')]),
        slot('Headgear', [dset('BaseballCap_Blue')])
      ],
      discreteUnsortedItemSets: [{
        name: 'Extra items', spawnWeight: 1, attributes: attrs(),
        simpleChildrenTypes: ['BandageDressing', 'Apple', 'Rag'], complexChildrenSets: []
      }]
    }
  },
  {
    id: 'sample_hunter', name: 'Chernarus Hunter', username: 'Example', sample: true,
    created_at: '2026-01-11T12:00:00Z', updated_at: '2026-01-11T12:00:00Z', downloads: 27,
    data: {
      version: 1, name: 'Chernarus Hunter', spawnWeight: 1, characterTypes: [],
      attachmentSlotItemSets: [
        slot('Shoulder', [dset('Mosin9130', ['PUScopeOptic'])]),
        slot('Body', [dset('M65Jacket_Black')]),
        slot('Vest', [dset('HuntingVest')]),
        slot('Legs', [dset('HunterPants_Brown')]),
        slot('Feet', [dset('WorkingBoots_Brown')]),
        slot('Back', [dset('AliceBag_Green')])
      ],
      discreteUnsortedItemSets: [{
        name: 'Extra items', spawnWeight: 1, attributes: attrs(),
        simpleChildrenTypes: ['Ammo_762x54', 'Canteen', 'HuntingKnife', 'Matchbox'], complexChildrenSets: []
      }]
    }
  },
  {
    id: 'sample_military', name: 'Military Assault', username: 'Example', sample: true,
    created_at: '2026-01-12T12:00:00Z', updated_at: '2026-01-12T12:00:00Z', downloads: 63,
    data: {
      version: 1, name: 'Military Assault', spawnWeight: 1, characterTypes: [],
      attachmentSlotItemSets: [
        slot('Shoulder', [dset('AKM', ['KobraOptic'], [dset('Mag_AKM_30Rnd', ['Ammo_762x39'])])]),
        slot('Body', [dset('GorkaEJacket_Summer')]),
        slot('Legs', [dset('GorkaPants_Summer')]),
        slot('Vest', [dset('PlateCarrierVest')]),
        slot('Headgear', [dset('BallisticHelmet_Black')]),
        slot('Gloves', [dset('TacticalGloves_Black')]),
        slot('Feet', [dset('CombatBoots_Black')]),
        slot('Back', [dset('AssaultBag_Green')])
      ],
      discreteUnsortedItemSets: [{
        name: 'Extra items', spawnWeight: 1, attributes: attrs(),
        simpleChildrenTypes: ['BandageDressing', 'Ammo_762x39'],
        complexChildrenSets: [dset('Mag_AKM_30Rnd', ['Ammo_762x39'])]
      }]
    }
  }
];

class LoadoutBrowser {
  static currentPage = 1;
  static itemsPerPage = 10;
  static totalPages = 1;
  static currentFilter = 'recent';
  static loadouts = [];
  static searchTerm = '';

  static async init() {
    document.getElementById('loadout-filter').addEventListener('change', e => {
      this.currentFilter = e.target.value;
      this.currentPage = 1;
      this.fetchLoadouts();
    });
    const searchInput = document.getElementById('loadout-search');
    document.getElementById('search-loadouts-btn').addEventListener('click', () => {
      this.searchTerm = searchInput.value;
      this.currentPage = 1;
      this.fetchLoadouts();
    });
    searchInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') {
        this.searchTerm = searchInput.value;
        this.currentPage = 1;
        this.fetchLoadouts();
      }
    });
    await this.fetchLoadouts();
  }

  static allLoadouts() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem('dayzLoadouts') || '[]'); }
    catch (e) { console.warn('Could not read saved loadouts:', e); }
    return this.currentFilter === 'my' ? saved : saved.concat(SAMPLE_LOADOUTS);
  }

  static fetchLoadouts() {
    const container = document.getElementById('loadouts-container');
    let list = this.allLoadouts();

    if (this.searchTerm) {
      const q = this.searchTerm.toLowerCase();
      list = list.filter(l => (l.name || '').toLowerCase().includes(q) || (l.username || '').toLowerCase().includes(q));
    }
    if (this.currentFilter === 'popular') {
      list.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
    } else {
      list.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
    }

    this.totalPages = Math.max(1, Math.ceil(list.length / this.itemsPerPage));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
    this.loadouts = list.slice((this.currentPage - 1) * this.itemsPerPage, this.currentPage * this.itemsPerPage);

    if (this.loadouts.length === 0) {
      if (this.searchTerm) {
        container.innerHTML = `
          <div class="alert alert-warning text-center">
            <i class="ti ti-search-off mb-2" style="font-size: 2rem;"></i>
            <p>No loadouts found matching "${this.escape(this.searchTerm)}"</p>
            <p>Try a different search term or browse all loadouts</p>
          </div>`;
      } else if (this.currentFilter === 'my') {
        container.innerHTML = `
          <div class="alert alert-info text-center">
            <i class="ti ti-folder-plus mb-2" style="font-size: 2rem;"></i>
            <p>You haven't saved any loadouts yet</p>
            <a href="index.html" class="btn btn-primary"><i class="ti ti-plus me-2"></i> Create Your First Loadout</a>
          </div>`;
      } else {
        container.innerHTML = `
          <div class="alert alert-info text-center">
            <i class="ti ti-folder-off mb-2" style="font-size: 2rem;"></i>
            <p>No loadouts have been shared yet</p>
            <p>Be the first to create and share a loadout!</p>
            <a href="index.html" class="btn btn-primary"><i class="ti ti-plus me-2"></i> Create a Loadout</a>
          </div>`;
      }
      document.getElementById('loadout-pagination').innerHTML = '';
      return;
    }
    this.renderLoadouts();
    this.renderPagination();
  }

  static escape(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  static renderLoadouts() {
    const container = document.getElementById('loadouts-container');
    let html = '<div class="row row-cols-1 row-cols-md-2 g-4">';

    this.loadouts.forEach(loadout => {
      const formattedDate = new Date(loadout.updated_at || loadout.created_at).toLocaleDateString();
      let itemsHtml = '';
      try {
        let data = loadout.data;
        if (data && typeof data === 'string') {
          try { data = JSON.parse(data); } catch (e) { console.warn('Error parsing loadout data:', e); }
        }
        if (data) {
          const keyItems = this.extractKeyItems(data);
          itemsHtml = keyItems && keyItems.length > 0 && keyItems[0] !== 'No items found'
            ? keyItems.map(i => `<span class="loadout-badge">${this.escape(i)}</span>`).join(' ')
            : '<div class="no-data-message">No key equipment details available</div>';
        } else {
          itemsHtml = '<div class="no-data-message">Loadout data not available</div>';
        }
      } catch (e) {
        console.error('Error processing loadout data:', e);
        itemsHtml = '<div class="no-data-message">Error loading equipment details</div>';
      }

      html += `
        <div class="col">
          <div class="card bg-dark border-secondary h-100 loadout-card">
            <div class="card-header d-flex justify-content-between align-items-center"
                 style="background-color: rgba(255,255,255,.1); border-bottom: 1px solid rgba(255,255,255,.2); padding: .75rem 1rem;">
              <h5 class="card-title mb-0" style="color:#f8f9fa;font-weight:600;text-shadow:1px 1px 3px rgba(0,0,0,.5);">
                ${this.escape(loadout.name || 'Unnamed Loadout')}
              </h5>
              ${loadout.sample ? '<span class="badge bg-secondary">example</span>' : ''}
            </div>
            <div class="card-body">
              <div class="loadout-preview">
                <h6 class="small mb-2 text-primary">Key Equipment:</h6>
                <div class="loadout-items-list">${itemsHtml}</div>
              </div>
              <div class="d-flex justify-content-between align-items-center">
                <div class="small text-muted">
                  <div>By: ${this.escape(loadout.username || 'Anonymous')}</div>
                  <div>Created: ${formattedDate}</div>
                </div>
                <div class="btn-group">
                  <button class="btn btn-sm btn-outline-secondary text-light use-loadout-btn" data-id="${loadout.id}">
                    <i class="ti ti-pencil me-1"></i> Open
                  </button>
                  <button class="btn btn-sm btn-primary download-loadout-btn" data-id="${loadout.id}">
                    <i class="ti ti-download me-1"></i> Download
                  </button>
                  ${loadout.sample ? '' : `<button class="btn btn-sm btn-outline-secondary text-danger delete-loadout-btn" data-id="${loadout.id}"><i class="ti ti-trash"></i></button>`}
                </div>
              </div>
            </div>
          </div>
        </div>`;
    });

    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.download-loadout-btn').forEach(btn =>
      btn.addEventListener('click', e => this.downloadLoadout(e.target.closest('button').dataset.id)));
    container.querySelectorAll('.use-loadout-btn').forEach(btn =>
      btn.addEventListener('click', e => this.loadLoadout(e.target.closest('button').dataset.id)));
    container.querySelectorAll('.delete-loadout-btn').forEach(btn =>
      btn.addEventListener('click', e => this.deleteLoadout(e.target.closest('button').dataset.id)));
  }

  static extractKeyItems(data) {
    try {
      const items = [];
      if (!data) return ['No loadout data available'];
      let d = data;
      if (typeof data === 'string') {
        try { d = JSON.parse(data); } catch (e) { console.warn('Failed to parse loadout data string:', e); }
      }
      if (d && d.attachmentSlotItemSets && Array.isArray(d.attachmentSlotItemSets)) {
        d.attachmentSlotItemSets.forEach(slotSet => {
          if (slotSet && slotSet.discreteItemSets && Array.isArray(slotSet.discreteItemSets)) {
            slotSet.discreteItemSets.forEach(set => {
              if (set && set.itemType) items.push(this.formatItemName(set.itemType));
            });
          }
        });
      }
      if (d && d.discreteUnsortedItemSets && Array.isArray(d.discreteUnsortedItemSets)) {
        d.discreteUnsortedItemSets.forEach(us => {
          if (!us) return;
          const complex = us.complexChildrenSets || us.complexChildrenTypes;
          if (complex && Array.isArray(complex)) {
            complex.forEach(c => {
              if (typeof c === 'object' && c && c.itemType) items.push(this.formatItemName(c.itemType));
              else if (typeof c === 'string') items.push(this.formatItemName(c));
            });
          }
          if (us.simpleChildrenTypes && Array.isArray(us.simpleChildrenTypes)) {
            us.simpleChildrenTypes.forEach(t => { if (typeof t === 'string') items.push(this.formatItemName(t)); });
          }
        });
      }
      return items.length > 0 ? items.slice(0, 15) : ['No items found'];
    } catch (e) {
      console.error('Error extracting key items:', e);
      return ['Error extracting items'];
    }
  }

  static formatItemName(t) {
    if (!t) return 'Unknown';
    return t.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  }

  static renderPagination() {
    const pagination = document.getElementById('loadout-pagination');
    if (!pagination) return;
    let html = `
      <li class="page-item ${this.currentPage === 1 ? 'disabled' : ''}">
        <a class="page-link bg-dark border-secondary" href="#" data-page="${this.currentPage - 1}"><i class="ti ti-chevron-left"></i></a>
      </li>`;
    const startPage = Math.max(1, this.currentPage - 2);
    const endPage = Math.min(this.totalPages, startPage + 4);
    for (let i = startPage; i <= endPage; i++) {
      html += `
        <li class="page-item ${i === this.currentPage ? 'active' : ''}">
          <a class="page-link bg-dark border-secondary" href="#" data-page="${i}">${i}</a>
        </li>`;
    }
    html += `
      <li class="page-item ${this.currentPage === this.totalPages ? 'disabled' : ''}">
        <a class="page-link bg-dark border-secondary" href="#" data-page="${this.currentPage + 1}"><i class="ti ti-chevron-right"></i></a>
      </li>`;
    pagination.innerHTML = html;
    pagination.querySelectorAll('.page-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const page = parseInt(e.target.closest('.page-link').dataset.page);
        if (page && page !== this.currentPage && page >= 1 && page <= this.totalPages) {
          this.currentPage = page;
          this.fetchLoadouts();
          window.scrollTo(0, 0);
        }
      });
    });
  }

  static findById(id) {
    return this.allLoadouts().concat(SAMPLE_LOADOUTS).find(l => String(l.id) === String(id));
  }

  static bumpDownloads(id) {
    try {
      const saved = JSON.parse(localStorage.getItem('dayzLoadouts') || '[]');
      const rec = saved.find(l => String(l.id) === String(id));
      if (rec) {
        rec.downloads = (rec.downloads || 0) + 1;
        localStorage.setItem('dayzLoadouts', JSON.stringify(saved));
      }
    } catch (e) { /* non-critical */ }
  }

  static downloadLoadout(id) {
    const loadout = this.findById(id);
    if (!loadout) { UIManager.showNotification('Loadout not found', 'error'); return; }
    const blob = new Blob([JSON.stringify(loadout.data, null, 2)], { type: 'application/json' });
    const fileName = (loadout.name || 'loadout').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.json';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    this.bumpDownloads(id);
    UIManager.showNotification('Loadout downloaded successfully', 'success');
  }

  static loadLoadout(id) {
    const loadout = this.findById(id);
    if (!loadout) { UIManager.showNotification('Loadout not found', 'error'); return; }
    localStorage.setItem('pendingLoadout', JSON.stringify(loadout.data));
    window.location.href = 'index.html?load=true';
  }

  static deleteLoadout(id) {
    Swal.fire({
      title: 'Delete loadout?', text: 'This removes it from your browser storage.', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Delete', background: '#2a2a2a', color: '#f0f0f0'
    }).then(r => {
      if (!r.isConfirmed) return;
      try {
        const saved = JSON.parse(localStorage.getItem('dayzLoadouts') || '[]');
        localStorage.setItem('dayzLoadouts', JSON.stringify(saved.filter(l => String(l.id) !== String(id))));
      } catch (e) { console.warn(e); }
      this.fetchLoadouts();
      UIManager.showNotification('Loadout deleted', 'success');
    });
  }
}

document.addEventListener('DOMContentLoaded', () => LoadoutBrowser.init());
