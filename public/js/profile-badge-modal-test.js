(() => {
  const API = "https://api.tnx6.xyz";
  const KEY = "__tnxFeaturedBadgeControllerV8";

  if (window[KEY]?.cleanup) window[KEY].cleanup();

  const timeouts = [];
  let selected = [];
  let roles = { moderator: false, vip: false };
  let isOwner = false;
  let profileLogin = "";
  let activeCategory = "الكل";
  let searchQuery = "";

  const $ = (id) => document.getElementById(id);
  const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();

  function getProfileLogin() {
    const candidates = [
      $("handle"),
      $("login"),
      $("username"),
      document.querySelector("[data-login]"),
      document.querySelector("[data-user-login]")
    ].filter(Boolean);

    for (const el of candidates) {
      const raw = clean(el.dataset?.login || el.dataset?.userLogin || el.textContent || "");
      const login = raw.replace(/^@+/, "").toLowerCase();
      if (/^[a-z0-9_]{3,25}$/.test(login)) return login;
    }

    const match = clean(document.body.innerText || "").match(/@([a-zA-Z0-9_]{3,25})/);
    return match?.[1]?.toLowerCase() || "";
  }

  async function getMe() {
    try {
      const res = await fetch(API + "/api/me", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      return data?.authenticated ? data.user : null;
    } catch {
      return null;
    }
  }

  async function loadSavedBadges(login) {
    if (!login) return [];

    try {
      const url = new URL(API + "/api/profile/featured-badges");
      url.searchParams.set("login", login);

      const res = await fetch(url.toString(), { credentials: "include", cache: "no-store" });
      const data = await res.json();

      return Array.isArray(data?.badges)
        ? data.badges.map(clean).filter(Boolean).slice(0, 3)
        : [];
    } catch {
      return [];
    }
  }

  async function loadRoles(login) {
    if (!login) return { moderator: false, vip: false };

    try {
      const url = new URL(API + "/api/twitch/roles");
      url.searchParams.set("login", login);

      const res = await fetch(url.toString(), { credentials: "include", cache: "no-store" });
      const data = await res.json();

      if (!data?.ok || !data?.available || !data?.roles) {
        return { moderator: false, vip: false };
      }

      return {
        moderator: Boolean(data.roles.moderator),
        vip: Boolean(data.roles.vip)
      };
    } catch {
      return { moderator: false, vip: false };
    }
  }

  function scoreBadge(name) {
    const text = String(name || "").toLowerCase();

    if (text.includes("king") || text.includes("ملك")) return 1000;
    if (text.includes("law") || text.includes("محامي") || text.includes("قانون")) return 900;
    if (text.includes("mythic")) return 850;
    if (text.includes("legendary")) return 800;
    if (text.includes("1000q") || text.includes("1000")) return 760;
    if (text.includes("1m") || text.includes("مليون")) return 740;
    if (text.includes("500k")) return 720;
    if (text.includes("250k")) return 700;
    if (text.includes("100k")) return 680;
    if (text.includes("600q") || text.includes("600")) return 660;
    if (text.includes("300q") || text.includes("300")) return 640;
    if (text.includes("150q") || text.includes("150")) return 620;
    if (text.includes("50q") || text.includes("50")) return 600;
    if (text.includes("60d") || text.includes("60")) return 560;
    if (text.includes("30d") || text.includes("30")) return 540;
    if (text.includes("15d") || text.includes("15")) return 520;

    return 100;
  }

  function badgeCategory(name) {
    const raw = String(name || "").trim();
    const text = raw.toLowerCase();
    const upper = raw.toUpperCase();

    // النقاط لازم تكون قبل الأسئلة لأن 250K فيها 50
    if (
      /(^|[^A-Z0-9])(100K|250K|500K|1M)([^A-Z0-9]|$)/.test(upper) ||
      upper.includes("100K") ||
      upper.includes("250K") ||
      upper.includes("500K") ||
      upper.includes("1M") ||
      text.includes("نقطة") ||
      text.includes("نقاط") ||
      text.includes("gold")
    ) {
      return "النقاط";
    }

    if (
      /(^|[^A-Z0-9])(50Q|150Q|300Q|600Q|1000Q)([^A-Z0-9]|$)/.test(upper) ||
      upper.includes("50Q") ||
      upper.includes("150Q") ||
      upper.includes("300Q") ||
      upper.includes("600Q") ||
      upper.includes("1000Q") ||
      text.includes("سؤال") ||
      text.includes("أسئلة") ||
      text.includes("اسئلة") ||
      text.includes("إجابة") ||
      text.includes("اجابة")
    ) {
      return "الأسئلة";
    }

    if (
      /(^|[^A-Z0-9])(15D|30D|60D|100D|150D)([^A-Z0-9]|$)/.test(upper) ||
      upper.includes("15D") ||
      upper.includes("30D") ||
      upper.includes("60D") ||
      upper.includes("100D") ||
      upper.includes("150D") ||
      text.includes("حضور") ||
      text.includes("يوم") ||
      text.includes("ستريك")
    ) {
      return "الحضور";
    }

    if (
      text.includes("vip") ||
      text.includes("king") ||
      text.includes("ملك") ||
      text.includes("law") ||
      text.includes("محامي") ||
      text.includes("قاضي") ||
      text.includes("خاص")
    ) {
      return "خاصة";
    }

    return "عام";
  }

  function getInventory() {
    const box = $("badges");
    if (!box) return [];

    return Array.from(box.querySelectorAll(".badge"))
      .map((node) => {
        const name =
          clean(node.querySelector?.(".badge-name")?.textContent) ||
          clean(node.getAttribute?.("title")) ||
          clean(node.getAttribute?.("aria-label")) ||
          clean(node.textContent);

        const img = node.querySelector?.("img");

        return {
          type: "inventory",
          key: name,
          name,
          img: img?.getAttribute("src") || "",
          score: scoreBadge(name),
          category: badgeCategory(name)
        };
      })
      .filter((badge) => badge.key && badge.key !== "بادج");
  }

  function getRoleBadges() {
    const arr = [];

    if (roles.moderator) {
      arr.push({ type: "role", role: "mod", key: "__mod", name: "Twitch Moderator", icon: "MOD" });
    }

    if (roles.vip) {
      arr.push({ type: "role", role: "vip", key: "__vip", name: "Twitch VIP", icon: "VIP" });
    }

    return arr;
  }

  function makeMiniBadge(badge) {
    const el = document.createElement("span");
    el.className = "featured-mini-badge" + (badge.role ? " role-" + badge.role : "");
    el.setAttribute("data-tip", badge.name);
    el.setAttribute("aria-label", badge.name);

    if (badge.img && badge.type === "inventory") {
      const img = document.createElement("img");
      img.src = badge.img;
      img.alt = badge.name;
      img.loading = "lazy";
      el.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.textContent = badge.icon || "✦";
      el.appendChild(span);
    }

    return el;
  }

  function makePlusButton() {
    const btn = document.createElement("button");
    btn.id = "featuredBadgePlusTest";
    btn.type = "button";
    btn.className = "featured-badge-plus-test";
    btn.innerHTML = '<span class="featured-badge-plus-inner">+</span>';
    btn.title = "اختيار البادجات";
    btn.setAttribute("aria-label", "اختيار البادجات");

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openModal();
    });

    return btn;
  }

  function renderTop() {
    const target = $("featuredBadges");
    if (!target) return;

    const inventory = getInventory();
    const map = new Map(inventory.map((badge) => [badge.key, badge]));

    const picked = selected.length
      ? selected.map((key) => map.get(key)).filter(Boolean).slice(0, 3)
      : inventory.slice().sort((a, b) => b.score - a.score).slice(0, 3);

    const finalBadges = [...picked, ...getRoleBadges()];

    target.innerHTML = "";

    finalBadges.forEach((badge) => target.appendChild(makeMiniBadge(badge)));

    if (isOwner) target.appendChild(makePlusButton());

    target.classList.remove("hidden");
  }

  function ensureModal() {
    if ($("featuredBadgeModalTest")) return;

    const modal = document.createElement("div");
    modal.id = "featuredBadgeModalTest";
    modal.className = "featured-badge-modal-test hidden";

    modal.innerHTML = `
      <button class="featured-badge-modal-backdrop" type="button" aria-label="إغلاق"></button>

      <div class="featured-badge-modal-panel" role="dialog" aria-modal="true">
        <div class="featured-badge-modal-handle"></div>

        <div class="featured-badge-modal-head">
          <div>
            <h3>اختيار البادجات</h3>
            <p id="featuredBadgeModalState">اختر حتى 3 بادجات من مخزونك.</p>
          </div>

          <span id="featuredBadgeCounter" class="featured-badge-counter">0 / 3</span>
        </div>

        <div class="featured-badge-search">
          <span>⌕</span>
          <input id="featuredBadgeSearch" type="text" placeholder="ابحث عن بادج..." autocomplete="off">
        </div>

        <div id="featuredBadgeCategories" class="featured-badge-categories"></div>

        <div id="featuredBadgeSelectedStrip" class="featured-badge-selected-strip"></div>

        <div id="featuredBadgeModalGrid" class="featured-badge-modal-grid"></div>

        <div class="featured-badge-modal-actions">
          <button id="featuredBadgeCancel" class="featured-badge-cancel" type="button">إلغاء</button>
          <button id="featuredBadgeModalSave" class="featured-badge-modal-save" type="button">حفظ الاختيار</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector(".featured-badge-modal-backdrop")?.addEventListener("click", closeModal);
    $("featuredBadgeCancel")?.addEventListener("click", closeModal);
    $("featuredBadgeSearch")?.addEventListener("input", (event) => {
      searchQuery = event.target.value || "";
      renderPicker();
    });
    $("featuredBadgeModalSave")?.addEventListener("click", saveSelection);
  }

  function setState(message) {
    const state = $("featuredBadgeModalState");
    if (state) state.textContent = message;

    const counter = $("featuredBadgeCounter");
    if (counter) counter.textContent = `${selected.length} / 3`;
  }

  function renderCategories() {
    const row = $("featuredBadgeCategories");
    if (!row) return;

    const inventory = getInventory();
    const categories = ["الكل", ...Array.from(new Set(inventory.map((b) => b.category)))];

    row.innerHTML = "";

    categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "featured-badge-cat" + (cat === activeCategory ? " active" : "");
      btn.textContent = cat;

      btn.addEventListener("click", () => {
        activeCategory = cat;
        renderCategories();
        renderPicker();
      });

      row.appendChild(btn);
    });
  }

  function filteredInventory() {
    let badges = getInventory();

    if (activeCategory !== "الكل") {
      badges = badges.filter((badge) => badge.category === activeCategory);
    }

    const q = clean(searchQuery).toLowerCase();
    if (q) {
      badges = badges.filter((badge) => badge.name.toLowerCase().includes(q));
    }

    return badges;
  }

  function renderSelectedStrip() {
    const strip = $("featuredBadgeSelectedStrip");
    if (!strip) return;

    const inventory = getInventory();
    const map = new Map(inventory.map((badge) => [badge.key, badge]));

    strip.innerHTML = "";

    if (!selected.length) {
      const empty = document.createElement("div");
      empty.className = "featured-badge-selected-empty";
      empty.textContent = "ما اخترت أي بادج بعد.";
      strip.appendChild(empty);
      return;
    }

    selected.slice(0, 3).forEach((key) => {
      const badge = map.get(key);
      if (!badge) return;

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "featured-badge-selected-chip";
      chip.title = "إزالة " + badge.name;

      const icon = document.createElement("span");
      icon.className = "featured-badge-selected-icon";

      if (badge.img) {
        const img = document.createElement("img");
        img.src = badge.img;
        img.alt = badge.name;
        img.loading = "lazy";
        icon.appendChild(img);
      } else {
        icon.textContent = "✦";
      }

      const label = document.createElement("span");
      label.className = "featured-badge-selected-label";
      label.textContent = badge.name;

      const remove = document.createElement("span");
      remove.className = "featured-badge-selected-remove";
      remove.textContent = "×";

      chip.appendChild(icon);
      chip.appendChild(label);
      chip.appendChild(remove);

      chip.addEventListener("click", () => {
        selected = selected.filter((item) => item !== key);
        renderPicker();
      });

      strip.appendChild(chip);
    });
  }

  function renderPicker() {
    const grid = $("featuredBadgeModalGrid");
    if (!grid) return;

    const badges = filteredInventory();
    grid.innerHTML = "";

    setState(`اختر حتى 3 بادجات من مخزونك. المختار: ${selected.length}/3`);
    renderSelectedStrip();

    if (!badges.length) {
      const empty = document.createElement("div");
      empty.className = "featured-badge-empty";
      empty.textContent = "لا توجد بادجات مطابقة.";
      grid.appendChild(empty);
      return;
    }

    badges.forEach((badge) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "featured-badge-option";
      btn.classList.toggle("selected", selected.includes(badge.key));

      const check = document.createElement("span");
      check.className = "featured-badge-check";
      check.textContent = "✓";

      const icon = document.createElement("span");
      icon.className = "featured-badge-option-icon";

      if (badge.img) {
        const img = document.createElement("img");
        img.src = badge.img;
        img.alt = badge.name;
        img.loading = "lazy";
        icon.appendChild(img);
      } else {
        icon.textContent = "✦";
      }

      const label = document.createElement("span");
      label.className = "featured-badge-option-label";
      label.textContent = badge.name;

      const category = document.createElement("span");
      category.className = "featured-badge-option-desc";
      category.textContent = badge.category;

      btn.appendChild(check);
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.appendChild(category);

      btn.addEventListener("click", () => {
        if (selected.includes(badge.key)) {
          selected = selected.filter((key) => key !== badge.key);
        } else {
          if (selected.length >= 3) {
            setState("تقدر تختار 3 بادجات فقط.");
            return;
          }

          selected.push(badge.key);
        }

        renderPicker();
      });

      grid.appendChild(btn);
    });
  }

  function openModal() {
    if (!isOwner) return;

    activeCategory = "الكل";
    searchQuery = "";

    ensureModal();

    const search = $("featuredBadgeSearch");
    if (search) search.value = "";

    renderCategories();
    renderPicker();

    const modal = $("featuredBadgeModalTest");
    modal?.classList.remove("hidden");
    modal?.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    const modal = $("featuredBadgeModalTest");
    modal?.classList.add("hidden");
    modal?.setAttribute("aria-hidden", "true");
  }

  function showFeaturedToast(message) {
    let toast = $("featuredBadgeToast");

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "featuredBadgeToast";
      toast.className = "featured-badge-toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("show");

    window.clearTimeout(toast.__hideTimer);
    toast.__hideTimer = window.setTimeout(() => {
      toast.classList.remove("show");
    }, 2200);
  }

  async function saveSelection() {
    const saveBtn = $("featuredBadgeModalSave");

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "جاري الحفظ...";
      }

      const res = await fetch(API + "/api/me/featured-badges", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ badges: selected.slice(0, 3) })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) throw new Error(data?.error || "save_failed");

      selected = Array.isArray(data.badges)
        ? data.badges.map(clean).filter(Boolean).slice(0, 3)
        : selected.slice(0, 3);

      renderTop();
      enhanceBadgesSection();
      setState("تم حفظ الاختيار.");
      showFeaturedToast("تم حفظ البادجات");
      setTimeout(closeModal, 500);
    } catch {
      setState("فشل حفظ البادجات. جرّب مرة ثانية.");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "حفظ الاختيار";
      }
    }
  }


  const badgeSectionState = {
    filter: "الكل",
    expanded: false
  };

  const badgeSectionFilters = [
    "الكل",
    "المميزة",
    "الأسئلة",
    "الحضور",
    "النقاط",
    "خاصة",
    "عام"
  ];

  function readBadgeNode(node) {
    const name =
      clean(node.querySelector?.(".badge-name")?.textContent) ||
      clean(node.getAttribute?.("title")) ||
      clean(node.getAttribute?.("aria-label")) ||
      clean(node.textContent);

    const img = node.querySelector?.("img");

    return {
      node,
      key: name,
      name,
      img: img?.getAttribute("src") || "",
      category: badgeCategory(name),
      isFeatured: selected.includes(name)
    };
  }

  function ensureBadgesToolbar(box) {
    if ($("profileBadgeEnhanceToolbar")) return;

    const toolbar = document.createElement("div");
    toolbar.id = "profileBadgeEnhanceToolbar";
    toolbar.className = "profile-badges-toolbar";

    toolbar.innerHTML = `
      <div class="profile-badges-toolbar-main">
        <div>
          <div class="profile-badges-toolbar-title">البادجات</div>
          <div id="profileBadgeEnhanceCount" class="profile-badges-toolbar-count">0 بادج</div>
        </div>

        <div class="profile-badges-filters" id="profileBadgeEnhanceFilters"></div>
      </div>
    `;

    box.parentElement?.insertBefore(toolbar, box);

    const filters = $("profileBadgeEnhanceFilters");
    if (filters) {
      badgeSectionFilters.forEach((filter) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "profile-badge-filter";
        btn.dataset.filter = filter;
        btn.textContent = filter;

        btn.addEventListener("click", () => {
          badgeSectionState.filter = filter;
          badgeSectionState.expanded = false;
          enhanceBadgesSection();
        });

        filters.appendChild(btn);
      });
    }
  }

  function ensureShowMoreButton(box) {
    if ($("profileBadgeShowMore")) return;

    const wrap = document.createElement("div");
    wrap.className = "profile-badge-showmore-wrap";

    const btn = document.createElement("button");
    btn.id = "profileBadgeShowMore";
    btn.type = "button";
    btn.className = "profile-badge-showmore";
    btn.textContent = "عرض الكل";

    btn.addEventListener("click", () => {
      badgeSectionState.expanded = !badgeSectionState.expanded;
      enhanceBadgesSection();
    });

    wrap.appendChild(btn);
    box.parentElement?.insertBefore(wrap, box.nextSibling);
  }

  function updateBadgeFilterButtons() {
    document.querySelectorAll(".profile-badge-filter").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.filter === badgeSectionState.filter);
    });
  }

  function enhanceBadgesSection() {
    const box = $("badges");
    if (!box) return;

    const nodes = Array.from(box.querySelectorAll(".badge"));
    if (!nodes.length) return;

    ensureBadgesToolbar(box);
    ensureShowMoreButton(box);

    box.classList.add("tnx-profile-badges-grid");

    const items = nodes
      .map(readBadgeNode)
      .filter((item) => item.key && item.key !== "بادج");

    items.forEach((item) => {
      item.node.classList.add("tnx-profile-badge-card");
      item.node.classList.toggle("is-featured", item.isFeatured);
      item.node.dataset.category = item.category;
      item.node.dataset.categoryLabel = item.category;
      item.node.dataset.badgeName = item.name;
    });

    const sorted = items.slice().sort((a, b) => {
      if (a.isFeatured && !b.isFeatured) return -1;
      if (!a.isFeatured && b.isFeatured) return 1;

      const order = {
        "الأسئلة": 1,
        "الحضور": 2,
        "النقاط": 3,
        "خاصة": 4,
        "عام": 5
      };

      const ac = order[a.category] || 99;
      const bc = order[b.category] || 99;

      if (ac !== bc) return ac - bc;
      return a.name.localeCompare(b.name, "ar");
    });

    sorted.forEach((item) => {
      box.appendChild(item.node);
    });

    const filtered = sorted.filter((item) => {
      if (badgeSectionState.filter === "الكل") return true;
      if (badgeSectionState.filter === "المميزة") return item.isFeatured;
      return item.category === badgeSectionState.filter;
    });

    const limit = 8;
    const visible = badgeSectionState.expanded ? filtered : filtered.slice(0, limit);
    const visibleSet = new Set(visible.map((item) => item.node));

    sorted.forEach((item) => {
      item.node.classList.toggle("tnx-badge-hidden-by-filter", !visibleSet.has(item.node));
    });

    const count = $("profileBadgeEnhanceCount");
    if (count) {
      const featuredCount = sorted.filter((item) => item.isFeatured).length;
      count.textContent = `${filtered.length} بادج • ${featuredCount} مميزة`;
    }

    const showMore = $("profileBadgeShowMore");
    if (showMore) {
      const shouldShow = filtered.length > limit;
      showMore.classList.toggle("hidden", !shouldShow);
      showMore.textContent = badgeSectionState.expanded ? "عرض أقل" : "عرض الكل";
    }

    updateBadgeFilterButtons();
  }


  async function setup() {
    const me = await getMe();

    profileLogin = getProfileLogin() || String(me?.login || "").toLowerCase();
    if (!profileLogin) return;

    isOwner = Boolean(me?.login && String(me.login).toLowerCase() === profileLogin);

    const [saved, loadedRoles] = await Promise.all([
      loadSavedBadges(profileLogin),
      loadRoles(profileLogin)
    ]);

    selected = saved.slice(0, 3);
    roles = loadedRoles;

    renderTop();
      enhanceBadgesSection();
  }

  [900, 1800, 3200].forEach((ms) => {
    const id = setTimeout(setup, ms);
    timeouts.push(id);
  });

  window[KEY] = {
    cleanup() {
      timeouts.forEach((id) => clearTimeout(id));
      $("featuredBadgeModalTest")?.remove();
      $("featuredBadgePlusTest")?.remove();
    }
  };
})();
