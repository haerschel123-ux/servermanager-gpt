"use strict";

(function () {
  const IMAGE_BASE_URL = "https://loadouts.dzbtools.com/images/cache/";

  function imageName(itemType) {
    return String(itemType || "").trim().toLowerCase();
  }

  function imageUrl(itemType) {
    const name = imageName(itemType);
    return name ? IMAGE_BASE_URL + encodeURIComponent(name) + ".avif" : null;
  }

  function createImage(itemType, className = "", fallback = null) {
    const url = imageUrl(itemType);
    if (!url) return null;

    const image = document.createElement("img");
    image.className = `dayz-item-image ${className}`.trim();
    image.src = url;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.dataset.itemImage = itemType;
    image.addEventListener("error", () => {
      if (fallback && image.parentNode) image.replaceWith(fallback);
      else image.remove();
    }, { once: true });
    return image;
  }

  function decorateItemCards(root = document) {
    root.querySelectorAll(".item-card[data-item]").forEach(card => {
      const imageBox = card.querySelector(".item-img");
      if (!imageBox || imageBox.querySelector(".dayz-item-image")) return;
      const fallback = imageBox.firstElementChild ? imageBox.firstElementChild.cloneNode(true) : null;
      const image = createImage(card.dataset.item, "dayz-item-image-grid", fallback);
      if (image) imageBox.replaceChildren(image);
    });
  }

  function directText(element) {
    return Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function decorateSelectedItems(root = document) {
    root.querySelectorAll(".selected-item-badge .item-label").forEach(label => {
      if (label.querySelector(".dayz-item-image")) return;
      const itemType = directText(label);
      const icon = label.querySelector(":scope > i");
      const fallback = icon ? icon.cloneNode(true) : null;
      const image = createImage(itemType, "dayz-item-image-selected", fallback);
      if (!image) return;
      if (icon) icon.replaceWith(image);
      else label.prepend(image);
    });
  }

  function decorateConfiguration(root = document) {
    root.querySelectorAll(".form-check-input[value]").forEach(input => {
      if (!input.id) return;
      const label = root.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (!label || label.querySelector(".dayz-item-image")) return;
      const icon = label.querySelector(":scope > i");
      const fallback = icon ? icon.cloneNode(true) : null;
      const image = createImage(input.value, "dayz-item-image-option", fallback);
      if (!image) return;
      if (icon) icon.replaceWith(image);
      else label.prepend(image);
    });
  }

  function decorate(root = document) {
    decorateItemCards(root);
    decorateSelectedItems(root);
    decorateConfiguration(root);
  }

  const style = document.createElement("style");
  style.textContent = `
    .dayz-item-image {
      display: inline-block;
      flex: 0 0 auto;
      object-fit: contain;
      filter: drop-shadow(0 2px 3px rgba(0, 0, 0, .45));
    }
    .dayz-item-image-grid { width: 100%; height: 78px; }
    .dayz-item-image-selected {
      width: 42px;
      height: 42px;
      margin-right: 9px;
      border-radius: 5px;
      background-color: rgba(0, 0, 0, .18);
    }
    .dayz-item-image-option {
      width: 30px;
      height: 30px;
      margin-right: 7px;
      vertical-align: middle;
      border-radius: 4px;
      background-color: rgba(0, 0, 0, .18);
    }
    .selected-item-badge .item-label { display: flex; align-items: center; min-width: 0; }
    .selected-item-badge .item-label small { margin-left: 8px; }
    .form-check-label { display: inline-flex; align-items: center; min-height: 30px; }
    @media (max-width: 576px) {
      .dayz-item-image-grid { height: 68px; }
      .dayz-item-image-selected { width: 36px; height: 36px; }
    }
  `;
  document.head.appendChild(style);

  window.DayZItemImages = Object.freeze({
    url: imageUrl,
    createImage
  });

  const run = () => decorate(document);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        decorate(node.matches(".item-card, .selected-item-badge, .form-check") ? node.parentElement || node : node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
