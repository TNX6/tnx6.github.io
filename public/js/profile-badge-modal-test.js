(() => {
  const KEY = "__tnxFeaturedBadgeModalTest";
  if (window[KEY]?.cleanup) window[KEY].cleanup();

  const API = "https://api.tnx6.xyz";
  const timeouts = [];
  const cleanups = [];

  let selected = [];
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
      document.querySelector("[data-user-login"]),
    ].filter(Boolean);

    for (const el of candidates) {
      const raw = clean(el.dataset?.login || el.dataset?.userLogin || el.textContent || "");
      const login = raw.replace(/^@+/, "").toLowerCase();

      if (/^[a-z0-9_]{3,25}$/.test(login)) return login;
    }

    const text = clean(document.querySelector("main")?.innerText || document.body?.innerText || "");
    const match = text.match(/@([a-zA-Z0-9_]{3,25})/);

    return match?.[1]?.toLowerCase() || "";
  }

  async function getMe() {
    try {
      const res = await fetch(API + "/api/me", {
        credentials: "include",
        cache: "no-store",
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
        cache: "no-store",
      });

      const data = await res.json();

      return Array.isArray(data?.badges)
        ? data.badges.map((x) => clean(x)).filter(Boolean).slice(0, 3)
        : [];
    } catch {
      return [];
    }
  }

  async function saveSelectedBadges() {
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
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          badges: selected.slice(0, 3),
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "save_failed");
      }

      selected = Array.isArray(data.badges)
        ? data.badges.map((x) => clean(x)).filter(Boolean).slice(0, 3)
        : selected.slice(0, 3);

      renderTopSavedBadges();
      setState("تم حفظ الاختيار.");
      window.setTimeout(closeModal, 500);
    } catch {
      setState("فشل حفظ البادجات. جرّب مرة ثانية.");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "حفظ الاختيار";
      }
    }
  }

  function getInventoryBadges() {
    const box = $("badges");
    if (!box) return [];

    return Array.from(box.querySelectorAll(".badge"))
      .map((node, index) => {
        const name =
          clean(node.querySelector?.(".badge-name")?.textContent) ||
          clean(node.getAttribute?.("title")) ||
          clean(node.getAttribute?.("aria-label")) ||
          clean(node.textContent) ||
          `Badge ${index + 1}`;

        const img = node.querySelector?.("img");

        return {
          key: name,
          name,
          img: img?.getAttribute("src") || "",
        };
      })
      .filter((badge) => badge.key && badge.key !== "بادج");
  }

  function makeMiniBadge(badge) {
    const el = document.createElement("span");
    el.className = "featured-mini-badge";
    el.setAttribute("data-tip", badge.name);
    el.setAttribute("aria-label", badge.name);

    if (badge.img) {
      const img = document.createElement("img");
      img.src = badge.img;
      img.alt = badge.name;
      img.loading = "lazy";
      el.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.textContent = "✦";
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

  function renderTopSavedBadges() {
    const target = $("featuredBadges");
    if (!target) return;

    const inventory = getInventoryBadges();
    const map = new Map(inventory.map((badge) => [badge.key, badge]));

    const chosen = selected
      .map((key) => map.get(key))
      .filter(Boolean)
      .slice(0, 3);

    if (!chosen.length && !isOwner) return;

    const roleNodes = Array
      .from(target.querySelectorAll(".role-mod, .role-vip"))
      .map((el) => el.cloneNode(true));

    target.innerHTML = "";

    chosen.forEach((badge) => target.appendChild(makeMiniBadge(badge)));
    roleNodes.forEach((node) => target.appendChild(node));

    if (isOwner) {
      target.appendChild(makePlusButton());
    }

    target.classList.remove("hidden");
  }

  function makeModal() {
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

    const close = () => closeModal();

    modal.querySelector(".featured-badge-modal-backdrop")?.addEventListener("click", close);
    modal.querySelector(".featured-badge-modal-close")?.addEventListener("click", close);
    $("featuredBadgeModalSave")?.addEventListener("click", saveSelectedBadges);
  }

  function setState(message) {
    const state = $("featuredBadgeModalState");
    if (state) state.textContent = message;
  }

  function renderPicker() {
    const grid = $("featuredBadgeModalGrid");
    if (!grid) return;

    const badges = getInventoryBadges();
    grid.innerHTML = "";

    if (!badges.length) {
      setState("ما عندك بادجات قابلة للاختيار حاليًا.");
      return;
    }

    setState(`اختر حتى 3 بادجات من مخزونك. المختار: ${selected.length}/3`);

    for (const badge of badges) {
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
        const exists = selected.includes(badge.key);

        if (exists) {
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
    }
  }

  function openModal() {
    if (!isOwner) return;

    makeModal();
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

  async function setup() {
    profileLogin = getProfileLogin();
    if (!profileLogin) return;

    const [me, saved] = await Promise.all([
      getMe(),
      loadSavedBadges(profileLogin),
    ]);

    isOwner = Boolean(me?.login && String(me.login).toLowerCase() === profileLogin);
    selected = saved.slice(0, 3);

    renderTopSavedBadges();
  }

  [1800, 3200, 5000].forEach((ms) => {
    const id = window.setTimeout(setup, ms);
    timeouts.push(id);
  });

  const onPageShow = () => {
    const id = window.setTimeout(setup, 1800);
    timeouts.push(id);
  };

  window.addEventListener("pageshow", onPageShow);
  cleanups.push(() => window.removeEventListener("pageshow", onPageShow));

  window[KEY] = {
    cleanup() {
      timeouts.forEach((id) => window.clearTimeout(id));
      cleanups.forEach((fn) => fn());
      $("featuredBadgeModalTest")?.remove();
      $("featuredBadgePlusTest")?.remove();
    },
  };
})();
