// ==UserScript==
// @name        DLSite Preview Loader
// @namespace   loli_be_free
// @match       *://www.dlsite.com/*
// @grant       GM.xmlHttpRequest
// @version     1.1
// @description Inserts image previews into the page for restricted works on dlsite
// @icon        https://www.dlsite.com/images/web/home/pic_not_found_01.png
// @downloadURL https://github.com/kani-ge/DLSite-Preview-Injector/raw/master/DLSite%20Preview%20Injector.user.js
// @updateURL   https://github.com/kani-ge/DLSite-Preview-Injector/raw/master/DLSite%20Preview%20Injector.user.js
// @run-at      document-idle
// ==/UserScript==

function css() {
  const css = (`
    .error_box_work {
      margin-right: 0;
    }

    .inject-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      column-gap: 12px;
      row-gap: 12px;
    }

    .inject-image {
      display: block;
      width: 100%;
    }

    .inject-header {
      display: flex;
      justify-content: center;
      margin: 0 auto;
      text-align: center;
    }

    .inject-trial {
      display: flex;
      justify-content: center;
      margin: 0 auto;
      text-align: center;
      font-size: 20px;
    }

    .inject-full {
      display: none;
      position: fixed;
      z-index: 999;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-size: contain;
      background-position: center center;
      background-repeat: no-repeat no-repeat;
      background-color: black;
    }

  `);
  const style = document.createElement('style');
  document.body.append(style);
  style.append(css);
}

function generateURL (type, code, group, count = 0) {
  const typePrefix = type == 'ana' ? '_ana' : '';
  const countSuffix = count == 0 ? 'main' : 'smp' + count.toString();
  return `https://img.dlsite.jp/modpub/images2/${type}/doujin/${group}/${code}${typePrefix}_img_${countSuffix}.webp`;
}

function invertType (type) {
  if (type == 'ana')
    return 'work';
  else
    return 'ana';
}

function redirect () {
  var newURL;
  if (window.location.href.includes('announce'))
    newURL = window.location.href.replace('announce', 'work');
  else
    newURL = window.location.href.replace('work', 'announce');
  window.location.replace(newURL);
}

async function checkExists (url) {
  const response = await fetch(url, { method: 'HEAD' });
  return response.ok;
}

async function checkTrial (trialDiv, code, group) {
  const trialURL = `https://trial.dlsite.com/doujin/${group}/${code}_trial.zip`;
  GM.xmlHttpRequest({
    method: 'HEAD',
    url: trialURL,
    onload: response => {
      if (response.status == 200) {
        const link = document.createElement('a');
        link.classList.add('inject-trial');
        link.appendChild(document.createTextNode('Trial Available: Download Trial'));
        link.href = trialURL;
        trialDiv.appendChild(link);
      } else {
        trialDiv.remove();
      }
    }
  });
}

async function insertImages (errorBox, type, code, group) {
  css();
  const message = errorBox.querySelector('.title_text').textContent;
  var restrict_message;
  if (message.includes('現在販売されていません'))
    restrict_message = 'Not available for sale';
  else if (message.includes('お住いの国'))
    restrict_message = 'Not avalible in your country or region';
  else
    restrict_message = 'Unknown reason';

  const full = document.createElement('div');
  document.body.append(full);
  full.classList.add('inject-full');
  full.addEventListener('click', () => full.style.display='none');
  errorBox.innerHTML = (`
    <p class="title_text inject-header">
      Restricted Work: ${restrict_message}<br>Loading Preview Images
    </p>
    <div class="inject-trial"></div>
    <div class="inject-grid"></div>
  `);

  checkTrial(errorBox.querySelector('.inject-trial'), code, group);
  const grid = errorBox.querySelector('.inject-grid');
  var count = 0;
  var loop = true;
  while (loop) {
    loop = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        img.classList.add('inject-image');
        img.addEventListener('click', () => {
          full.style.backgroundImage = ('url(' + img.src + ')');
          full.style.display = 'block';
        });
        grid.append(img);
        resolve(true);
      }
      img.onerror = () => resolve(false);
      img.src = generateURL(type, code, group, count);
    })
    count++;
  }
  errorBox.querySelector('.inject-header').innerText = `Restricted Work: ${restrict_message}\nPreview Images Loaded`;
}

function displayNotFount(errorBox) {
  css();
  const notFound = errorBox.querySelector('.title_text').textContent == "該当作品がありません";
  const html =`
    <img class="inject-header" src="/images/web/common/txt_error_01.png">
    <p class="title_text inject-header">
      No preview images to display.${notFound ? " Work not found." : ''}
    </p>
    <img class="illust inject-header" src="/images/web/home/pic_not_found_01.png">`
  errorBox.innerHTML = html;
}

async function run (errorBox) {
  const releaseType = window.location.href.includes('announce') ? 'ana' : 'work';
  const code = window.location.href.match(/rj\d+/i)[0].toUpperCase();
  const num = parseInt(code.substring(2));
  const groupingInc = (Math.floor(num / 1000) * 1000) == num ? 0 : 1;
  const grouping = code.substring(0, 2) + ((code[2] !== "0") ? "": "0") + ((Math.floor(num / 1000) + groupingInc)*1000).toString();
  var exists = await checkExists( generateURL(releaseType, code, grouping));
  if (exists) {
    insertImages(errorBox, releaseType, code, grouping);
  } else {
    exists = await checkExists( generateURL( invertType(releaseType), code, grouping));
    if (exists)
      redirect();
    else {
      displayNotFount(errorBox);
    }
  }
}

const errorBox = document.querySelector('.error_box_work');
if (errorBox)
  run(errorBox);