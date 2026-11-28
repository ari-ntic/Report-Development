/* Keep the address bar in sync with the visible view and report filters. */
(() => {
  'use strict';
  let applyingAddress = false;
  let routeHandled = false;
  let routeApplying = false;
  let restoredModalRoute = false;
  const HOME_RETURN_CLOSERS = new Set(['closeReportsModal','closeGalleryModal','closeTodoModal','closePhotoViewer']);

  const FILTER_KEYS = ['company', 'category', 'urgency', 'search'];
  const MANAGED_KEYS = ['view', 'pageNo', 'id', 'photoSource', 'photoPage', ...FILTER_KEYS];
  let activePhotoRoute = { source: 'entry', pageNo: 1 };

  function isOpen(el) {
    return !!el && !el.hidden && el.getAttribute('aria-hidden') !== 'true' && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  }

  function cleanFilter(value) {
    const text = String(value == null ? '' : value).trim();
    return !text || text === 'ALL' ? '' : text;
  }

  function readFilters() {
    const company = cleanFilter(document.getElementById('filterCompany')?.value);
    const category = cleanFilter(document.getElementById('filterCategory')?.value);
    const searchBox = document.getElementById('filterSearch');
    const search = String(searchBox ? searchBox.value : (typeof currentSearchTerm !== 'undefined' ? currentSearchTerm : '')).trim();
    const urgency = cleanFilter(typeof currentUrgencyFilter !== 'undefined' ? currentUrgencyFilter : '');
    return { company, category, urgency, search };
  }

  function visibleRoute() {
    const photoInfo = document.getElementById('photoViewerInfo');
    const photo = typeof viewerPhotos !== 'undefined' && viewerPhotos[viewerIndex];
    const photoId = photo && typeof viewerPhotoFileId === 'function' ? viewerPhotoFileId(photo.url) : '';
    if (photoInfo && photoInfo.getClientRects().length > 0 && photoId) return { view: 'photo', id: photoId, photoSource: activePhotoRoute.source, photoPage: activePhotoRoute.pageNo };

    const reportOverlay = document.getElementById('packageManagerOverlay');
    if (isOpen(reportOverlay) && typeof packageEntry !== 'undefined' && packageEntry && packageEntry.id) {
      return Object.assign({ view: 'report', id: packageEntry.id, pageNo: typeof currentPage !== 'undefined' ? currentPage || 1 : 1 }, readFilters());
    }
    if (isOpen(document.getElementById('galleryModalOverlay'))) {
      return { view: 'photos', pageNo: typeof galleryCurrentPage !== 'undefined' ? galleryCurrentPage || 1 : 1 };
    }
    if (isOpen(document.getElementById('reportsModalOverlay'))) {
      return Object.assign({ view: 'reports', pageNo: typeof currentPage !== 'undefined' ? currentPage || 1 : 1 }, readFilters());
    }
    if (isOpen(document.getElementById('todoModalOverlay'))) return { view: 'todo' };
    return { view: 'home' };
  }

  function addressFor(route) {
    const url = new URL(window.location.href);
    MANAGED_KEYS.forEach(key => url.searchParams.delete(key));
    if (route.view !== 'home') url.searchParams.set('view', route.view);
    if (route.pageNo && route.pageNo > 1) url.searchParams.set('pageNo', String(route.pageNo));
    if (route.id) url.searchParams.set('id', String(route.id));
    if (route.view === 'photo' && route.photoSource && route.photoSource !== 'entry') url.searchParams.set('photoSource', route.photoSource);
    if (route.view === 'photo' && route.photoSource === 'gallery' && route.photoPage > 1) url.searchParams.set('photoPage', String(route.photoPage));
    if (route.view === 'reports' || route.view === 'report') {
      FILTER_KEYS.forEach(key => {
        const value = cleanFilter(route[key]);
        if (value) url.searchParams.set(key, value);
      });
    }
    return url.pathname + url.search + url.hash;
  }

  function syncAddress(replace) {
    const loginOverlay = document.getElementById('reportLogin');    if (applyingAddress || isOpen(loginOverlay) || (!routeHandled && new URLSearchParams(window.location.search).has('view'))) return;
    const next = addressFor(visibleRoute());
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (next === current) return;
    window.history[replace ? 'replaceState' : 'pushState']({ nticReportView: true }, '', next);
  }

  function syncSoon(replace) { window.setTimeout(() => syncAddress(!!replace), 0); }

  function ensureRestoredHomeLoaded() {
    if (!restoredModalRoute || applyingAddress || visibleRoute().view !== 'home') return;
    let attempts = 0;
    const check = () => {
      if (!restoredModalRoute || applyingAddress || visibleRoute().view !== 'home') return;
      const missing = ['journal', 'followups', 'todo'].filter(part => !mainLoadState[part]);
      if (!missing.length) { restoredModalRoute = false; return; }
      if (attempts++ < 20) { window.setTimeout(check, 150); return; }
      restoredModalRoute = false;
      if (!mainLoadState.journal && typeof loadJurnalBootstrap === 'function') loadJurnalBootstrap();
      else if (!mainLoadState.followups && typeof loadRecentFollowUps === 'function') loadRecentFollowUps();
      if (!mainLoadState.todo && typeof loadTodoList === 'function') loadTodoList();
    };
    check();
  }  // Reload restored-home data in priority order. A newer navigation cancels queued work.
  ensureRestoredHomeLoaded = function() {
    if (!restoredModalRoute || applyingAddress || visibleRoute().view !== 'home') return;
    const generation = (ensureRestoredHomeLoaded._generation || 0) + 1;
    ensureRestoredHomeLoaded._generation = generation;
    const graceUntil = Date.now() + 3000;
    const skipped = new Set();
    const dashboardBefore = typeof lastDashboardData === 'undefined' ? null : lastDashboardData;
    const jurnalBefore = typeof lastJurnalPageResult === 'undefined' ? null : lastJurnalPageResult;
    const canContinue = () => generation === ensureRestoredHomeLoaded._generation && restoredModalRoute && !applyingAddress && visibleRoute().view === 'home';
    const isReady = part => part === 'home'
      ? lastDashboardData !== dashboardBefore && lastJurnalPageResult !== jurnalBefore && !!mainLoadState.followups
      : !!mainLoadState.todo;
    const loadNext = () => {
      if (!canContinue()) return;
      const part = ['home', 'todo'].find(key => !isReady(key) && !skipped.has(key));
      if (!part) { restoredModalRoute = false; return; }
      if (Date.now() < graceUntil) { window.setTimeout(loadNext, 150); return; }
      const start = () => {
        if (!canContinue()) return;
        if (isReady(part)) { window.setTimeout(loadNext, 0); return; }
        const deadline = Date.now() + 20000;
        if (part === 'home') {
          // Refresh dashboard (including photos and follow-ups) and the first report page.
          mainLoadState.journal = false;
          mainLoadState.followups = false;
          if (typeof loadJurnalBootstrap !== 'function') { skipped.add(part); loadNext(); return; }
          loadJurnalBootstrap();
        } else {
          if (typeof loadTodoList !== 'function') { skipped.add(part); loadNext(); return; }
          loadTodoList();
        }
        const waitForPart = () => {
          if (!canContinue()) return;
          if (isReady(part)) {
            if (part === 'home' && !mainLoadState.journal) markMainLoadReady('journal');
            window.setTimeout(loadNext, 150);
            return;
          }
          if (Date.now() >= deadline) { skipped.add(part); loadNext(); return; }
          window.setTimeout(waitForPart, 150);
        };
        waitForPart();
      };
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 1000 });
      else window.setTimeout(start, 200);
    };
    loadNext();
  };



  function photoViewerItems(items) {
    return (items || []).map(item => ({ url: item.fotoUrl || item.url, nama: item.nama || '', nationality: item.nationality || '', authorName: item.authorName || item.uploaderName || '', tanggal: item.tanggal || '', kategori: item.kategori || '', catatan: item.catatan || '' }));
  }

  function samePhotoList(viewerItems, sourceItems) {
    if (!Array.isArray(viewerItems) || !Array.isArray(sourceItems) || viewerItems.length !== sourceItems.length) return false;
    return viewerItems.every((item, index) => viewerPhotoFileId(item.url) === viewerPhotoFileId(sourceItems[index].fotoUrl || sourceItems[index].url));
  }

  function installPhotoViewerSourceHook() {
    const original = window.openPhotoViewer;
    if (typeof original !== 'function' || original.__photoSourceWrapped) return;
    const wrapped = function(photos, startIndex) {
      const galleryOpen = isOpen(document.getElementById('galleryModalOverlay'));
      const galleryItems = typeof currentGalleryPhotos !== 'undefined' ? currentGalleryPhotos : [];
      const homeItems = typeof lastDashboardData !== 'undefined' && lastDashboardData ? lastDashboardData.latestPhotos || [] : [];
      if (galleryOpen && samePhotoList(photos, galleryItems)) {
        activePhotoRoute = { source: 'gallery', pageNo: typeof galleryCurrentPage !== 'undefined' ? galleryCurrentPage || 1 : 1 };
      } else if (samePhotoList(photos, homeItems)) {
        activePhotoRoute = { source: 'home', pageNo: 1 };
      } else {
        activePhotoRoute = { source: 'entry', pageNo: 1 };
      }
      return original.apply(this, arguments);
    };
    wrapped.__photoSourceWrapped = true;
    window.openPhotoViewer = wrapped;
  }

  function waitForDashboardPhotos(timeoutMs = 20000) {
    return new Promise(resolve => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (typeof dashboardDataReady !== 'undefined' && dashboardDataReady && typeof lastDashboardData !== 'undefined' && lastDashboardData) { resolve(lastDashboardData); return; }
        if (Date.now() >= deadline) { resolve(null); return; }
        window.setTimeout(check, 120);
      };
      check();
    });
  }

  async function openFocusedPhoto(id) {
    const result = await menuRpc('getJournalFocusedPhoto', id);
    if (result && result.success && result.photos && result.photos.length) {
      activePhotoRoute = { source: 'entry', pageNo: 1 };
      openPhotoViewer(result.photos, result.index || 0);
      return true;
    }
    return false;
  }

  function hook(name, replace) {
    const original = window[name];
    if (typeof original !== 'function' || original.__addressSyncWrapped) return;
    const wrapped = function(...args) {
      const result = original.apply(this, args);
      if (HOME_RETURN_CLOSERS.has(name)) ensureRestoredHomeLoaded();
      syncSoon(!!replace);
      return result;
    };
    wrapped.__addressSyncWrapped = true;
    window[name] = wrapped;
  }

  function setSelectValue(id, value) {
    const select = document.getElementById(id);
    if (!select) return;
    const wanted = value || 'ALL';
    if (![...select.options].some(option => option.value === wanted)) {
      select.add(new Option(wanted, wanted));
    }
    select.value = wanted;
  }

  function applyFilters(params) {
    const company = params.get('company') || '';
    const category = params.get('category') || '';
    const urgency = params.get('urgency') || 'ALL';
    const search = params.get('search') || '';
    setSelectValue('filterCompany', company);
    setSelectValue('filterCategory', category);
    const searchBox = document.getElementById('filterSearch');
    if (searchBox) searchBox.value = search;
    if (typeof currentSearchTerm !== 'undefined') currentSearchTerm = search;
    if (typeof setQuickPill === 'function') setQuickPill(urgency);
    else if (typeof currentUrgencyFilter !== 'undefined') currentUrgencyFilter = urgency;
  }

  async function openReport(id) {
    /* Validate the linked report first so a bad ID can fall back to the report list. */
    const found = await menuRpc('getJournalPackage', id);
    if (!found || found.success !== true) return false;
    openReportsModal(false);
    if (typeof window.openPackageManagerFromRoute !== 'function') {
      throw new Error('Report editor entry point unavailable');
    }
    await window.openPackageManagerFromRoute(id);
    const editor = document.getElementById('packageManagerOverlay');
    const editorHasTarget = isOpen(editor) &&
      typeof packageEntry !== 'undefined' && packageEntry &&
      String(packageEntry.id) === String(id);
    /* The editor can be open while its report data is still loading. */
    return editorHasTarget;
  }

  function openReportsFallback(params, pageNo) {
    applyFilters(params);
    openReportsModal(false);
    if (typeof currentPage !== 'undefined') currentPage = pageNo || 1;
    loadJurnalPage(true);
  }

  function openPhotosFallback(pageNo) {
    const overlay = document.getElementById('galleryModalOverlay');
    const wasOpen = isOpen(overlay);
    if (!wasOpen) {
      changeMenuIntent();
      overlay.classList.add('is-open');
    }
    const targetPage = Math.max(1, Math.min(9999, Number.parseInt(pageNo || '1', 10) || 1));
    if (!wasOpen || galleryCurrentPage !== targetPage) {
      galleryCurrentPage = targetPage;
      loadGalleryPage(targetPage);
    }
  }

  function fallbackForRoute(view, params, pageNo) {
    if (view === 'report' || view === 'reports') {
      openReportsFallback(params, pageNo);
    } else if (view === 'photo' || view === 'photos') {
      const photoPage = view === 'photo' && params.get('photoSource') === 'gallery'
        ? params.get('photoPage') : pageNo;
      openPhotosFallback(photoPage);
    } else if (view === 'todo') {
      openTodoModal();
    }
    /* Unknown route names stay on home; the final URL sync removes the bad route. */
  }


  function closeViewsForNavigation() {
    document.querySelectorAll('#todoModalOverlay .gallery-modal-close-btn, #reportsModalOverlay .gallery-modal-close-btn, #galleryModalOverlay .gallery-modal-close-btn, #packageManagerOverlay .gallery-modal-close-btn').forEach(button => button.click());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  async function applyAddressRoute() {
    if (routeApplying) return;
    routeApplying = true;
    routeHandled = true;
    restoredModalRoute = false;
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const pageNo = Math.max(1, Math.min(9999, Number.parseInt(params.get('pageNo') || '1', 10) || 1));
    const id = params.get('id');
    applyingAddress = true;
    try {
      closeViewsForNavigation();
      if (view === 'report') {
        applyFilters(params);
        const opened = id ? await openReport(id) : false;
        if (!opened) openReportsFallback(params, pageNo);
      } else if (view === 'photo') {
        let opened = false;
        const photoSource = params.get('photoSource') || 'entry';
        const photoPage = Math.max(1, Math.min(9999, Number.parseInt(params.get('photoPage') || '1', 10) || 1));
        if (id && photoSource === 'home') {
          const dashboard = await waitForDashboardPhotos();
          const photos = photoViewerItems(dashboard && dashboard.latestPhotos);
          const index = photos.findIndex(photo => viewerPhotoFileId(photo.url) === id);
          if (index >= 0) { activePhotoRoute = { source: 'home', pageNo: 1 }; openPhotoViewer(photos, index); opened = true; }
        } else if (id && photoSource === 'gallery') {
          const gallery = await getPreparedGalleryPage(photoPage, 100, () => routeApplying);
          if (gallery && gallery.success !== false) {
            applyGalleryPageData(gallery);
            const photos = photoViewerItems(gallery.photos);
            const index = photos.findIndex(photo => viewerPhotoFileId(photo.url) === id);
            if (index >= 0) { activePhotoRoute = { source: 'gallery', pageNo: photoPage }; openPhotoViewer(photos, index); opened = true; }
          }
        }
        if (id && !opened) opened = await openFocusedPhoto(id);
        if (!opened) openPhotosFallback(photoSource === 'gallery' ? photoPage : 1);
      } else if (view === 'reports') {
        applyFilters(params);
        openReportsModal(false);
        if (typeof currentPage !== 'undefined') currentPage = pageNo;
        loadJurnalPage(true);
      } else if (view === 'photos') {
        openPhotosFallback(pageNo);
      } else if (view === 'todo') {
        openTodoModal();
      }
      if (view && view !== 'home') restoredModalRoute = true;
    } catch (error) {
      console.error('Could not open address-linked view:', error);
      /* Keep the user in the closest useful section if the deep link cannot open. */
      try { fallbackForRoute(view, params, pageNo); } catch (fallbackError) { console.error('Could not open fallback view:', fallbackError); }
      if (view && view !== 'home') restoredModalRoute = true;
    } finally {
      window.setTimeout(() => {
        applyingAddress = false;
        routeApplying = false;
        syncAddress(true);
      }, 0);
    }
  }

  function installRouteHook() {
    const original = window.applyJurnalPageData;
    if (typeof original === 'function' && !original.__addressRouteWrapped) {
      const wrapped = function(...args) {
        const result = original.apply(this, args);
        if (!routeHandled && new URLSearchParams(window.location.search).has('view')) window.setTimeout(applyAddressRoute, 0);
        return result;
      };
      wrapped.__addressRouteWrapped = true;
      window.applyJurnalPageData = wrapped;
    }
  }

  ['openTodoModal', 'openReportsModal', 'openGalleryModal', 'openPhotoViewer', 'loadJurnalPage', 'loadGalleryPage'].forEach(name => hook(name, false));
  ['closePackageManager', 'closeReportsModal', 'closeGalleryModal', 'closeTodoModal', 'closePhotoViewer'].forEach(name => hook(name, true));
  ['onFilterChanged', 'filterByTrainee', 'filterByCompany', 'filterByCategory', 'setQuickPill'].forEach(name => hook(name, true));
  installPhotoViewerSourceHook();
  installRouteHook();

  ['filterCompany', 'filterCategory'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => syncSoon(true));
  });
  const searchBox = document.getElementById('filterSearch');
  if (searchBox) {
    searchBox.addEventListener('input', () => syncSoon(true));
    searchBox.addEventListener('change', () => syncSoon(true));
  }

  const ROUTE_BACKDROPS = new Set(['todoModalOverlay', 'reportsModalOverlay', 'galleryModalOverlay', 'packageManagerOverlay', 'photoViewerOverlay']);
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element) || !ROUTE_BACKDROPS.has(target.id)) return;
    window.setTimeout(() => syncAddress(true), 180);
  }, true);

  const observer = new MutationObserver(() => syncSoon(false));
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'aria-hidden'] });
  window.addEventListener('report-login', () => { if (new URLSearchParams(window.location.search).has('view')) { routeHandled = false; routeApplying = false; window.setTimeout(applyAddressRoute, 0); } }); window.addEventListener('popstate', () => { routeHandled = false; routeApplying = false; applyAddressRoute(); });
  if (new URLSearchParams(window.location.search).has('view')) window.setTimeout(() => { const loginOverlay = document.getElementById('reportLogin'); if (!routeHandled && !isOpen(loginOverlay)) applyAddressRoute(); }, 1200);
})();

