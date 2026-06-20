(() => {
  const KEY = "__tnxFeaturedBadgeModalTest";
  if (window[KEY]?.cleanup) window[KEY].cleanup();

  const timeouts = [];
  const cleanups = [];
  let selected = [];

  const $ = (id) => document.getElementById(id);
  const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();

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
          <button id="featuredBadgeModalSave" class="featured-badge-modal-save" type="button" disabled>
            حفظ الاختيار لاحقًا
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    };

    modal.querySelector(".featured-badge-modal-backdrop")?.addEventListener("click", close);
    modal.querySelector(".featured-badge-modal-close")?.addEventListener("click", close);
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
    makeModal();
    renderPicker();

    const modal = $("featuredBadgeModalTest");
    modal?.classList.remove("hidden");
    modal?.setAttribute("aria-hidden", "false");
  }

  function addPlusButton() {
    const target = $("featuredBadges");
    if (!target) return;
    if ($("featuredBadgePlusTest")) return;

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

    target.appendChild(btn);
    target.classList.remove("hidden");
  }

  [1800, 3200, 5000].forEach((ms) => {
    const id = window.setTimeout(addPlusButton, ms);
    timeouts.push(id);
  });

  const onPageShow = () => {
    const id = window.setTimeout(addPlusButton, 1800);
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
