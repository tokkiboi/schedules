(() => {
  "use strict";

  const MASTER_ID = "1M-vZ24Yw4ZN7R7b_473cVn8kny8DznTakSsD3VQsCzc";
  const SNAPSHOT_KEY = "sk-pages-schedule-snapshot-v1";
  const FINISHED = new Set(["SHIPPED", "DELIVERED", "RECEIVED", "COMPLETED", "CANCELLED", "CANCELED"]);
  const state = { inbound: [], outbound: [], direction: "inbound", query: "", mode: "", attentionOnly: false, showFinished: false, lastChecked: "", changes: [], loading: true };
  let initialized = false;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const normalizedStatus = (value) => String(value || "Work in Progress").trim().replace(/\s+/g, " ");
  const isFinished = (value) => FINISHED.has(normalizedStatus(value).toUpperCase());
  const slug = (value) => String(value || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z-]/g, "");

  function value(row, ...keys) {
    for (const key of keys) {
      const hit = row[String(key).toUpperCase()];
      if (hit != null && String(hit).trim()) return String(hit).trim();
    }
    return "";
  }

  function dateNumber(input) {
    const text = String(input || "").trim();
    if (!text) return Number.MAX_SAFE_INTEGER;
    if (/^\d{5}(?:\.\d+)?$/.test(text)) {
      const serial = Number(text);
      if (serial >= 30000 && serial <= 70000) return (serial - 25569) * 86400000;
    }
    const parts = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (parts) {
      let year = parts[3] ? Number(parts[3]) : new Date().getFullYear();
      if (year < 100) year += 2000;
      return new Date(year, Number(parts[1]) - 1, Number(parts[2])).getTime();
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
  }

  function shortDate(value) {
    const time = dateNumber(value);
    if (time === Number.MAX_SAFE_INTEGER) return value || "—";
    return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" }).format(new Date(time));
  }

  function relativeTime(value) {
    const time = Date.parse(value || "");
    if (Number.isNaN(time)) return "—";
    const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    if (minutes < 60) return `${minutes} minutes ago`;
    return new Date(time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function validDate(text) {
    const time = dateNumber(text);
    if (time === Number.MAX_SAFE_INTEGER) return false;
    const year = new Date(time).getFullYear();
    const current = new Date().getFullYear();
    return year >= current - 2 && year <= current + 3;
  }

  function carrierFor(identifier, contextValue, fallbackValue = contextValue) {
    const id = String(identifier || "").replace(/\s+/g, "").toUpperCase();
    const context = String(contextValue || "").toUpperCase();
    if (/^1Z[A-Z0-9]{16}$/.test(id) || id === "UPS" || context.includes("UPS")) return "UPS";
    if (/^9[234]\d{17,21}$/.test(id) || id === "USPS" || context.includes("USPS")) return "USPS";
    if (/FEDEX|FDX/.test(context) || id === "FEDEX") return "FedEx";
    if (context.includes("DHL") || id === "DHL") return "DHL";
    if (context.includes("AMAZON") || id === "AMAZON" || /^TBA\d+/.test(id)) return "Amazon Logistics";
    if (/KOREAN AIR/.test(context) || /^180-?\d{8}$/.test(id)) return "Korean Air Cargo";
    if (/^(HMMU|HDMU)/.test(id) || context.includes("HMM")) return "HMM";
    if (/^(MAEU|MSKU|MRSU)/.test(id) || context.includes("MAERSK")) return "Maersk";
    if (/^SMCU/.test(id) || context.includes("SM LINE")) return "SM Line";
    if (/^ONEU/.test(id)) return "ONE";
    if (/^KMTU/.test(id)) return "KMTC";
    if (/^(MSCU|MEDU)/.test(id) || context.includes("MSC")) return "MSC";
    if (/^EGLV/.test(id) || context.includes("EVERGREEN")) return "Evergreen";
    if (/^OOLU/.test(id) || context.includes("OOCL")) return "OOCL";
    if (/^COSU/.test(id) || context.includes("COSCO")) return "COSCO";
    if (/^CMAU/.test(id) || context.includes("CMA CGM")) return "CMA CGM";
    if (/^YMLU/.test(id) || context.includes("YANG MING")) return "Yang Ming";
    if (/^ZIMU/.test(id) || context.includes("ZIM")) return "ZIM";
    return String(fallbackValue || "").trim();
  }

  function shipmentMode(direction, row, identifier, carrier) {
    const declared = value(row, "CARRIER TYPE").toUpperCase();
    const context = [identifier, carrier, value(row, "VESSEL / FLIGHT", "SHIPPING METHOD", "SHIPMENT TYPE", "CARRIER TYPE", "NOTE"), value(row, "MBL", "HBL", "CONTAINER", "AWB"), value(row, "PALLET TYPE", "WEIGHT (LBS)")].join(" ").toUpperCase();
    if (/UPS|USPS|FEDEX|FDX|DHL|AMAZON|TBA\d+/.test(context)) return "Small parcel";
    if (/^\d{3}-?\d{8}$/.test(String(identifier).replace(/\s+/g, "")) || /\bAIR\b|AIRFREIGHT|AIR FREIGHT|FLIGHT|\bAWB\b|KOREAN AIR/.test(context)) return "Air freight";
    if (/^[A-Z]{4}\d{7}$/.test(String(identifier).replace(/\s+/g, ""))) return "Ocean freight";
    if (declared.includes("AIR")) return "Air freight";
    if (declared.includes("OCEAN")) return "Ocean freight";
    if (/\bOCEAN\b|VESSEL|CONTAINER|\bMBL\b|\bHBL\b|\bFCL\b|\bLCL\b/.test(context)) return "Ocean freight";
    if (direction === "outbound" && (/LTL|FTL|TRUCK|FREIGHT|PALLET|PRO#/.test(context) || (identifier && carrier))) return "Ground freight";
    return "Unclassified";
  }

  function trackingUrl(identifier, carrier) {
    const id = String(identifier || "").replace(/\s+/g, "").toUpperCase();
    if (!id) return "";
    const encoded = encodeURIComponent(id);
    if (/^1Z[A-Z0-9]{16}$/.test(id) || /UPS/i.test(carrier)) return `https://www.ups.com/track?tracknum=${encoded}`;
    if (/^9[234]\d{17,21}$/.test(id) || /USPS/i.test(carrier)) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
    if (/FEDEX|FDX/i.test(carrier)) return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
    if (/DHL/i.test(carrier)) return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encoded}`;
    if (/AMAZON/i.test(carrier) || /^TBA\d+/.test(id)) return "https://track.amazon.com/";
    if (/^HMMU/.test(id) || /HMM/i.test(carrier)) return `https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do?searchType=CNTR&searchNo=${encoded}`;
    if (/^(MAEU|MSKU|MRSU)/.test(id) || /MAERSK/i.test(carrier)) return `https://www.maersk.com/tracking/${encoded}`;
    if (/^SMCU/.test(id)) return `https://esvc.smlines.com/smline/CUP_HOM_3301GS.do?search_name=${encoded}&search_type=C`;
    if (/ONE/i.test(carrier) || /^ONEU/.test(id)) return `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${encoded}`;
    if (/MSC/i.test(carrier)) return "https://www.msc.com/en/track-a-shipment";
    if (/EVERGREEN/i.test(carrier)) return "https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do";
    if (/OOCL/i.test(carrier)) return "https://www.oocl.com/eng/ourservices/eservices/cargotracking/Pages/cargotracking.aspx";
    if (/COSCO/i.test(carrier)) return "https://elines.coscoshipping.com/ebusiness/cargoTracking";
    if (/CMA CGM/i.test(carrier)) return `https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Container&Reference=${encoded}`;
    return `https://www.17track.net/en?nums=${encoded}`;
  }

  function quality(direction, record) {
    const missing = [];
    if (!record.date) missing.push(direction === "inbound" ? "ETA" : "ship date");
    else if (!validDate(record.date)) missing.push("valid date");
    if (!record.identifier) missing.push(direction === "inbound" ? "container / MBL / HBL / AWB" : "PRO / tracking / BOL");
    if (!record.carrier) missing.push("carrier");
    if (record.shipmentMode === "Unclassified") missing.push("shipment type");
    if (direction === "outbound" && !record.customer) missing.push("customer");
    if (!record.invoice) missing.push("invoice");
    if (!record.trackingUrl) missing.push("trace link");
    return missing;
  }

  function querySheet(sheet, range) {
    return new Promise((resolve, reject) => {
      const url = `https://docs.google.com/spreadsheets/d/${MASTER_ID}/gviz/tq?headers=1&sheet=${encodeURIComponent(sheet)}&range=${encodeURIComponent(range)}`;
      const query = new google.visualization.Query(url);
      query.send((response) => {
        if (response.isError()) {
          reject(new Error(response.getMessage() || `${sheet} could not be read`));
          return;
        }
        const table = response.getDataTable();
        const headers = Array.from({ length: table.getNumberOfColumns() }, (_, index) => String(table.getColumnLabel(index) || `COLUMN ${index + 1}`).trim().toUpperCase());
        const rows = Array.from({ length: table.getNumberOfRows() }, (_, rowIndex) => {
          const values = {};
          headers.forEach((header, columnIndex) => { values[header] = table.getFormattedValue(rowIndex, columnIndex) || String(table.getValue(rowIndex, columnIndex) ?? ""); });
          return { values, rowIndex };
        });
        resolve(rows);
      });
    });
  }

  function mapInbound(rows, importRows = []) {
    const importStatuses = new Map(importRows.map(({ values: row, rowIndex }) => [rowIndex + 2, value(row, "STATUS", "WEBSITE STATUS")]));
    return rows.map(({ values: row, rowIndex }) => {
      const shipmentNumber = value(row, "SHIPMENT #");
      if (/^(URGENT|AS OF|SCHEDULED|COMPLETED|ESTIMATED)/i.test(shipmentNumber)) return null;
      const declaredCarrier = value(row, "CARRIER TYPE");
      const parcel = /UPS|USPS|FEDEX|DHL|AMAZON/i.test(`${declaredCarrier} ${shipmentNumber}`);
      let identifier = parcel
        ? value(row, "DOCS / FOLDER", "ENTRY NUMBER", "CONTAINER", "SHIPMENT #")
        : value(row, "CONTAINER", "MBL", "HBL", "SHIPMENT #");
      if (parcel && /^(UPS|USPS|FEDEX|DHL|AMAZON)$/i.test(identifier)) identifier = "";
      const vessel = value(row, "VESSEL / FLIGHT", "CARRIER");
      const fallbackCarrier = /^(AIR|OCEAN)$/i.test(declaredCarrier) ? vessel : declaredCarrier;
      const carrier = carrierFor(identifier, [declaredCarrier, vessel, shipmentNumber].join(" "), fallbackCarrier);
      const sourceRow = Number(value(row, "IMPORTS SOURCE ROW")) || rowIndex + 4;
      const mode = shipmentMode("inbound", row, identifier, carrier);
      const embeddedEta = [value(row, "MBL"), value(row, "HBL"), value(row, "NOTES / QTY")].join(" ").match(/ETA:\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i)?.[1] || "";
      const record = {
        id: `inbound-${identifier || value(row, "INVOICE") || sourceRow}`,
        direction: "inbound", date: value(row, "ETA", "DELIVERY EXPECTED") || embeddedEta, customer: parcel ? `${shipmentNumber || carrier} shipment` : value(row, "DOCS / FOLDER", "SHIPMENT #") || "Inbound shipment",
        invoice: value(row, "INVOICE"), identifier, carrier, route: [value(row, "ORIGIN"), value(row, "DESTINATION")].filter(Boolean).join(" → ") || value(row, "RESERVED / BROKER"),
        units: value(row, "NOTES / QTY"), status: importStatuses.get(sourceRow) || value(row, "INBOUND STATUS", "STATUS") || "Work in Progress", shipmentMode: mode, sourceRow,
        sourceUrl: `https://docs.google.com/spreadsheets/d/${MASTER_ID}/edit#gid=1497250700&range=A${sourceRow}:AF${sourceRow}`, trackingUrl: trackingUrl(identifier, carrier)
      };
      record.missingFields = quality("inbound", record);
      record.quality = record.missingFields.length ? "needs-review" : "complete";
      return record;
    }).filter((row) => row && (row.identifier || row.invoice || row.date || row.carrier || row.route));
  }

  function mapOutbound(rows) {
    return rows.map(({ values: row, rowIndex }) => {
      const sourceRow = rowIndex + 4;
      const identifier = value(row, "PRO#", "TRACKING #", "BOL");
      const carrier = carrierFor(identifier, value(row, "CARRIER"));
      const mode = shipmentMode("outbound", row, identifier, carrier);
      const record = {
        id: `outbound-${value(row, "INVOICE NO.") || identifier || sourceRow}`,
        direction: "outbound", date: value(row, "SHIP DATE"), customer: value(row, "CUSTOMER") || "Outbound shipment", invoice: value(row, "INVOICE NO."), identifier, carrier,
        route: value(row, "ADDRESS", "DESTINATION"), units: [value(row, "PALLET TYPE"), value(row, "WEIGHT (LBS)") ? `${value(row, "WEIGHT (LBS)")} lbs` : ""].filter(Boolean).join(" · "),
        status: value(row, "STATUS") || "Work in Progress", shipmentMode: mode, sourceRow,
        sourceUrl: `https://docs.google.com/spreadsheets/d/${MASTER_ID}/edit#gid=20260708&range=A${sourceRow}:V${sourceRow}`, trackingUrl: trackingUrl(identifier, carrier)
      };
      record.missingFields = quality("outbound", record);
      record.quality = record.missingFields.length ? "needs-review" : "complete";
      return record;
    }).filter((row) => row.invoice || row.identifier || row.date || row.carrier || row.route);
  }

  function snapshot() {
    return Object.fromEntries([...state.inbound, ...state.outbound].map((row) => [row.id, { status: row.status, date: row.date, identifier: row.identifier, carrier: row.carrier, shipmentMode: row.shipmentMode, customer: row.customer }]));
  }

  function detectChanges(previous) {
    const next = snapshot();
    const events = [];
    for (const [id, row] of Object.entries(next)) {
      const before = previous[id];
      if (!before) { events.push({ id: `${id}-added`, kind: "added", label: row.customer || row.identifier, detail: "Added to the expected schedule" }); continue; }
      if (normalizedStatus(before.status) !== normalizedStatus(row.status)) events.push({ id: `${id}-status`, kind: "status", label: row.customer || row.identifier, detail: `${before.status || "No status"} → ${row.status || "No status"}` });
      if (before.date !== row.date || before.identifier !== row.identifier) events.push({ id: `${id}-schedule`, kind: "schedule", label: row.customer || row.identifier, detail: "Schedule or tracking identity changed" });
      if (before.carrier !== row.carrier || before.shipmentMode !== row.shipmentMode) events.push({ id: `${id}-class`, kind: "classification", label: row.customer || row.identifier, detail: "Carrier or shipment type changed" });
    }
    for (const [id, row] of Object.entries(previous)) if (!next[id]) events.push({ id: `${id}-removed`, kind: "removed", label: row.customer || row.identifier, detail: "Removed — confirm cancellation or source-row movement" });
    state.changes = [...events, ...state.changes].slice(0, 40);
  }

  async function loadData(silent = false) {
    if (!silent) state.loading = true;
    $("#refresh").disabled = true;
    $("#refresh").textContent = "Refreshing…";
    const previous = (() => { try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "{}"); } catch { return {}; } })();
    const [inboundResult, outboundResult, importsResult] = await Promise.allSettled([
      querySheet("INBOUND SHIPMENTS DATA", "A3:S1200"),
      querySheet("Outbound Shipping Schedule", "A3:V1000"),
      querySheet("IMPORTS", "A1:AF1200")
    ]);
    state.inbound = inboundResult.status === "fulfilled" ? mapInbound(inboundResult.value, importsResult.status === "fulfilled" ? importsResult.value : []) : [];
    state.outbound = outboundResult.status === "fulfilled" ? mapOutbound(outboundResult.value) : [];
    state.lastChecked = new Date().toISOString();
    state.loading = false;
    const primaryLive = inboundResult.status === "fulfilled" && outboundResult.status === "fulfilled";
    if (Object.keys(previous).length) detectChanges(previous);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot()));
    render(primaryLive, [inboundResult, outboundResult]);
    $("#refresh").disabled = false;
    $("#refresh").textContent = "Refresh source";
  }

  function active(direction) {
    return state[direction].filter((row) => !isFinished(row.status)).sort((a, b) => dateNumber(a.date) - dateNumber(b.date));
  }

  function statusClass(status) {
    const value = normalizedStatus(status).toLowerCase();
    if (/complete|delivered|received|shipped|cancel/.test(value)) return "status-finished";
    if (/ready/.test(value)) return "status-ready";
    if (/shipping|transit|route/.test(value)) return "status-transit";
    if (/scheduled|booked/.test(value)) return "status-scheduled";
    return "status-working";
  }

  function previewHtml(rows) {
    if (!rows.length) return '<p class="preview-empty">No active expected shipments.</p>';
    return rows.slice(0, 4).map((row) => `<div class="preview-row"><span class="preview-date">${escapeHtml(shortDate(row.date))}</span><span><strong>${escapeHtml(row.customer || row.identifier || "Shipment")}</strong><small>${escapeHtml(row.identifier || row.invoice)}</small></span><span>${escapeHtml(row.carrier || "Carrier pending")}</span><span class="mini-status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></div>`).join("");
  }

  function visibleRows() {
    const query = state.query.trim().toLowerCase();
    return state[state.direction]
      .filter((row) => state.showFinished || !isFinished(row.status))
      .filter((row) => !state.mode || row.shipmentMode === state.mode)
      .filter((row) => !state.attentionOnly || row.quality === "needs-review")
      .filter((row) => !query || Object.values(row).flat().join(" ").toLowerCase().includes(query))
      .sort((a, b) => dateNumber(a.date) - dateNumber(b.date));
  }

  function tableRow(row) {
    const trace = row.trackingUrl ? `<a class="tracking-link" href="${escapeHtml(row.trackingUrl)}" target="_blank" rel="noreferrer">Track live ↗</a>` : "";
    const qualityCell = row.quality === "complete" ? '<span class="quality-ok">✓ Complete</span>' : `<span class="quality-warning" title="${escapeHtml(row.missingFields.join(", "))}">! Review<small>${escapeHtml(row.missingFields.join(" · "))}</small></span>`;
    return `<tr class="${isFinished(row.status) ? "finished-row" : ""} ${row.quality === "needs-review" ? "review-row" : ""}">
      <td data-label="Date / ETA"><strong class="date-cell">${escapeHtml(shortDate(row.date))}</strong><small>${row.direction === "inbound" ? "Expected arrival" : "Ship date"}</small></td>
      <td data-label="Shipment"><strong>${escapeHtml(row.customer || "—")}</strong><small>${escapeHtml(row.invoice || "No invoice listed")}</small></td>
      <td data-label="Identifier"><strong class="mono">${escapeHtml(row.identifier || "Missing identifier")}</strong>${trace}<small>${escapeHtml(row.units)}</small></td>
      <td data-label="Carrier & type"><strong>${escapeHtml(row.carrier || "Carrier missing")}</strong><span class="mode-pill mode-${slug(row.shipmentMode)}">${escapeHtml(row.shipmentMode)}</span></td>
      <td data-label="Route">${escapeHtml(row.route || "—")}</td>
      <td data-label="Data check">${qualityCell}</td>
      <td data-label="Source"><a class="source-pill source-mint" href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noreferrer">LOGISTICS MASTER ↗</a><small>Row ${row.sourceRow} · correct source</small></td>
      <td data-label="Status"><span class="status-pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
    </tr>`;
  }

  function render(primaryLive, results = []) {
    const inbound = active("inbound");
    const outbound = active("outbound");
    const review = [...inbound, ...outbound].filter((row) => row.quality === "needs-review");
    $("#kpi-inbound").textContent = inbound.length;
    $("#kpi-outbound").textContent = outbound.length;
    $("#kpi-review").textContent = review.length;
    $("#kpi-sources").textContent = primaryLive ? "1/3" : "0/3";
    $("#kpi-checked").textContent = relativeTime(state.lastChecked);
    $("#review-total").textContent = review.length;
    $("#tab-inbound span").textContent = inbound.length;
    $("#tab-outbound span").textContent = outbound.length;
    $("#preview-inbound").innerHTML = previewHtml(inbound);
    $("#preview-outbound").innerHTML = previewHtml(outbound);

    const integrity = $("#integrity");
    integrity.classList.add("has-warnings");
    if (primaryLive) {
      $("#source-health-title").textContent = "1 of 3 sources live";
      $("#source-health-detail").textContent = "Primary schedule verified · WMS and National workbooks remain private links";
      $("#live-state").innerHTML = `<span class="live-dot"></span>Primary source checked ${escapeHtml(relativeTime(state.lastChecked))}`;
      $("#logistics-state").textContent = "live";
      $("#logistics-state").className = "source-state state-live";
      $("#logistics-detail").textContent = "Live browser read verified · exact source-row links enabled";
    } else {
      const errors = results.filter((item) => item.status === "rejected").map((item) => item.reason?.message || "Schedule read failed");
      $("#source-health-title").textContent = "Primary source unavailable";
      $("#source-health-detail").textContent = [...errors, "WMS and National workbooks remain private"].join(" · ");
      $("#live-state").innerHTML = '<span class="offline-dot"></span>Live schedule unavailable — no cached rows displayed';
      $("#logistics-state").textContent = "unavailable";
      $("#logistics-state").className = "source-state state-unavailable";
      $("#logistics-detail").textContent = "Direct browser read failed · open the workbook to verify sharing";
    }

    const modes = [...new Set([...state.inbound, ...state.outbound].map((row) => row.shipmentMode))].sort();
    const modeSelect = $("#mode-filter");
    const currentMode = state.mode;
    modeSelect.innerHTML = '<option value="">All shipment types</option>' + modes.map((mode) => `<option value="${escapeHtml(mode)}">${escapeHtml(mode)}</option>`).join("");
    modeSelect.value = currentMode;
    renderTable();
    renderChanges();
  }

  function renderTable() {
    const rows = visibleRows();
    $("#party-heading").textContent = state.direction === "inbound" ? "Shipment / Invoice" : "Customer / Invoice";
    $$("[data-direction]").forEach((button) => button.classList.toggle("active", button.dataset.direction === state.direction));
    const body = $("#schedule-body");
    if (state.loading) body.innerHTML = '<tr class="empty-row"><td colspan="8">Loading expected schedules…</td></tr>';
    else if (!rows.length) body.innerHTML = '<tr class="empty-row"><td colspan="8">No matching active schedules. Finished rows remain available through “Show finished.”</td></tr>';
    else body.innerHTML = rows.slice(0, 150).map(tableRow).join("");
    const limit = $("#row-limit");
    limit.hidden = rows.length <= 150;
    limit.textContent = rows.length > 150 ? `Showing the first 150 of ${rows.length} matching rows.` : "";
  }

  function renderChanges() {
    $("#change-count").textContent = state.changes.length ? `${state.changes.length} change${state.changes.length === 1 ? "" : "s"} detected` : "No changes detected in this browser yet";
    $("#change-feed").innerHTML = state.changes.length
      ? state.changes.slice(0, 4).map((item) => `<span class="change-chip change-${item.kind}"><b>${escapeHtml(item.label)}</b> ${escapeHtml(item.detail)}</span>`).join("")
      : '<span class="change-empty">Added, removed, rescheduled, cancelled, shipped, completed, and reclassified records will appear here.</span>';
  }

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.hidden = false;
    setTimeout(() => { element.hidden = true; }, 2600);
  }

  function bindEvents() {
    $$('[data-theme]').forEach((button) => button.addEventListener("click", () => {
      const theme = button.dataset.theme;
      $("#app").className = `ops-app theme-${theme}`;
      $$('[data-theme]').forEach((item) => item.classList.toggle("selected", item === button));
      localStorage.setItem("sk-pages-theme", theme);
    }));
    const savedTheme = localStorage.getItem("sk-pages-theme");
    if (["editorial", "control", "network"].includes(savedTheme)) $(`[data-theme="${savedTheme}"]`).click();
    $$('[data-direction], [data-direction-link], [data-open]').forEach((button) => button.addEventListener("click", () => {
      state.direction = button.dataset.direction || button.dataset.directionLink || button.dataset.open;
      renderTable();
      $("#schedule").scrollIntoView({ behavior: "smooth" });
    }));
    $("#search").addEventListener("input", (event) => { state.query = event.target.value; renderTable(); });
    $("#mode-filter").addEventListener("change", (event) => { state.mode = event.target.value; renderTable(); });
    $("#attention-only").addEventListener("change", (event) => { state.attentionOnly = event.target.checked; renderTable(); });
    $("#show-finished").addEventListener("change", (event) => { state.showFinished = event.target.checked; renderTable(); });
    $("#review-shortcut").addEventListener("click", () => { state.attentionOnly = true; $("#attention-only").checked = true; renderTable(); $("#schedule").scrollIntoView({ behavior: "smooth" }); });
    $("#refresh").addEventListener("click", () => loadData(true));
    $("#share").addEventListener("click", async () => {
      try {
        if (navigator.share) await navigator.share({ title: document.title, text: "Expected inbound and outbound shipping schedules", url: location.href });
        else { await navigator.clipboard.writeText(location.href); toast("Share link copied"); }
      } catch { /* user cancelled */ }
    });
  }

  function init() {
    initialized = true;
    bindEvents();
    loadData();
    setInterval(() => loadData(true), 2 * 60 * 1000);
    setInterval(() => { if (state.lastChecked) $("#kpi-checked").textContent = relativeTime(state.lastChecked); }, 30 * 1000);
  }

  window.addEventListener("DOMContentLoaded", () => {
    const watchdog = setTimeout(() => {
      if (!initialized) {
        $("#live-state").innerHTML = '<span class="offline-dot"></span>Google schedule reader could not start';
        $("#source-health-title").textContent = "Schedule reader unavailable";
        $("#source-health-detail").textContent = "No cached rows are displayed. Refresh the page or open the source workbook.";
        $("#integrity").classList.add("has-warnings");
      }
    }, 15000);
    if (!window.google?.charts) return;
    google.charts.load("current", { packages: ["table"] });
    google.charts.setOnLoadCallback(() => { clearTimeout(watchdog); init(); });
  });
})();
