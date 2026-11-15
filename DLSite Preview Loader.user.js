// ==UserScript==
// @name         DLSite Preview Loader
// @namespace    loli_be_free
// @version      1.3.1
// @description  Embeds preview images into restricted DLsite pages.
// @match        *://www.dlsite.com/*
// @grant        GM.xmlHttpRequest
// @connect      trial.dlsite.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const MAX_SAMPLE_INDEX = 60;
  const MAX_CONSECUTIVE_MISSES = 10;
  const IMAGE_EXTENSIONS = ['webp', 'jpg', 'png'];
  const IMAGE_TIMEOUT_MS = 10000;
  const STYLE_ID = 'dlpl-page-style';

  let panelHost = null;
  let panelRoot = null;
  let pageKey = null;
  let loadingKey = null;
  let currentPath = location.pathname;
  let scanScheduled = false;

  function getProductCode() {
    const match = location.href.match(/RJ\d{6,8}/i);
    return match ? match[0].toUpperCase() : null;
  }

  function getReleaseType() {
    return location.pathname.includes('/announce/') ? 'ana' : 'work';
  }

  function invertType(type) {
    return type === 'ana' ? 'work' : 'ana';
  }

  function getImageGroup(code) {
    const number = Number(code.slice(2));
    const groupingIncrement =
      Math.floor(number / 1000) * 1000 === number ? 0 : 1;

    const zeroPrefix = code[2] !== '0' ? '' : '0';

    return code.slice(0, 2) + zeroPrefix +
      ((Math.floor(number / 1000) + groupingIncrement) * 1000).toString();
  }

  function makeImageUrl(type, code, group, index, extension) {
    const typePrefix = type === 'ana' ? '_ana' : '';
    const imageName = index === 0 ? 'main' : `smp${index}`;

    return `https://img.dlsite.jp/modpub/images2/${type}/doujin/${group}/${code}${typePrefix}_img_${imageName}.${extension}`;
  }

  function findRestrictedPage() {
    const modern = document.querySelector('.p-restricted');

    if (modern) {
      const anchor = modern.querySelector('.error_container') || modern;
      const messageElement =
        modern.querySelector('.error_message, .error_title_under');

      return {
        kind: 'modern',
        root: modern,
        anchor,
        message: messageElement?.textContent?.trim() ||
          'This work is restricted on DLsite.'
      };
    }

    const legacy = document.querySelector('.error_box_work');

    if (legacy) {
      const messageElement = legacy.querySelector('.title_text');

      return {
        kind: 'legacy',
        root: legacy,
        anchor: legacy,
        message: messageElement?.textContent?.trim() ||
          'This work is restricted on DLsite.'
      };
    }

    return null;
  }

  function restrictionLabel(message) {
    if (/現在販売されていません|not available for sale/i.test(message)) {
      return 'Not available for sale';
    }

    if (/お住いの国|お住まいの国|country|region|国.*購入|購入.*国/i.test(message)) {
      return 'Not available in your country or region';
    }

    return 'Unknown restriction';
  }

  function addPageStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      .dlpl-page-host {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        margin: 18px 0 24px !important;
        position: relative !important;
        clear: both !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function createPanel(message) {
    addPageStyles();

    const host = document.createElement('div');
    host.className = 'dlpl-page-host';
    host.setAttribute('data-dlpl-host', 'true');

    // Isolates the gallery's contents from page CSS and Vue updates.
    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          color: #3b1717;
          font-family: Arial, sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        .heading {
          margin: 0 auto 8px;
          text-align: center;
          white-space: pre-line;
          font-size: 20px;
          line-height: 1.5;
          font-weight: 400;
          color: #421818;
        }

        .trial {
          display: flex;
          justify-content: center;
          margin: 0 auto 10px;
          text-align: center;
          font-size: 18px;
        }

        .trial a {
          color: #075ec7;
          text-decoration: underline;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          column-gap: 12px;
          row-gap: 12px;
          width: 100%;
        }

        .preview {
          display: block;
          width: 100%;
          height: auto;
          cursor: zoom-in;
        }

        .empty {
          margin: 8px auto;
          text-align: center;
          font-size: 16px;
        }

        .viewer {
          position: fixed;
          z-index: 2147483647;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
          background: rgba(0, 0, 0, .94);
          cursor: zoom-out;
        }

        .viewer img {
          display: block;
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        @media (max-width: 650px) {
          .grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      </style>

      <div class="heading">
        Restricted Work: ${restrictionLabel(message)}
        Loading Preview Images
      </div>

      <div class="trial"></div>
      <div class="grid"></div>
    `;

    panelHost = host;

    panelRoot = {
      shadow,
      heading: shadow.querySelector('.heading'),
      trial: shadow.querySelector('.trial'),
      grid: shadow.querySelector('.grid')
    };

    return host;
  }

  function placePanel(page) {
    if (!panelHost || !page) return;

    if (page.kind === 'modern') {
      const anchor = page.anchor;

      if (
        anchor.parentNode &&
        (
          panelHost.parentNode !== anchor.parentNode ||
          panelHost.previousElementSibling !== anchor
        )
      ) {
        anchor.insertAdjacentElement('afterend', panelHost);
      }
    } else if (page.kind === 'legacy') {
      if (panelHost.parentNode !== page.root) {
        page.root.appendChild(panelHost);
      }
    }
  }

  function setHeading(text) {
    if (panelRoot?.heading) {
      panelRoot.heading.textContent = text;
    }
  }

  function openViewer(url) {
    if (!panelRoot?.shadow) return;

    const viewer = document.createElement('div');
    viewer.className = 'viewer';

    const image = document.createElement('img');
    image.src = url;
    image.alt = 'Preview image';

    viewer.appendChild(image);
    viewer.addEventListener('click', () => viewer.remove());

    panelRoot.shadow.appendChild(viewer);

    const closeOnEscape = event => {
      if (event.key === 'Escape') {
        viewer.remove();
        document.removeEventListener('keydown', closeOnEscape);
      }
    };

    document.addEventListener('keydown', closeOnEscape);

    viewer.addEventListener('click', () => {
      document.removeEventListener('keydown', closeOnEscape);
    }, { once: true });
  }

  function loadUrl(url) {
    return new Promise(resolve => {
      const image = new Image();
      let settled = false;

      const timer = setTimeout(() => finish(null), IMAGE_TIMEOUT_MS);

      function finish(result) {
        if (settled) return;

        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        resolve(result);
      }

      image.onload = () => {
        finish(
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? image
            : null
        );
      };

      image.onerror = () => finish(null);
      image.src = url;
    });
  }

  async function loadImage(type, code, group, index) {
    for (const extension of IMAGE_EXTENSIONS) {
      const url = makeImageUrl(type, code, group, index, extension);
      const image = await loadUrl(url);

      if (image) {
        return { image, url, index };
      }
    }

    return null;
  }

  function appendPreview(result) {
    if (!panelRoot || !result) return;

    const image = result.image;
    image.className = 'preview';
    image.alt = result.index === 0
      ? 'Main preview image'
      : `Preview image ${result.index}`;

    image.title = 'Click to view full size';
    image.addEventListener('click', () => openViewer(result.url));

    panelRoot.grid.appendChild(image);
  }

  function checkTrial(code, group, key) {
    if (
      typeof GM === 'undefined' ||
      typeof GM.xmlHttpRequest !== 'function'
    ) {
      return;
    }

    const url =
      `https://trial.dlsite.com/doujin/${group}/${code}_trial.zip`;

    try {
      GM.xmlHttpRequest({
        method: 'HEAD',
        url,
        timeout: 10000,

        onload: response => {
          if (
            pageKey !== key ||
            !panelRoot ||
            response.status !== 200
          ) {
            return;
          }

          const link = document.createElement('a');
          link.href = url;
          link.textContent = 'Trial Available: Download Trial';
          link.rel = 'noopener noreferrer';

          panelRoot.trial.appendChild(link);
        }
      });
    } catch (_) {
      // Trial detection is optional.
    }
  }

  async function runLoader(code, group, key, message) {
    const requestedType = getReleaseType();
    let selectedType = requestedType;

    setHeading(
      `Restricted Work: ${restrictionLabel(message)}\nLoading Preview Images`
    );

    let main = await loadImage(selectedType, code, group, 0);

    if (!main) {
      selectedType = invertType(requestedType);
      main = await loadImage(selectedType, code, group, 0);
    }

    if (pageKey !== key || !panelRoot) return;

    if (!main) {
      setHeading(
        `Restricted Work: ${restrictionLabel(message)}\nNo preview images found`
      );

      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No preview images were found for this work.';

      panelRoot.grid.appendChild(empty);
      return;
    }

    appendPreview(main);
    checkTrial(code, group, key);

    let loadedSamples = 0;
    let consecutiveMisses = 0;

    for (let index = 1; index <= MAX_SAMPLE_INDEX; index++) {
      if (pageKey !== key || !panelRoot) return;

      const result = await loadImage(
        selectedType,
        code,
        group,
        index
      );

      if (pageKey !== key || !panelRoot) return;

      if (result) {
        appendPreview(result);
        loadedSamples++;
        consecutiveMisses = 0;
      } else {
        consecutiveMisses++;

        if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
          break;
        }
      }

      setHeading(
        `Restricted Work: ${restrictionLabel(message)}\nLoading Preview Images (${loadedSamples + 1} found)`
      );
    }

    if (pageKey === key && panelRoot) {
      setHeading(
        `Restricted Work: ${restrictionLabel(message)}\nPreview Images Loaded`
      );
    }
  }

  function resetForNavigation() {
    if (panelHost) panelHost.remove();

    panelHost = null;
    panelRoot = null;
    pageKey = null;
    loadingKey = null;
  }

  function scanPage() {
    scanScheduled = false;

    if (!document.body) return;

    if (location.pathname !== currentPath) {
      currentPath = location.pathname;
      resetForNavigation();
    }

    const code = getProductCode();
    const page = findRestrictedPage();

    if (!code || !page) return;

    const key = `${location.pathname}:${code}`;

    if (pageKey !== key) {
      resetForNavigation();

      pageKey = key;
      panelHost = createPanel(page.message);

      placePanel(page);
    } else if (panelHost) {
      // Vue may replace the surrounding subtree.
      // Reinsert the same host in the original page flow.
      placePanel(page);
    }

    if (loadingKey === key) return;

    loadingKey = key;

    void runLoader(
      code,
      getImageGroup(code),
      key,
      page.message
    );
  }

  function scheduleScan() {
    if (scanScheduled) return;

    scanScheduled = true;
    requestAnimationFrame(scanPage);
  }

  function start() {
    scheduleScan();

    const observer = new MutationObserver(scheduleScan);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener('popstate', scheduleScan);
    window.addEventListener('hashchange', scheduleScan);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
