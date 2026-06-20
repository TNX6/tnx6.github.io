(() => {
  const KEY = "__tnxFeaturedBadgeModalTest";
  if (window[KEY]?.cleanup) window[KEY].cleanup();

  const timeouts = [];
  const cleanups = [];

  const $ = (id) => document.getElementById(id);

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
            <p>هنا لاحقًا بتظهر بادجاتك وتختار منها 3.</p>
          </div>

          <button class="featured-badge-modal-close" type="button" aria-label="إغلاق">×</button>
        </div>

        <div class="featured-badge-modal-empty">
          تجربة النافذة فقط — بدون حفظ الآن.
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

  function openModal() {
    makeModal();
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
