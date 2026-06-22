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
  let selectionBaseline = "";
  let featuredPickerFrame = 0;

  function scheduleRenderPicker() {
    window.cancelAnimationFrame(featuredPickerFrame);
    featuredPickerFrame = window.requestAnimationFrame(() => {
      renderPicker();
    });
  }

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
    const hasInventoryBadges = inventory.length > 0;
    const map = new Map(inventory.map((badge) => [badge.key, badge]));

    // لا نعرض أي بادج تلقائيًا إذا selected فاضي
    const picked = selected
      .map((key) => map.get(key))
      .filter(Boolean)
      .slice(0, 3);

    const finalBadges = [
      ...picked,
      ...getRoleBadges()
    ];

    target.innerHTML = "";

    // إذا ما فيه بادجات مختارة ولا MOD/VIP ولا زر اختيار، نخفي السطر كامل
    if (!finalBadges.length && !(isOwner && hasInventoryBadges)) {
      target.classList.add("hidden");
      return;
    }

    finalBadges.forEach((badge) => {
      target.appendChild(makeMiniBadge(badge));
    });

    // زر + يبقى ظاهر لصاحب البروفايل إذا عنده بادجات يقدر يختار منها
    if (isOwner && hasInventoryBadges) {
      target.appendChild(makePlusButton());
    }

    target.classList.remove("hidden");
  }

  function ensureModal() {
    if ($("featuredBadgeModalTest")) return;

    const modal = document.createElement("div");
    modal.id = "featuredBadgeModalTest";
    modal.className = "featured-badge-modal-test hidden";

    modal.innerHTML = [
      '<button class="featured-badge-modal-backdrop" type="button" aria-label="إغلاق"></button>',
      '<div class="featured-badge-modal-panel" role="dialog" aria-modal="true">',
        '<div class="featured-badge-modal-handle"></div>',

        '<button id="featuredBadgeCloseX" class="featured-badge-modal-x" type="button" aria-label="إغلاق">×</button>',

        '<div class="featured-badge-modal-head">',
          '<div>',
            '<h3>اختيار البادجات</h3>',
            '<p id="featuredBadgeModalState">',
              '<span id="featuredBadgeStateText">اختر حتى 3 بادجات من مخزونك.</span>',
              '<span class="featured-badge-role-note">MOD / VIP لا تُحسب من الحد 3</span>',
            '</p>',
          '</div>',
          '<span id="featuredBadgeCounter" class="featured-badge-counter">0 / 3</span>',
        '</div>',

        '<div class="featured-badge-search">',
          '<span>⌕</span>',
          '<input id="featuredBadgeSearch" type="text" placeholder="ابحث عن بادج..." autocomplete="off">',
        '</div>',

        '<div id="featuredBadgeCategories" class="featured-badge-categories"></div>',

        '<div class="featured-badge-selected-head">',
          '<span>المختارة الآن</span>',
          '<button id="featuredBadgeClear" class="featured-badge-clear" type="button">مسح الاختيار</button>',
        '</div>',

        '<div id="featuredBadgeSelectedStrip" class="featured-badge-selected-strip"></div>',

        '<div id="featuredBadgeModalGrid" class="featured-badge-modal-grid"></div>',

        '<div class="featured-badge-modal-actions">',
          '<button id="featuredBadgeCancel" class="featured-badge-cancel" type="button">إلغاء</button>',
          '<button id="featuredBadgeModalSave" class="featured-badge-modal-save" type="button">حفظ الاختيار</button>',
        '</div>',
      '</div>'
    ].join("");

    document.body.appendChild(modal);

    modal.querySelector(".featured-badge-modal-backdrop")?.addEventListener("click", closeModal);
    $("featuredBadgeCloseX")?.addEventListener("click", closeModal);
    $("featuredBadgeCancel")?.addEventListener("click", closeModal);

    $("featuredBadgeClear")?.addEventListener("click", () => {
      selected = [];

      if (typeof scheduleRenderPicker === "function") {
        scheduleRenderPicker();
      } else {
        renderPicker();
      }
    });

    $("featuredBadgeSearch")?.addEventListener("input", (event) => {
      searchQuery = event.target.value || "";

      if (typeof scheduleRenderPicker === "function") {
        scheduleRenderPicker();
      } else {
        renderPicker();
      }
    });

    $("featuredBadgeModalSave")?.addEventListener("click", saveSelection);
  }

  function setState(message) {
    const state = $("featuredBadgeStateText") || $("featuredBadgeModalState");
    if (state) state.textContent = message;

    const counter = $("featuredBadgeCounter");
    if (counter) {
      counter.textContent = selected.length + " / 3";
      counter.classList.toggle("is-full", selected.length >= 3);
    }

    updateSaveButton();
  }

  function selectionKey(list = selected) {
    return list.slice(0, 3).join("\u001f");
  }

  function isSelectionDirty() {
    return selectionKey() !== selectionBaseline;
  }

  function updateSaveButton() {
    const saveBtn = $("featuredBadgeModalSave");
    const clearBtn = $("featuredBadgeClear");

    if (saveBtn) {
      const dirty = isSelectionDirty();
      saveBtn.disabled = !dirty;
      saveBtn.textContent = dirty ? "حفظ الاختيار" : "لا توجد تغييرات";
    }

    if (clearBtn) {
      clearBtn.disabled = selected.length === 0;
    }
  }

  function normalizeSearchText(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[إأآا]/g, "ا")
      .replace(/[ة]/g, "ه")
      .replace(/\s+/g, " ");
  }

  function badgeSearchHaystack(badge) {
    const categoryAliases = {
      "النقاط": "النقاط نقاط نقطة gold ذهب عملات كوينز coins 100k 250k 500k 1m",
      "الأسئلة": "الأسئلة الاسئلة اسئله سؤال اساله quiz q اجابه اجابات",
      "الحضور": "الحضور حضور يوم ايام ستريك streak daily d",
      "خاصة": "خاصة خاص vip mod king law ملك محامي قاضي",
      "عام": "عام"
    };

    return normalizeSearchText([
      badge.name,
      badge.key,
      badge.category,
      categoryAliases[badge.category] || ""
    ].join(" "));
  }

  function badgeCategoryOrder(category) {
    const order = {
      "خاصة": 1,
      "النقاط": 2,
      "الأسئلة": 3,
      "الحضور": 4,
      "عام": 5
    };

    return order[category] || 99;
  }

  function sortPickerBadges(badges) {
    return badges.slice().sort((a, b) => {
      const aPicked = selected.includes(a.key);
      const bPicked = selected.includes(b.key);

      if (aPicked && !bPicked) return -1;
      if (!aPicked && bPicked) return 1;

      const categoryDiff = badgeCategoryOrder(a.category) - badgeCategoryOrder(b.category);
      if (categoryDiff !== 0) return categoryDiff;

      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0);
      }

      return a.name.localeCompare(b.name, "ar");
    });
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

        if (typeof scheduleRenderPicker === "function") {
          scheduleRenderPicker();
        } else {
          renderPicker();
        }
      });

      row.appendChild(btn);
    });
  }

  function filteredInventory() {
    let badges = getInventory();

    if (activeCategory !== "الكل") {
      badges = badges.filter((badge) => badge.category === activeCategory);
    }

    const q = normalizeSearchText(searchQuery);

    if (q) {
      badges = badges.filter((badge) => badgeSearchHaystack(badge).includes(q));
    }

    return badges;
  }

  function renderSelectedStrip() {
    const strip = $("featuredBadgeSelectedStrip");
    if (!strip) return;

    const inventory = getInventory();
    const map = new Map(inventory.map((badge) => [badge.key, badge]));

    strip.innerHTML = "";

    const clearBtn = $("featuredBadgeClear");
    if (clearBtn) {
      clearBtn.disabled = selected.length === 0;
    }

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

        if (typeof scheduleRenderPicker === "function") {
          scheduleRenderPicker();
        } else {
          renderPicker();
        }
      });

      strip.appendChild(chip);
    });
  }

  function renderPicker() {
    const grid = $("featuredBadgeModalGrid");
    if (!grid) return;

    const inventory = getInventory();
    const badges = sortPickerBadges(filteredInventory());

    grid.innerHTML = "";

    setState("اختر حتى 3 بادجات من مخزونك. المختار: " + selected.length + "/3");
    renderSelectedStrip();
    updateSaveButton();

    if (!inventory.length) {
      const empty = document.createElement("div");
      empty.className = "featured-badge-empty";
      empty.innerHTML = '<strong>ما عندك بادجات حاليًا</strong><span>اجمع البادجات من التفاعل، الأسئلة، والحضور.</span>';
      grid.appendChild(empty);
      return;
    }

    if (!badges.length) {
      const empty = document.createElement("div");
      empty.className = "featured-badge-empty";
      empty.innerHTML = '<strong>لا توجد بادجات مطابقة</strong><span>جرّب البحث باسم البادج أو القسم مثل: نقاط، أسئلة، حضور.</span>';
      grid.appendChild(empty);
      return;
    }

    badges.forEach((badge) => {
      const isPicked = selected.includes(badge.key);
      const isLocked = selected.length >= 3 && !isPicked;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "featured-badge-option" + (isPicked ? " selected" : "") + (isLocked ? " locked" : "");
      btn.setAttribute("aria-pressed", isPicked ? "true" : "false");

      if (isLocked) {
        btn.setAttribute("aria-disabled", "true");
      }

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

            btn.classList.remove("limit-hit");
            void btn.offsetWidth;
            btn.classList.add("limit-hit");

            window.setTimeout(() => {
              btn.classList.remove("limit-hit");
            }, 650);

            return;
          }

          selected.push(badge.key);
        }

        if (typeof scheduleRenderPicker === "function") {
          scheduleRenderPicker();
        } else {
          renderPicker();
        }
      });

      grid.appendChild(btn);
    });
  }

  function openModal() {
    if (!isOwner) return;

    const inventory = getInventory();

    if (!inventory.length) {
      if (typeof showFeaturedToast === "function") {
        showFeaturedToast("ما عندك بادجات للاختيار");
      }

      return;
    }

    activeCategory = "الكل";
    searchQuery = "";
    selectionBaseline = selectionKey(selected);

    ensureModal();

    const search = $("featuredBadgeSearch");
    if (search) search.value = "";

    renderCategories();
    renderPicker();
    updateSaveButton();

    const modal = $("featuredBadgeModalTest");
    modal?.classList.remove("hidden");
    modal?.setAttribute("aria-hidden", "false");

    window.setTimeout(() => {
      if (window.innerWidth >= 820) {
        $("featuredBadgeSearch")?.focus();
      }
    }, 80);
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

    if (!isSelectionDirty()) {
      updateSaveButton();
      return;
    }

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

      selectionBaseline = selectionKey(selected);

      renderTop();
      setState("تم حفظ الاختيار.");
      showFeaturedToast("تم حفظ البادجات ✓");
      updateSaveButton();

      setTimeout(closeModal, 500);
    } catch {
      setState("فشل حفظ البادجات. جرّب مرة ثانية.");
    } finally {
      updateSaveButton();
    }
  }


  /* Badge details modal */
  function badgeDetailCategory(name, fallback = "") {
    const cleanFallback = clean(fallback);
    if (cleanFallback) return cleanFallback;
    if (typeof badgeCategory === "function") return badgeCategory(name);
    return "عام";
  }

  function badgeDetailRarity(name, category) {
    const text = clean([name, category].join(" ")).toLowerCase();
    if (/1m|1000q|king|ملك|vip|mod/.test(text)) return "أسطوري";
    if (/500k|600q|150d|law|قاضي|محامي/.test(text)) return "نادر جدًا";
    if (/250k|300q|100d/.test(text)) return "نادر";
    if (/100k|150q|60d/.test(text)) return "مميز";
    return "عادي";
  }

  function badgeDetailHowToGet(name, category) {
    const text = clean(name);
    const lower = text.toLowerCase();

    const pointsMatch = lower.match(/(100k|250k|500k|1m)/i);
    if (pointsMatch) {
      const map = {
        "100k": "امتلاك 100,000 نقطة",
        "250k": "امتلاك 250,000 نقطة",
        "500k": "امتلاك 500,000 نقطة",
        "1m": "امتلاك 1,000,000 نقطة"
      };
      return map[pointsMatch[1].toLowerCase()] || "الوصول لعدد نقاط محدد";
    }

    const qMatch = lower.match(/(50|150|300|600|1000)q/i);
    if (qMatch) return "الإجابة على " + qMatch[1] + " سؤال بشكل صحيح";

    const dMatch = lower.match(/(15|30|60|100|150)d/i);
    if (dMatch) return "الحضور أو الحفاظ على التفاعل لمدة " + dMatch[1] + " يوم";

    if (/vip/i.test(lower)) return "بادج رسمي يظهر حسب حالة VIP في قناة Twitch";
    if (/mod/i.test(lower)) return "بادج رسمي يظهر حسب حالة Moderator في قناة Twitch";
    if (/king|ملك/i.test(lower)) return "بادج خاص مرتبط بنظام الأدوار أو الإنجازات";
    if (/law|محامي|قاضي/i.test(lower)) return "بادج خاص مرتبط بنظام المحكمة أو الأدوار القانونية";

    if (category === "النقاط") return "يتم الحصول عليه من خلال جمع النقاط";
    if (category === "الأسئلة") return "يتم الحصول عليه من خلال الإجابة على الأسئلة";
    if (category === "الحضور") return "يتم الحصول عليه من خلال الحضور والتفاعل";
    if (category === "خاصة") return "بادج خاص يتم منحه حسب النظام أو الفعاليات";

    return "يتم الحصول عليه من التفاعل داخل المجتمع";
  }

  function ensureBadgeDetailModal() {
    if ($("badgeDetailModal")) return;

    const modal = document.createElement("div");
    modal.id = "badgeDetailModal";
    modal.className = "badge-detail-modal hidden";

    modal.innerHTML = [
      '<button class="badge-detail-backdrop" type="button" aria-label="إغلاق"></button>',
      '<div class="badge-detail-panel" role="dialog" aria-modal="true">',
        '<button id="badgeDetailClose" class="badge-detail-close" type="button" aria-label="إغلاق">×</button>',
        '<div class="badge-detail-icon" id="badgeDetailIcon">✦</div>',
        '<div class="badge-detail-content">',
          '<span id="badgeDetailCategory" class="badge-detail-category">عام</span>',
          '<h3 id="badgeDetailTitle">اسم البادج</h3>',
          '<p id="badgeDetailHow">طريقة الحصول</p>',
          '<div class="badge-detail-meta">',
            '<div><span>الحالة</span><strong id="badgeDetailOwned">مملوك</strong></div>',
            '<div><span>الندرة</span><strong id="badgeDetailRarity">عادي</strong></div>',
          '</div>',
        '</div>',
      '</div>'
    ].join("");

    document.body.appendChild(modal);

    modal.querySelector(".badge-detail-backdrop")?.addEventListener("click", closeBadgeDetail);
    $("badgeDetailClose")?.addEventListener("click", closeBadgeDetail);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeBadgeDetail();
    });
  }

  function closeBadgeDetail() {
    const modal = $("badgeDetailModal");
    modal?.classList.add("hidden");
    modal?.setAttribute("aria-hidden", "true");
  }

  function openBadgeDetail(rawBadge = {}, owned = true) {
    ensureBadgeDetailModal();

    const name = clean(rawBadge.name || rawBadge.key || "بادج");
    const category = badgeDetailCategory(name, rawBadge.category || "");
    const img = rawBadge.img || "";

    const icon = $("badgeDetailIcon");
    if (icon) {
      icon.innerHTML = "";

      if (img) {
        const image = document.createElement("img");
        image.src = img;
        image.alt = name;
        image.loading = "lazy";
        icon.appendChild(image);
      } else {
        icon.textContent = "✦";
      }
    }

    $("badgeDetailTitle").textContent = name;
    $("badgeDetailCategory").textContent = category;
    $("badgeDetailHow").textContent = badgeDetailHowToGet(name, category);
    $("badgeDetailOwned").textContent = owned ? "مملوك" : "غير مملوك";
    $("badgeDetailRarity").textContent = badgeDetailRarity(name, category);

    const modal = $("badgeDetailModal");
    modal?.classList.remove("hidden");
    modal?.setAttribute("aria-hidden", "false");
  }

  function badgeFromElement(element) {
    if (!element) return null;

    const name = clean(
      element.getAttribute("data-badge-name") ||
      element.getAttribute("title") ||
      element.getAttribute("aria-label") ||
      element.querySelector?.(".badge-name")?.textContent ||
      element.querySelector?.(".featured-badge-option-label")?.textContent ||
      element.textContent ||
      ""
    )
      .replace(/^اختيار\s*البادجات$/i, "")
      .replace(/^تفاصيل\s*البادج$/i, "")
      .replace(/^i$/i, "")
      .replace(/^\+$/, "");

    if (!name) return null;

    const category = clean(
      element.getAttribute("data-badge-category") ||
      element.querySelector?.(".featured-badge-option-desc")?.textContent ||
      ""
    );

    return {
      key: name,
      name,
      category: badgeDetailCategory(name, category),
      img: element.querySelector?.("img")?.src || ""
    };
  }

  function decorateBadgeOptionsForDetails() {
    const grid = $("featuredBadgeModalGrid");
    if (!grid) return;

    grid.querySelectorAll(".featured-badge-option").forEach((card) => {
      if (card.querySelector(".featured-badge-info")) return;

      const info = document.createElement("button");
      info.type = "button";
      info.className = "featured-badge-info";
      info.textContent = "i";
      info.title = "تفاصيل البادج";
      info.setAttribute("aria-label", "تفاصيل البادج");

      info.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const badge = badgeFromElement(card);
        if (badge) openBadgeDetail(badge, true);
      });

      card.appendChild(info);
    });
  }

  function setupBadgeDetailDelegation() {
    if (window.__tnxBadgeDetailDelegation) return;
    window.__tnxBadgeDetailDelegation = true;

    document.addEventListener("click", (event) => {
      if (event.target.closest(".featured-badge-info")) return;
      if (event.target.closest(".featured-badge-add")) return;
      if (event.target.closest("[aria-label='اختيار البادجات']")) return;

      const item = event.target.closest("#featuredBadges > *:not(.featured-badge-add), #badges .badge");
      if (!item) return;

      const badge = badgeFromElement(item);
      if (!badge) return;

      event.preventDefault();
      openBadgeDetail(badge, true);
    });
  }

  if (!window.__tnxBadgeDetailRenderWrapped) {
    window.__tnxBadgeDetailRenderWrapped = true;

    const originalRenderPickerForDetails = renderPicker;
    renderPicker = function () {
      originalRenderPickerForDetails();
      decorateBadgeOptionsForDetails();
    };
  }

  setupBadgeDetailDelegation();


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
