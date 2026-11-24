/**
 * GoMining Bitcoin Mining Simulator & Chart Calculator
 * Kompakte & optimierte Rechner- und Visualisierungs-Engine.
 */

// 1. Tailwind CSS Konfiguration
const twConfig = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        slatebg: '#0b0f17',
        cardbg: '#121826',
        cardhover: '#182032',
        borderdim: '#1f293d',
        btc: '#f7931a',
        emeraldacc: '#10b981',
        skyacc: '#38bdf8',
        roseacc: '#f43f5e',
      }
    }
  }
};
if (typeof tailwind !== 'undefined') tailwind.config = twConfig;
else window.tailwind = { config: twConfig };

// 2. Rechner- & Chart-Logik
(function () {
  // Screenshot-Referenzbasis (55.48 TH, 12 W/TH, 3.9% Rabatt, ~$60.6k BTC)
  const BASELINE = Object.freeze({
    hashrateTH: 55.48,
    efficiencyWTH: 12.0,
    discountPct: 3.9,
    btcPriceUSD: 60606.0,
    usdChf: 0.885,
    difficultyChangePct: 0.0,
    targetChfMonth: 4000.0,
    grossSatsDayBase: 2570.0,
    elecUsdDayBase: 0.76,
    serviceUsdDayBase: 0.47
  });

  const state = { ...BASELINE };
  const STORAGE_KEY = 'gomining_calculator_state_v1';

  // Live BTC-Chart & Kurs-Status
  let chartMode = 'simulator'; // 'simulator' | 'live'
  let liveBtcData = {
    currentPrice: null,
    history: [],
    lastUpdated: null,
    source: 'Binance'
  };
  let liveCountdown = 60;
  let countdownTimerId = null;
  let syncLivePrice = true;

  /**
   * Speichert den aktuellen Zustand im localStorage.
   */
  function saveState() {
    try {
      const data = {
        hashrateTH: state.hashrateTH,
        efficiencyWTH: state.efficiencyWTH,
        discountPct: state.discountPct,
        btcPriceUSD: state.btcPriceUSD,
        difficultyChangePct: state.difficultyChangePct,
        usdChf: state.usdChf,
        targetChfMonth: state.targetChfMonth
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // Fehler ignorieren (z. B. privates Surfen oder Speicher voll)
    }
  }

  /**
   * Lädt gespeicherte Werte aus dem localStorage.
   */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        const keys = ['hashrateTH', 'efficiencyWTH', 'discountPct', 'btcPriceUSD', 'difficultyChangePct', 'usdChf', 'targetChfMonth'];
        keys.forEach((k) => {
          if (typeof data[k] === 'number' && Number.isFinite(data[k])) {
            state[k] = data[k];
          }
        });
        return true;
      }
    } catch (e) {
      // Ignoriere Parsing-Fehler
    }
    return false;
  }

  // Deklarative Parameter-Konfiguration für Slider & Eingaben (min: 0 erlaubt Werte ab 0)
  const PARAMS = [
    { key: 'hashrateTH', range: 'hashrateRange', input: 'hashrateInput', min: 0, max: 30000, dec: 2 },
    { key: 'efficiencyWTH', range: 'efficiencyRange', input: 'efficiencyInput', min: 0, max: 35, dec: 1 },
    { key: 'discountPct', range: 'discountRange', input: 'discountInput', min: 0, max: 20, dec: 1 },
    { key: 'btcPriceUSD', range: 'btcPriceRange', input: 'btcPriceInput', min: 0, max: 250000, dec: 0 },
    { key: 'difficultyChangePct', range: 'diffRange', input: 'diffInput', min: -100, max: 100, dec: 0 },
    { key: 'usdChf', range: 'usdChfRange', input: 'usdChfInput', min: 0, max: 1.5, dec: 3 },
  ];

  let chartInstance = null;
  const $ = (id) => document.getElementById(id);

  // Formatierungs-Helfer
  const nFmt = (maxDec, minDec = maxDec) =>
    new Intl.NumberFormat('de-CH', { minimumFractionDigits: minDec, maximumFractionDigits: maxDec });
  const fmt0 = nFmt(0), fmt1 = nFmt(1), fmt2 = nFmt(2);
  const fmtUsd = (v) => `${v < 0 ? '-' : ''}$${fmt2.format(Math.abs(v))}`;
  const fmtChf = (v) => `${v < 0 ? '-' : ''}CHF ${fmt2.format(Math.abs(v))}`;
  const clamp = (v, min, max) => (!Number.isFinite(v) ? min : Math.min(max, Math.max(min, v)));

  /**
   * Berechnet Mining-Erträge und Kosten auf Tages- und Monatsbasis.
   * Sicher vor NaN oder Division-durch-0 bei Eingabe von 0.
   */
  function calculateMiningMetrics(p) {
    const hashrate = Math.max(0, p.hashrateTH || 0);
    const thScale = BASELINE.hashrateTH > 0 ? hashrate / BASELINE.hashrateTH : 0;
    const diffFactor = 1 / Math.max(0.001, 1 + (p.difficultyChangePct || 0) / 100);

    // Brutto
    const grossSatsDay = BASELINE.grossSatsDayBase * thScale * diffFactor;
    const btcPrice = Math.max(0, p.btcPriceUSD || 0);
    const grossUsdDay = (grossSatsDay / 1e8) * btcPrice;

    // Kosten unter Berücksichtigung des Wartungsrabatts
    const baseDisc = Math.max(0.05, 1 - BASELINE.discountPct / 100);
    const curDisc = Math.max(0, 1 - (p.discountPct || 0) / 100);
    const discMult = curDisc / baseDisc;

    const efficiency = Math.max(0, p.efficiencyWTH || 0);
    const effRatio = BASELINE.efficiencyWTH > 0 ? efficiency / BASELINE.efficiencyWTH : 0;
    const elecUsdDay = BASELINE.elecUsdDayBase * thScale * effRatio * discMult;
    const serviceUsdDay = BASELINE.serviceUsdDayBase * thScale * discMult;
    const totalCostUsdDay = elecUsdDay + serviceUsdDay;
    const totalCostSatsDay = btcPrice > 0 ? (totalCostUsdDay / btcPrice) * 1e8 : 0;

    // Netto
    const netSatsDay = grossSatsDay - totalCostSatsDay;
    const netUsdDay = grossUsdDay - totalCostUsdDay;
    const netUsdMonth = netUsdDay * 30;
    const usdChf = Math.max(0, p.usdChf || 0);

    return {
      grossSatsDay, grossUsdDay, elecUsdDay, serviceUsdDay, totalCostUsdDay, totalCostSatsDay,
      netSatsDay, netBtcDay: netSatsDay / 1e8,
      netUsdDay, netUsdMonth,
      netChfDay: netUsdDay * usdChf,
      netChfMonth: netUsdMonth * usdChf,
      netSatsMonth: netSatsDay * 30,
      costSharePct: grossUsdDay > 0 ? (totalCostUsdDay / grossUsdDay) * 100 : 0,
      netMarginPct: grossUsdDay > 0 ? (netUsdDay / grossUsdDay) * 100 : 0,
    };
  }

  /**
   * Berechnet die nötige Hashrate (TH) für das monatliche CHF-Ziel.
   */
  function calculateNeededTHForTarget(p) {
    if ((p.targetChfMonth ?? 0) <= 0) {
      return { reachable: true, neededTH: 0, netUsdPerThDay: 0 };
    }
    if ((p.usdChf ?? 0) <= 0 || (p.btcPriceUSD ?? 0) <= 0) {
      return { reachable: false, reason: 'USD/CHF-Kurs und BTC-Kurs müssen > 0 sein.' };
    }
    const neededUsdDay = p.targetChfMonth / p.usdChf / 30;
    const m1TH = calculateMiningMetrics({ ...p, hashrateTH: 1 });
    if (m1TH.netUsdDay <= 1e-7) {
      return { reachable: false, reason: 'Netto-Ertrag/TH ist ≤ $0.00 (Rabatt/Kurs erhöhen oder Diff senken).' };
    }
    return { reachable: true, neededTH: neededUsdDay / m1TH.netUsdDay, netUsdPerThDay: m1TH.netUsdDay };
  }

  /**
   * Datenpunkte für den Verlauf über den BTC-Kurs ($40k - $200k).
   */
  function buildPriceCurveSeries(p) {
    const prices = [], netSatsSeries = [], netChfSeries = [];
    for (let price = 40000; price <= 200000; price += 5000) {
      prices.push(price);
      const m = calculateMiningMetrics({ ...p, btcPriceUSD: price });
      netSatsSeries.push(Math.round(m.netSatsDay));
      netChfSeries.push(+m.netChfMonth.toFixed(2));
    }
    return { prices, netSatsSeries, netChfSeries };
  }

  /**
   * Holt den echten Bitcoin-Kurs & 24h-Historie über offene APIs (Binance -> Coinbase -> CoinGecko)
   */
  async function fetchLiveBtc() {
    let price = null;
    let history = null;
    let source = 'Binance';

    // 1. Versuch: Binance (24h Stundendaten mit unbeschränktem CORS)
    try {
      const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=24');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          history = data.map((k) => ({
            time: new Date(k[0]).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }),
            price: parseFloat(k[4])
          }));
          price = history[history.length - 1].price;
          source = 'Binance';
        }
      }
    } catch (e) {}

    // 2. Fallback: Coinbase
    if (!price) {
      try {
        const res = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
        if (res.ok) {
          const json = await res.json();
          price = parseFloat(json?.data?.amount);
          source = 'Coinbase';
        }
      } catch (e) {}
    }

    // 3. Fallback: CoinGecko
    if (!price) {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        if (res.ok) {
          const json = await res.json();
          price = parseFloat(json?.bitcoin?.usd);
          source = 'CoinGecko';
        }
      } catch (e) {}
    }

    if (price && Number.isFinite(price)) {
      liveBtcData.currentPrice = price;
      liveBtcData.source = source;
      liveBtcData.lastUpdated = new Date();

      if (history) {
        liveBtcData.history = history;
      } else {
        const timeStr = new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
        liveBtcData.history.push({ time: timeStr, price });
        if (liveBtcData.history.length > 24) liveBtcData.history.shift();
      }

      updateLiveToolbar();

      // Wenn Synchronisation aktiv ist: Kurs im Simulator übernehmen
      if (syncLivePrice) {
        state.btcPriceUSD = Math.round(price);
        renderAll();
      } else if (chartMode === 'live') {
        renderLiveChart();
      }
    }
  }

  function updateLiveToolbar() {
    const pEl = $('liveBtcPriceDisplay');
    const sEl = $('liveBtcSourceBadge');
    if (pEl && liveBtcData.currentPrice) {
      pEl.textContent = `$${fmt0.format(Math.round(liveBtcData.currentPrice))}`;
    }
    if (sEl && liveBtcData.source) {
      sEl.textContent = liveBtcData.source;
    }
  }

  /**
   * Startet den 60-Sekunden-Aktualisierungszyklus samt 1s-Countdown
   */
  function startLiveTimer() {
    if (countdownTimerId) clearInterval(countdownTimerId);
    liveCountdown = 60;
    updateCountdownUI();

    countdownTimerId = setInterval(() => {
      liveCountdown--;
      if (liveCountdown <= 0) {
        liveCountdown = 60;
        fetchLiveBtc();
      }
      updateCountdownUI();
    }, 1000);

    fetchLiveBtc();
  }

  function updateCountdownUI() {
    const el = $('liveBtcCountdown');
    if (el) el.textContent = `Update in ${liveCountdown}s`;
  }

  /**
   * Wechselt den Chart-Modus (Simulator vs. Live BTC-Chart)
   */
  function setChartMode(mode) {
    chartMode = mode;
    const simTab = $('tabSimChart');
    const liveTab = $('tabLiveChart');
    const toolbar = $('liveBtcToolbar');
    const refreshBtn = $('refreshLiveBtcBtn');
    const marker = $('chartActiveMarkerLabel');

    if (mode === 'live') {
      if (simTab) simTab.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition cursor-pointer';
      if (liveTab) liveTab.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer bg-cardbg text-white shadow-sm flex items-center gap-1.5';
      if (toolbar) toolbar.classList.remove('hidden');
      if (refreshBtn) refreshBtn.classList.remove('hidden');
      if (marker) marker.classList.add('hidden');
      if (!countdownTimerId) startLiveTimer();
      renderLiveChart();
    } else {
      if (simTab) simTab.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer bg-cardbg text-white shadow-sm';
      if (liveTab) liveTab.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition cursor-pointer flex items-center gap-1.5';
      if (toolbar) toolbar.classList.add('hidden');
      if (refreshBtn) refreshBtn.classList.add('hidden');
      if (marker) marker.classList.remove('hidden');
      renderSimulatorChart();
    }
  }

  function renderSimulatorChart() {
    if (!chartInstance) return;
    const series = buildPriceCurveSeries(state);
    chartInstance.data = {
      labels: series.prices.map((p) => `$${Math.round(p / 1000)}k`),
      datasets: [
        {
          label: 'Netto-Sats / Tag',
          data: series.netSatsSeries,
          yAxisID: 'ySats',
          borderColor: '#f7931a',
          backgroundColor: 'rgba(247, 147, 26, 0.14)',
          borderWidth: 2.5,
          pointRadius: 2.5,
          tension: 0.25,
          fill: false
        },
        {
          label: 'Netto-CHF / Monat (30d)',
          data: series.netChfSeries,
          yAxisID: 'yChf',
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          borderWidth: 2.5,
          pointRadius: 2.5,
          tension: 0.25,
          fill: false
        }
      ]
    };
    chartInstance.options.scales = {
      x: { grid: { color: 'rgba(148, 163, 184, 0.08)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
      ySats: {
        type: 'linear', position: 'left',
        grid: { color: 'rgba(148, 163, 184, 0.08)' },
        ticks: { color: '#f7931a', font: { size: 11 }, callback: (v) => fmt0.format(v) },
        title: { display: true, text: 'Netto-Sats / Tag', color: '#f7931a', font: { size: 11, weight: '600' } }
      },
      yChf: {
        type: 'linear', position: 'right',
        grid: { drawOnChartArea: false },
        ticks: { color: '#10b981', font: { size: 11 }, callback: (v) => `CHF ${fmt0.format(v)}` },
        title: { display: true, text: 'Netto-CHF / Monat', color: '#10b981', font: { size: 11, weight: '600' } }
      }
    };
    chartInstance.options.plugins.tooltip.callbacks = {
      title: (items) => (items.length ? `BTC-Kurs: $${fmt0.format(series.prices[items[0].dataIndex])}` : ''),
      label: (ctx) =>
        ctx.dataset.yAxisID === 'ySats'
          ? ` Netto-Sats / Tag: ${fmt0.format(Math.round(ctx.parsed.y))} Sats`
          : ` Netto / Monat: ${fmtChf(ctx.parsed.y)}`
    };
    chartInstance.update('none');
  }

  function renderLiveChart() {
    if (!chartInstance) return;
    const history = liveBtcData.history.length > 0
      ? liveBtcData.history
      : [{ time: 'Jetzt', price: state.btcPriceUSD }];

    chartInstance.data = {
      labels: history.map((h) => h.time),
      datasets: [
        {
          label: 'Live BTC / USD Kurs',
          data: history.map((h) => h.price),
          yAxisID: 'ySats',
          borderColor: '#f7931a',
          backgroundColor: 'rgba(247, 147, 26, 0.12)',
          borderWidth: 2.5,
          pointRadius: history.length > 1 ? 2.5 : 5,
          pointHoverRadius: 6,
          tension: 0.25,
          fill: true
        }
      ]
    };
    chartInstance.options.scales = {
      x: { grid: { color: 'rgba(148, 163, 184, 0.08)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
      ySats: {
        type: 'linear', position: 'left',
        grid: { color: 'rgba(148, 163, 184, 0.08)' },
        ticks: { color: '#f7931a', font: { size: 11 }, callback: (v) => `$${fmt0.format(v)}` },
        title: { display: true, text: 'BTC-Kurs (USD)', color: '#f7931a', font: { size: 11, weight: '600' } }
      },
      yChf: { display: false }
    };
    chartInstance.options.plugins.tooltip.callbacks = {
      title: (items) => (items.length ? `Uhrzeit: ${history[items[0].dataIndex]?.time || ''}` : ''),
      label: (ctx) => ` BTC-Kurs: $${fmt2.format(ctx.parsed.y)}`
    };
    chartInstance.update('none');
  }

  /**
   * Initialisiert Chart.js samt vertikaler BTC-Kursmarkierung.
   */
  function initChart() {
    const canvas = $('miningChartCanvas');
    if (typeof Chart === 'undefined' || !canvas) return;

    const activePricePlugin = {
      id: 'activeBtcPriceLine',
      afterDatasetsDraw(chart) {
        if (chartMode !== 'simulator') return;
        const { ctx, chartArea, scales } = chart;
        const cur = state.btcPriceUSD;
        if (!chartArea || !scales.x || cur < 40000 || cur > 200000) return;

        const xPos = chartArea.left + ((cur - 40000) / 160000) * (chartArea.right - chartArea.left);

        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(247, 147, 26, 0.85)';
        ctx.moveTo(xPos, chartArea.top);
        ctx.lineTo(xPos, chartArea.bottom);
        ctx.stroke();

        ctx.setLineDash([]);
        const txt = `$${fmt0.format(Math.round(cur))}`;
        ctx.font = '600 11px Inter, sans-serif';
        const w = ctx.measureText(txt).width + 12;
        const x = Math.min(Math.max(xPos - w / 2, chartArea.left), chartArea.right - w);

        ctx.fillStyle = '#f7931a';
        ctx.beginPath();
        ctx.roundRect(x, chartArea.top + 4, w, 20, 6);
        ctx.fill();

        ctx.fillStyle = '#0b0f17';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, x + w / 2, chartArea.top + 14.5);
        ctx.restore();
      }
    };

    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#cbd5e1', font: { family: 'Inter, sans-serif', size: 12 }, usePointStyle: true, boxWidth: 8 }
          },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10
          }
        }
      },
      plugins: [activePricePlugin]
    });

    renderSimulatorChart();
  }

  /**
   * Rendert alle Benutzeroberflächen-Elemente, KPIs und Charts synchron.
   */
  function renderAll() {
    // 1. Inputs & Slider synchronisieren (ohne das aktive Eingabefeld zu überschreiben)
    PARAMS.forEach(({ key, range, input, dec, min, max }) => {
      const rEl = $(range), iEl = $(input);
      if (rEl) rEl.value = clamp(state[key], min, max);
      if (iEl && document.activeElement !== iEl) {
        iEl.value = dec === 0 ? Math.round(state[key]) : Number(state[key].toFixed(dec));
      }
    });

    if (document.activeElement !== $('targetChfInput')) {
      $('targetChfInput').value = Math.round(state.targetChfMonth);
    }

    // 2. Metriken kalkulieren
    const m = calculateMiningMetrics(state);
    const needed = calculateNeededTHForTarget(state);
    const isPos = m.netSatsDay >= 0;

    // 3. Status-/Warnbanner
    const banner = $('statusBanner');
    if (!isPos || m.netUsdDay < 0) {
      banner.className = 'mt-5 rounded-2xl border border-roseacc/40 bg-roseacc/10 text-rose-200 px-4 py-3 text-sm flex items-start gap-3';
      banner.innerHTML = `
        <span class="font-bold text-roseacc">Achtung:</span>
        <span>Strom- und Servicekosten (${fmtUsd(m.totalCostUsdDay)}/Tag) übersteigen die Brutto-Belohnung (${fmtUsd(m.grossUsdDay)}/Tag).</span>
      `;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    // 4. KPI-Karten
    $('kpiNetSatsDay').textContent = `${fmt0.format(Math.round(m.netSatsDay))} Sats`;
    $('kpiNetSatsDay').className = `text-2xl sm:text-3xl font-bold mt-2 tabular-nums ${isPos ? 'text-white' : 'text-roseacc'}`;
    $('kpiNetBtcDay').textContent = `${m.netBtcDay.toFixed(8)} BTC`;
    $('kpiNetUsdDay').textContent = `${fmtUsd(m.netUsdDay)} / Tag`;
    $('kpiNetUsdDay').className = `font-medium ${isPos ? 'text-emeraldacc' : 'text-roseacc'}`;

    $('kpiNetChfMonth').textContent = fmtChf(m.netChfMonth);
    $('kpiNetChfMonth').className = `text-2xl sm:text-3xl font-bold mt-2 tabular-nums ${isPos ? 'text-emeraldacc' : 'text-roseacc'}`;
    $('kpiNetUsdMonth').textContent = `${fmtUsd(m.netUsdMonth)} / Monat`;
    $('kpiNetSatsMonth').textContent = `${fmt0.format(Math.round(m.netSatsMonth))} Sats`;

    $('kpiCostShareBadge').textContent = `${fmt1.format(m.costSharePct)}%`;
    $('kpiCostUsdDay').textContent = `${fmtUsd(m.totalCostUsdDay)} / Tag`;
    $('kpiCostSatsDay').textContent = `-${fmt0.format(Math.round(m.totalCostSatsDay))} Sats`;
    $('kpiGrossSatsDay').textContent = `Brutto: ${fmt0.format(Math.round(m.grossSatsDay))} Sats`;

    if (needed.reachable) {
      $('kpiNeededTh').textContent = `${fmt0.format(Math.ceil(needed.neededTH))} TH`;
      $('kpiNeededThSub').textContent = state.targetChfMonth === 0
        ? 'Monatsziel: CHF 0 (0 TH nötig)'
        : `Für ${fmtChf(state.targetChfMonth)} / Mon. (${fmtUsd(needed.netUsdPerThDay)}/TH/Tag)`;
    } else {
      $('kpiNeededTh').textContent = 'Nicht erreichbar';
      $('kpiNeededThSub').textContent = needed.reason;
    }

    // 5. Detail-Aufschlüsselung
    $('detailGrossSats').textContent = `${fmt0.format(Math.round(m.grossSatsDay))} Sats`;
    $('detailGrossUsd').textContent = fmtUsd(m.grossUsdDay);
    $('detailElecUsd').textContent = `-${fmtUsd(m.elecUsdDay)}`;
    $('detailServiceUsd').textContent = `-${fmtUsd(m.serviceUsdDay)}`;
    $('detailFeesSats').textContent = `-${fmt0.format(Math.round(m.totalCostSatsDay))} Sats`;
    $('detailNetMarginPct').textContent = `${fmt1.format(m.netMarginPct)}%`;
    $('detailNetMarginPct').className = `font-semibold ${isPos ? 'text-emeraldacc' : 'text-roseacc'}`;

    if ($('detailNetChfDay')) {
      $('detailNetChfDay').textContent = fmtChf(m.netChfDay);
      $('detailNetChfDay').className = `font-semibold ${isPos ? 'text-emeraldacc' : 'text-roseacc'}`;
    }
    if ($('detailNetChfMonth')) {
      $('detailNetChfMonth').textContent = fmtChf(m.netChfMonth);
      $('detailNetChfMonth').className = `font-semibold ${isPos ? 'text-emeraldacc' : 'text-roseacc'}`;
    }

    // 6. Netto-Ertrag CHF Zusammenfassung am Ende
    if ($('summaryNetChfDay')) {
      $('summaryNetChfDay').textContent = fmtChf(m.netChfDay);
      $('summaryNetChfDay').className = `text-lg sm:text-xl font-bold ${isPos ? 'text-emeraldacc' : 'text-roseacc'}`;
    }
    if ($('summaryNetChfMonth')) {
      $('summaryNetChfMonth').textContent = fmtChf(m.netChfMonth);
      $('summaryNetChfMonth').className = `text-xl sm:text-2xl font-bold ${isPos ? 'text-emeraldacc' : 'text-roseacc'}`;
    }

    $('chartActiveMarkerLabel').textContent = `Aktiver BTC-Kurs: $${fmt0.format(Math.round(state.btcPriceUSD))}`;

    // 7. Chart aktualisieren je nach gewähltem Modus
    if (chartMode === 'simulator') {
      renderSimulatorChart();
    } else {
      renderLiveChart();
    }

    // 8. Automatisch im LocalStorage speichern
    saveState();
  }

  /**
   * Initialisierung & Event-Registrierung
   */
  function init() {
    // Gespeicherte Werte aus LocalStorage vorab laden
    loadState();

    // Chart-Tabs verbinden (Simulator vs. Live BTC)
    const tabSim = $('tabSimChart');
    const tabLive = $('tabLiveChart');
    if (tabSim) tabSim.onclick = () => setChartMode('simulator');
    if (tabLive) tabLive.onclick = () => setChartMode('live');

    // Live-Kurs Aktualisierungs-Button
    const refreshBtn = $('refreshLiveBtcBtn');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        liveCountdown = 60;
        updateCountdownUI();
        fetchLiveBtc();
      };
    }

    // Live-Kurs Button im Preset-Bereich
    const livePresetBtn = $('fetchLiveBtcBtn');
    if (livePresetBtn) {
      livePresetBtn.onclick = () => {
        syncLivePrice = true;
        const check = $('syncLivePriceCheck');
        if (check) check.checked = true;
        startLiveTimer();
      };
    }

    // Checkbox für Übernahme des Live-Kurses in den Rechner
    const syncCheck = $('syncLivePriceCheck');
    if (syncCheck) {
      syncCheck.onchange = (e) => {
        syncLivePrice = e.target.checked;
        if (syncLivePrice && liveBtcData.currentPrice) {
          state.btcPriceUSD = Math.round(liveBtcData.currentPrice);
          renderAll();
        }
      };
    }

    // Slider & Number-Inputs deklarativ verbinden
    PARAMS.forEach(({ key, range, input, min, max, dec }) => {
      const rEl = $(range), iEl = $(input);

      // Slider schiebt
      rEl.oninput = () => {
        state[key] = +rEl.value;
        renderAll();
      };

      // Direkte Eingabe im Textfeld (tippfreundlich, stört nicht bei Zwischenschritten wie '', '-', '.')
      iEl.oninput = () => {
        const raw = iEl.value.trim();
        if (raw === '' || raw === '-' || raw === '.') return;
        const val = parseFloat(raw);
        if (Number.isFinite(val)) {
          state[key] = Math.max(min, val);
          if (rEl) rEl.value = clamp(state[key], min, max);
          renderAll();
        }
      };

      // Beim Verlassen des Feldes oder Enter: saubere Validierung & Formatierung
      const finalize = () => {
        const raw = iEl.value.trim();
        let val = parseFloat(raw);
        if (!Number.isFinite(val)) {
          val = 0;
        } else {
          val = Math.max(min, val);
        }
        state[key] = val;
        iEl.value = dec === 0 ? Math.round(val) : Number(val.toFixed(dec));
        if (rEl) rEl.value = clamp(val, min, max);
        renderAll();
      };

      iEl.onblur = finalize;
      iEl.onkeydown = (e) => {
        if (e.key === 'Enter') {
          finalize();
          iEl.blur();
        }
      };
    });

    // Monatsziel Input (erlaubt auch Wert 0)
    const targetEl = $('targetChfInput');
    targetEl.oninput = () => {
      const raw = targetEl.value.trim();
      if (raw === '' || raw === '-') return;
      const val = parseFloat(raw);
      if (Number.isFinite(val)) {
        state.targetChfMonth = Math.max(0, val);
        renderAll();
      }
    };
    targetEl.onblur = () => {
      const raw = targetEl.value.trim();
      const val = parseFloat(raw);
      state.targetChfMonth = Number.isFinite(val) ? Math.max(0, Math.round(val)) : 0;
      targetEl.value = state.targetChfMonth;
      renderAll();
    };
    targetEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        targetEl.blur();
      }
    };

    // Schnellwahl-Buttons (Presets)
    document.querySelectorAll('[data-preset-th], [data-preset-disc], [data-preset-btc]').forEach((btn) => {
      btn.onclick = () => {
        if (btn.dataset.presetTh !== undefined) state.hashrateTH = +btn.dataset.presetTh;
        if (btn.dataset.presetDisc !== undefined) state.discountPct = +btn.dataset.presetDisc;
        if (btn.dataset.presetBtc !== undefined) state.btcPriceUSD = +btn.dataset.presetBtc;
        renderAll();
      };
    });

    // Reset auf Ausgangswerte (falls vorhanden)
    const resetBtn = $('resetBaselineBtn');
    if (resetBtn) {
      resetBtn.onclick = () => {
        Object.assign(state, BASELINE);
        saveState();
        renderAll();
      };
    }

    initChart();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
