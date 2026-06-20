
(() => {
  const API = "https://api.tnx6.xyz";
  const KEY = "__tnxFeaturedBadgeControllerV7";

  if (window[KEY]?.cleanup) window[KEY].cleanup();

  const timeouts = [];
  let selected = [];
  let roles = { moderator: false, vip: false };
  let isOwner = false;
  let profileLogin = "";

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

    const text = clean(document.body.innerText || "");
    const match = text.match(/@([a-zA-Z0-9_]{3,25})/);
    return match?.[1]?.toLowerCase() || "";
  }

  async function getMe() {
    try {
      const res = await fetch(API + "/api/me", {
        credentials: "include",
        cache: "no-store"
      });

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

      const res = await fetch(url.toString(), {
        credentials: "include",
        cache: "no-store"
      });

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

      const res = await fetch(url.toString(), {
        credentials: "include",
        cache: "no-store"
      });

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
          score: scoreBadge(name)
        };
      })
      .filter((badge) => badge.key && badge.key !== "بادج");
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
    btn.textContent = "+";
    btn.title = "اختيار البادجات";
    btn.setAttribute("aria-label", "اختيار البادجات");

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openModal();
    });

    return btn;
  }

  function getRoleBadges() {
    const arr = [];

    if (roles.moderator) {
      arr.push({
        type: "role",
        role: "mod",
        key: "__mod",
        name: "Twitch Moderator",
        icon: "MOD"
      });
    }

    if (roles.vip) {
      arr.push({
        type: "role",
        role: "vip",
        key: "__vip",
        name: "Twitch VIP",
        icon: "VIP"
      });
    }

    return arr;
  }

  function renderTop() {
    const target = $("featuredBadges");
    if (!target) return;

    const inventory = getInventory();
    const map = new Map(inventory.map((badge) => [badge.key, badge]));

    const picked = selected.length
      ? selected.map((key) => map.get(key)).filter(Boolean).slice(0, 3)
      : inventory.slice().sort((a, b) => b.score - a.score).slice(0, 3);

    const finalBadges = [
      ...picked,
      ...getRoleBadges()
    ];

    target.innerHTML = "";

    finalBadges.forEach((badge) => {
      target.appendChild(makeMiniBadge(badge));
    });

    if (isOwner) {
      target.appendChild(makePlusButton());
    }

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
        <div class="featured-badge-modal-head">
          <div>
            <h3>اختيار البادجات</h3>
            <p id="featuredBadgeModalState">اختر حتى 3 بادجات من مخزونك.</p>
          </div>

          <button class="featured-badge-modal-close" type="button" aria-label="إغلاق">×</button>
        </div>

        <div id="featuredBadgeModalGrid" class="featured-badge-modal-grid"></div>

        <div class="featured-badge-modal-actions">
          <button id="featuredBadgeModalSave" class="featured-badge-modal-save" type="button">
            حفظ الاختيار
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector(".featured-badge-modal-backdrop")?.addEventListener("click", closeModal);
    modal.querySelector(".featured-badge-modal-close")?.addEventListener("click", closeModal);
    $("featuredBadgeModalSave")?.addEventListener("click", saveSelection);
  }

  function setState(message) {
    const state = $("featuredBadgeModalState");
    if (state) state.textContent = message;
  }

  function renderPicker() {
    const grid = $("featuredBadgeModalGrid");
    if (!grid) return;

    const badges = getInventory();
    grid.innerHTML = "";

    if (!badges.length) {
      setState("ما عندك بادجات قابلة للاختيار حاليًا.");
      return;
    }

    setState(`اختر حتى 3 بادجات من مخزونك. المختار: ${selected.length}/3`);

    badges.forEach((badge) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "featured-badge-option";
      btn.classList.toggle("selected", selected.includes(badge.key));

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

      btn.appendChild(icon);
      btn.appendChild(label);

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

    ensureModal();
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
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          badges: selected.slice(0, 3)
        })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "save_failed");
      }

      selected = Array.isArray(data.badges)
        ? data.badges.map(clean).filter(Boolean).slice(0, 3)
        : selected.slice(0, 3);

      renderTop();
      setState("تم حفظ الاختيار.");
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

    console.log("[TNX Featured Single Controller]", {
      profileLogin,
      me: me?.login,
      isOwner,
      selected,
      roles
    });

    renderTop();
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
