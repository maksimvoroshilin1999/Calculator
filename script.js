/* ============================================
SCRIPT.JS — Автономная логика калькулятора
Извлечено из calculator.js + интеграция с
Google Apps Script и генерация PDF через
html2pdf.js (версия 0.10.1)

Внешние библиотеки:
- html2pdf.js (подключена через CDN в index.html)

Google Apps Script URL:
https://script.google.com/macros/s/AKfycbwDMrfsK_FXVDyq_UJvIcRjyAv0YE47_zI-Ye8_XExRI4PlBow_JgIRp7jGDNApl8wSKg/exec

Название компании: Петербургские газоны
============================================ */

(function () {
  'use strict';

  /* ---------- Полифил window.GZ ---------- */
  if (!window.GZ) {
    window.GZ = {};
  }
  if (typeof window.GZ.reduced === 'undefined') {
    window.GZ.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  if (typeof window.GZ.toast !== 'function') {
    window.GZ.toast = function (msg, isError) {
      var existing = document.querySelector('.gz-toast');
      if (existing) existing.remove();
      var el = document.createElement('div');
      el.className = 'gz-toast';
      el.textContent = msg;
      el.style.cssText =
        'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);' +
        'padding:0.9rem 1.5rem;border-radius:10px;font-size:0.9375rem;' +
        'z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.18);' +
        'background:' + (isError ? '#D94F4F' : '#3A7D2C') + ';color:#fff;' +
        'opacity:0;transition:opacity 0.35s ease;pointer-events:none;';
      document.body.appendChild(el);
      requestAnimationFrame(function () { el.style.opacity = '1'; });
      setTimeout(function () {
        el.style.opacity = '0';
        setTimeout(function () { el.remove(); }, 400);
      }, 3500);
    };
  }

  var REDUCED = !!(window.GZ && window.GZ.reduced);

  /* ---------- Константы ---------- */
  var GAS_URL      = 'https://script.google.com/macros/s/AKfycbwDMrfsK_FXVDyq_UJvIcRjyAv0YE47_zI-Ye8_XExRI4PlBow_JgIRp7jGDNApl8wSKg/exec';
  var COMPANY_NAME = 'Петербургские газоны';

  /* ---------- Элементы ---------- */
  var range          = document.getElementById('calcAreaRange');
  var numberInput    = document.getElementById('calcAreaInput');
  var plot           = document.getElementById('calcPlot');
  var tilesBox       = document.getElementById('calcTiles');
  var deliverySelect = document.getElementById('calcDelivery');
  var totalEl        = document.getElementById('calcTotalValue');
  var totalBlock     = document.getElementById('calcTotal');
  var sumLawn        = document.getElementById('calcSumLawn');
  var sumPrep        = document.getElementById('calcSumPrep');
  var sumDelivery    = document.getElementById('calcSumDelivery');
  var sumExtra       = document.getElementById('calcSumExtra');
  var sumTotal       = document.getElementById('calcSumTotal');
  var pdfBtn         = document.getElementById('calcPdf');
  var emailInput     = document.getElementById('calcEmail');
  var pdfContent     = document.getElementById('calcPdfContent');
  var pdfServices    = document.getElementById('calcPdfServices');
  var pdfTotal       = document.getElementById('calcPdfTotal');

  if (!range || !totalEl) return;

  var prepChecks  = document.querySelectorAll('.calc__check-input[data-prep]');
  var extraChecks = document.querySelectorAll('.calc__check-input[data-extra]');
  var tiles       = tilesBox ? tilesBox.querySelectorAll('.calc__tile') : [];

  /* ---------- Состояние ---------- */
  var state = {
    area:      parseInt(range.value, 10) || 300,
    tilePrice: 160,
    tileName:  'Альянс',
    grassOn:   false
  };

  var MIN = parseInt(range.min, 10) || 50;
  var MAX = parseInt(range.max, 10) || 5000;

  /* ---------- Хелперы ---------- */
  function fmt(n) {
    return n.toLocaleString('ru-RU') + ' ₽';
  }

  function clamp(v) {
    return Math.max(MIN, Math.min(MAX, v));
  }

  function replayClass(el, cls, duration) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    if (duration) {
      window.setTimeout(function () {
        el.classList.remove(cls);
      }, duration);
    }
  }

  function setGrass(on) {
    if (!plot) return;
    plot.classList.toggle('is-grass', on);
  }

  function setProgress() {
    var pct = ((state.area - MIN) / (MAX - MIN)) * 100;
    range.style.setProperty('--range-progress', pct + '%');
  }

  function setPlotWidth() {
    if (!plot) return;
    var w = 25 + ((state.area - MIN) / (MAX - MIN)) * 75;
    plot.style.width = w + '%';
  }

  /* ---------- Анимированный счётчик итога ---------- */
  var shownTotal = 0;
  var totalRaf   = null;

  function animateTotal(target) {
    if (REDUCED) {
      shownTotal = target;
      totalEl.textContent = target.toLocaleString('ru-RU');
      return;
    }
    if (totalRaf) cancelAnimationFrame(totalRaf);
    var from  = shownTotal;
    var start = null;
    var dur   = 500;

    function step(ts) {
      if (start === null) start = ts;
      var p     = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      shownTotal = Math.round(from + (target - from) * eased);
      totalEl.textContent = shownTotal.toLocaleString('ru-RU');
      if (p < 1) {
        totalRaf = requestAnimationFrame(step);
      } else {
        totalRaf = null;
      }
    }
    totalRaf = requestAnimationFrame(step);
  }

  function pulseTotal() {
    if (!totalBlock || REDUCED) return;
    totalBlock.classList.remove('is-pulse');
    void totalBlock.offsetWidth;
    totalBlock.classList.add('is-pulse');
  }

  /* ---------- Пересчёт ---------- */
  function recalc(withPulse) {
    var lawn = state.area * state.tilePrice;

    var prep = 0;
    prepChecks.forEach(function (ch) {
      if (ch.checked) prep += (parseInt(ch.getAttribute('data-price'), 10) || 0) * state.area;
    });

    var delivery = deliverySelect ? (parseInt(deliverySelect.value, 10) || 0) : 0;

    var extra = 0;
    extraChecks.forEach(function (ch) {
      if (ch.checked) extra += parseInt(ch.getAttribute('data-price'), 10) || 0;
    });

    var total = lawn + prep + delivery + extra;

    if (sumLawn)     sumLawn.textContent     = fmt(lawn);
    if (sumPrep)     sumPrep.textContent     = fmt(prep);
    if (sumDelivery) sumDelivery.textContent = fmt(delivery);
    if (sumExtra)    sumExtra.textContent    = fmt(extra);
    if (sumTotal)    sumTotal.textContent    = fmt(total);

    animateTotal(total);
    if (withPulse) pulseTotal();
  }

  /* ---------- Сборка списка услуг для PDF и GAS ---------- */
  function buildServicesString() {
    var services = [];

    // Газон
    services.push('Газон «' + state.tileName + '» (' + state.area + ' м²) — ' + fmt(state.area * state.tilePrice));

    // Подготовка
    prepChecks.forEach(function (ch) {
      if (ch.checked) {
        var label = ch.parentElement.querySelector('.calc__check-text');
        var price = parseInt(ch.getAttribute('data-price'), 10) || 0;
        if (label) {
          services.push(label.textContent + ' (' + state.area + ' м²) — ' + fmt(price * state.area));
        }
      }
    });

    // Доставка
    if (deliverySelect) {
      var deliveryText  = deliverySelect.options[deliverySelect.selectedIndex].text;
      var deliveryPrice = parseInt(deliverySelect.value, 10) || 0;
      if (deliveryPrice > 0) {
        services.push('Доставка: ' + deliveryText);
      }
    }

    // Доп. услуги
    extraChecks.forEach(function (ch) {
      if (ch.checked) {
        var label = ch.parentElement.querySelector('.calc__check-text');
        var price = parseInt(ch.getAttribute('data-price'), 10) || 0;
        if (label) {
          services.push(label.textContent + ' — ' + fmt(price));
        }
      }
    });

    return services.join('\n');
  }

  /* ---------- Отправка данных на сервер (GAS сам сделает PDF) ---------- */
  async function sendPdfToEmail() {
    var email = emailInput ? emailInput.value.trim() : '';
  
    if (!email || !emailInput.checkValidity() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      alert('Пожалуйста, введите корректный email для отправки сметы');
      return;
    }
  
    var originalText = pdfBtn.textContent;
    pdfBtn.disabled = true;
    pdfBtn.textContent = 'Отправляем...';
  
    try {
      // Собираем данные, которые нужны серверу
      var services = buildServicesString();
      var total = sumTotal ? sumTotal.textContent : '0 ₽';
  
      var data = {
        email: email,
        services: services,
        total: total,
        company: COMPANY_NAME
      };
  
      // Отправляем простой JSON на сервер (никакого base64!)
      var response = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(data)
      });
  
      var result = await response.json();

      if (result.status === 'ok') {
        alert('Смета успешно отправлена на вашу почту!');
        if (emailInput) emailInput.value = '';
      } else {
        console.error('Ошибка GAS:', result);
        alert('Ошибка: ' + result.message); // Теперь вы увидите текст ошибки на экране
      }
  
    } catch (error) {
      console.error('Ошибка при отправке:', error);
      alert('Произошла ошибка при отправке. Попробуйте позже.');
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.textContent = originalText;
    }
  }

  /* ---------- Шаг 1: площадь ---------- */
  range.addEventListener('input', function () {
    state.area = parseInt(range.value, 10) || MIN;
    if (numberInput) numberInput.value = state.area;
    setProgress();
    setPlotWidth();
    recalc(false);
  });

  range.addEventListener('change', function () {
    recalc(true);
  });

  if (numberInput) {
    numberInput.addEventListener('input', function () {
      var v = parseInt(numberInput.value, 10);
      if (isNaN(v)) return;
      state.area = clamp(v);
      range.value = state.area;
      setProgress();
      setPlotWidth();
      recalc(false);
    });

    numberInput.addEventListener('change', function () {
      var v = parseInt(numberInput.value, 10);
      if (isNaN(v)) v = state.area;
      state.area = clamp(v);
      numberInput.value = state.area;
      range.value = state.area;
      setProgress();
      setPlotWidth();
      recalc(true);
    });
  }

  /* ---------- Шаг 2: плитки типа газона ---------- */
  tiles.forEach(function (tile) {
    tile.addEventListener('click', function () {
      tiles.forEach(function (t) {
        t.classList.toggle('is-active', t === tile);
      });
      state.tilePrice = parseInt(tile.getAttribute('data-price'), 10) || state.tilePrice;
      var nameEl = tile.querySelector('.calc__tile-name');
      if (nameEl) state.tileName = nameEl.textContent;

      if (plot) {
        state.grassOn = true;
        replayClass(plot, 'is-grass', 0);
      }
      recalc(true);
    });
  });

  /* ---------- Шаги 3 и 5: чекбоксы + анимации визуализации ---------- */
  function playLeveling() {
    if (!plot) return;
    setGrass(false);
    replayClass(plot, 'is-leveling', 2100);
    window.setTimeout(function () {
      if (state.grassOn) setGrass(true);
    }, 1400);
  }

  function handleCheck(ch) {
    var viz     = ch.getAttribute('data-viz');
    var checked = ch.checked;

    if (viz === 'machine' && checked) {
      playLeveling();
    } else if (viz === 'soil' && checked) {
      replayClass(plot, 'is-soil-removal', 2100);
    } else if (viz === 'drainage') {
      plot.classList.toggle('is-drainage', checked);
    } else if (viz === 'water') {
      plot.classList.toggle('is-water', checked);
    } else if (viz === 'trees') {
      plot.classList.toggle('is-trees', checked);
    } else if (viz === 'worker') {
      plot.classList.toggle('is-worker', checked);
    }

    recalc(true);
  }

  prepChecks.forEach(function (ch) {
    ch.addEventListener('change', function () { handleCheck(ch); });
  });

  extraChecks.forEach(function (ch) {
    ch.addEventListener('change', function () { handleCheck(ch); });
  });

  /* ---------- Шаг 4: доставка ---------- */
  if (deliverySelect) {
    deliverySelect.addEventListener('change', function () {
      recalc(true);
    });
  }

  /* ---------- Кнопка «Скачать смету PDF» ---------- */
  if (pdfBtn) {
    pdfBtn.addEventListener('click', sendPdfToEmail);

    if (emailInput) {
      emailInput.addEventListener('input', function () {
        emailInput.classList.remove('is-error');
      });
    }
  }

  /* ---------- Старт ---------- */
  setProgress();
  setPlotWidth();
  recalc(false);

})();