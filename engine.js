/* ============================================================================
   Hotel Capital Stack Diagnostic — Deterministic Calculation Engine
   Modern Hospitality Solutions (MHS)
   ----------------------------------------------------------------------------
   This layer NEVER relies on AI to do math. All functions are pure and
   auditable. Inputs are plain numbers; functions return numbers or small
   objects. UI and AI explanation layers consume these outputs.
   ============================================================================ */
(function (global) {
  "use strict";

  // ---- low-level helpers ---------------------------------------------------
  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function pct(x) { return x / 100; }
  function round(x, d) { d = d == null ? 2 : d; var f = Math.pow(10, d); return Math.round(x * f) / f; }

  /* Loan constant = annual debt service per $1 of loan, fully amortizing. */
  function loanConstant(rateAnnualPct, amortYears, interestOnly) {
    var r = pct(rateAnnualPct);
    if (interestOnly) return r;
    if (!isNum(r) || r <= 0) return null;
    if (!isNum(amortYears) || amortYears <= 0) return null;
    var i = r / 12, n = amortYears * 12;
    return (i / (1 - Math.pow(1 + i, -n))) * 12;
  }

  function annualDebtServiceFromLoan(balance, rateAnnualPct, amortYears, interestOnly) {
    var k = loanConstant(rateAnnualPct, amortYears, interestOnly);
    if (k == null || !isNum(balance)) return null;
    return balance * k;
  }

  function dscr(noi, annualDebtService) {
    if (!isNum(noi) || !isNum(annualDebtService) || annualDebtService <= 0) return null;
    return noi / annualDebtService;
  }

  function dscrBand(d) {
    if (d == null) return { label: "Unknown", tone: "unknown" };
    if (d < 1.0) return { label: "Below 1.00x — NOI does not cover debt service", tone: "critical" };
    if (d < 1.2) return { label: "1.00x–1.20x — thin coverage", tone: "warn" };
    if (d < 1.35) return { label: "1.20x–1.35x — may be acceptable", tone: "ok" };
    return { label: "1.35x+ — generally healthier", tone: "good" };
  }

  /* Plain-dollar cash flow after debt service (before capex/reserves). */
  function cashAfterDebt(noi, annualDebtService) {
    if (!isNum(noi) || !isNum(annualDebtService)) return null;
    return noi - annualDebtService;
  }

  function requiredNOI(annualDebtService, targetDSCR) {
    if (!isNum(annualDebtService) || !isNum(targetDSCR)) return null;
    return annualDebtService * targetDSCR;
  }

  function breakEvenNOI(annualDebtService) { return isNum(annualDebtService) ? annualDebtService : null; }

  function debtYield(noi, loanBalance) {
    if (!isNum(noi) || !isNum(loanBalance) || loanBalance <= 0) return null;
    return (noi / loanBalance) * 100;
  }

  /* Supportable loan = the binding (minimum) of DSCR, debt-yield, and LTV tests. */
  function supportableLoan(o) {
    var k = loanConstant(o.refiRatePct, o.amortYears, false), tests = {};
    if (isNum(o.noi) && isNum(o.targetDSCR) && k) tests.dscr = (o.noi / o.targetDSCR) / k;
    if (isNum(o.noi) && isNum(o.minDebtYieldPct) && o.minDebtYieldPct > 0) tests.debtYield = o.noi / pct(o.minDebtYieldPct);
    if (isNum(o.value) && isNum(o.maxLTVPct) && o.maxLTVPct > 0) tests.ltv = o.value * pct(o.maxLTVPct);
    var vals = Object.keys(tests).map(function (k2) { return tests[k2]; }).filter(isNum);
    if (!vals.length) return { loan: null, binding: null, tests: tests };
    var loan = Math.min.apply(null, vals);
    var binding = Object.keys(tests).filter(function (k2) { return tests[k2] === loan; })[0];
    return { loan: loan, binding: binding, tests: tests };
  }

  /* Required NOI to refinance the CURRENT balance — uses the SAME binding logic
     as supportableLoan (max of the DSCR-implied and debt-yield-implied NOI), so
     the two outputs always tell a consistent story. */
  function requiredNOIToRefinance(o) {
    var k = loanConstant(o.refiRatePct, o.amortYears, false);
    var byDSCR = (isNum(o.balance) && k && isNum(o.targetDSCR)) ? o.balance * k * o.targetDSCR : null;
    var byDY = (isNum(o.balance) && isNum(o.minDebtYieldPct)) ? o.balance * pct(o.minDebtYieldPct) : null;
    var vals = [byDSCR, byDY].filter(isNum);
    if (!vals.length) return null;
    return { value: Math.max.apply(null, vals), byDSCR: byDSCR, byDebtYield: byDY,
             binding: byDSCR != null && (byDY == null || byDSCR >= byDY) ? "dscr" : "debtYield" };
  }

  /* Sources & uses refinance gap. The honest hole to clear at maturity:
       (existing balance + net capex due + refi costs + prepay/defeasance) − supportable proceeds. */
  function refinanceGap(o) {
    if (!isNum(o.balance) || !isNum(o.supportableProceeds)) return null;
    var refiCost = isNum(o.refiCostPct) ? o.supportableProceeds * pct(o.refiCostPct) : 0;
    var netCapex = isNum(o.netCapex) && o.netCapex > 0 ? o.netCapex : 0;
    var prepay = isNum(o.prepay) ? o.prepay : 0;
    var uses = o.balance + netCapex + refiCost + prepay;
    return { gap: uses - o.supportableProceeds, uses: uses, refiCost: refiCost, netCapex: netCapex, prepay: prepay, balance: o.balance };
  }

  /* Translate a required NOI lift into hotel operating terms — PER LEVER.
     ADR carries almost no incremental cost (~90% flow-through); occupancy carries
     variable cost (~65%); expense cuts are 100%. A blended rate frames the headline
     total-revenue figure. */
  function noiLiftTranslation(o) {
    var blended = isNum(o.flowThroughPct) ? o.flowThroughPct : 55;
    var adrFt = isNum(o.adrFlowPct) ? o.adrFlowPct : 90;
    var occFt = isNum(o.occFlowPct) ? o.occFlowPct : 65;
    if (!isNum(o.currentNOI) || !isNum(o.targetNOI)) return null;
    var lift = o.targetNOI - o.currentNOI;
    var out = { noiLift: lift, flowThroughPct: blended, adrFlowPct: adrFt, occFlowPct: occFt };
    if (lift <= 0) { out.alreadyMeets = true; return out; }
    out.annualRevenueIncrease = lift / pct(blended);
    out.monthlyRevenueIncrease = out.annualRevenueIncrease / 12;
    out.expenseReduction = lift;
    if (isNum(o.rooms) && o.rooms > 0) {
      var rn = o.rooms * 365;
      out.revparIncrease = out.annualRevenueIncrease / rn;
      if (isNum(o.occPct) && o.occPct > 0) {
        var roomsRevForADR = lift / pct(adrFt);       // ADR lever: high flow-through
        out.adrIncreaseAtCurrentOcc = roomsRevForADR / (rn * pct(o.occPct));
      }
      if (isNum(o.adr) && o.adr > 0) {
        var roomsRevForOcc = lift / pct(occFt);       // occupancy lever: lower flow-through
        out.occPointIncreaseAtCurrentADR = (roomsRevForOcc / (o.adr * rn)) * 100;
      }
    }
    return out;
  }

  function rateShock(o) {
    return (o.rates || []).map(function (rt) {
      var ads = annualDebtServiceFromLoan(o.balance, rt, o.amortYears, false);
      return { ratePct: rt, annualDebtService: ads, dscr: dscr(o.noi, ads) };
    });
  }

  function maturityRisk(m) {
    if (!isNum(m)) return { score: "Unknown", tone: "unknown" };
    if (m <= 6) return { score: "Critical", tone: "critical" };
    if (m <= 18) return { score: "High", tone: "warn" };
    if (m <= 36) return { score: "Medium", tone: "ok" };
    return { score: "Low", tone: "good" };
  }

  function capexPressure(c, noi) {
    if (!isNum(c) || c <= 0) return { score: "None/Low", tone: "good", ratio: 0 };
    if (!isNum(noi) || noi <= 0) return { score: "Unknown", tone: "unknown", ratio: null };
    var r = c / noi;
    if (r >= 1.5) return { score: "High", tone: "critical", ratio: r };
    if (r >= 0.5) return { score: "Medium", tone: "warn", ratio: r };
    return { score: "Low", tone: "ok", ratio: r };
  }

  function triage(m) {
    var issues = [];
    if (isNum(m.dscr) && m.dscr < 1.0) issues.push({ key: "operations", weight: 100,
      title: "Operating performance shortfall",
      detail: "Current NOI does not cover existing debt service (DSCR below 1.00x). This is first an operations/coverage problem before it is a refinance problem." });
    else if (isNum(m.dscr) && isNum(m.targetDSCR) && m.dscr < m.targetDSCR) issues.push({ key: "operations", weight: 60,
      title: "Thin debt-service coverage",
      detail: "The property covers debt service, but coverage is below a typical lender target. NOI improvement would strengthen the position." });
    if (isNum(m.refiGap) && m.refiGap > 0) issues.push({ key: "stack", weight: 75,
      title: "Refinance proceeds gap",
      detail: "At current NOI, supportable new debt — after capex and refinancing costs — appears lower than what’s needed to pay off the existing loan. This is a capital-stack / refinance-proceeds issue, not only a monthly-payment issue." });
    if (isNum(m.monthsToMaturity)) {
      if (m.monthsToMaturity <= 6) issues.push({ key: "maturity", weight: 95,
        title: "Imminent loan maturity",
        detail: "Maturity is within 6 months. Time, not just NOI, is the binding constraint. A lender conversation should be a priority." });
      else if (m.monthsToMaturity <= 18) issues.push({ key: "maturity", weight: 78,
        title: "Near-term loan maturity",
        detail: "Maturity is within ~18 months. There may be a window to improve NOI or arrange an extension before refinancing." });
    }
    if (isNum(m.capexRatio) && m.capexRatio >= 0.5) issues.push({ key: "capex", weight: m.capexRatio >= 1.5 ? 80 : 55,
      title: "Capital / PIP burden",
      detail: "Required capital spend is large relative to annual NOI. This competes with debt service and can erode refinance capacity." });
    if (m.floating || (isNum(m.currentRatePct) && m.currentRatePct >= 8)) issues.push({ key: "rate", weight: m.floating ? 66 : 50,
      title: "Interest-rate exposure",
      detail: m.floating ? "Floating-rate debt leaves the property exposed to further payment increases." : "The current rate is elevated; payment relief may require a rate buydown, modification, or refinance." });
    issues.sort(function (a, b) { return b.weight - a.weight; });
    return { issues: issues,
      primary: issues[0] || { key: "insufficient", title: "Not enough information",
        detail: "Provide more inputs (NOI, debt service, balance, maturity) to identify the primary issue." },
      combination: issues.length >= 3 };
  }

  /* ----------------------------------------------------------------------
     Distribution & unit-cost economics. Forward-only — these never alter the
     current diagnosis (current NOI already reflects actual commissions). They
     (a) derive per-lever flow-through from the property's own mix, and
     (b) turn distribution into levers the owner can pull.
     ---------------------------------------------------------------------- */
  function clampPct(x) { return Math.max(0, Math.min(100, x)); }

  /* Per-lever flow-through from actual distribution mix.
     blendedComm = OTA share × OTA commission (percentage points of room revenue).
     ADR lever: only commission rides on the incremental rate.
     Occupancy lever: commission + variable cost per occupied room (CPOR). */
  function flowThroughFromActuals(o) {
    if (!isNum(o.otaSharePct) || !isNum(o.otaCommissionPct)) return null;
    var blendedComm = (o.otaSharePct / 100) * o.otaCommissionPct;
    var adrFlow = clampPct(100 - blendedComm);
    var occFlow = null;
    if (isNum(o.cpor) && isNum(o.adr) && o.adr > 0) occFlow = clampPct(100 - blendedComm - (o.cpor / o.adr) * 100);
    return { blendedComm: blendedComm, adrFlow: adrFlow, occFlow: occFlow };
  }

  /* Shifting bookings OTA -> direct. Benefit is the SPREAD (OTA commission − direct
     acquisition cost), not the full commission — direct booking isn't free. */
  function channelShiftBenefit(o) {
    if (!isNum(o.points) || !isNum(o.roomRevenue) || !isNum(o.otaCommissionPct)) return null;
    var directCost = isNum(o.directCostPct) ? o.directCostPct : 0;
    var spread = o.otaCommissionPct - directCost;
    return (o.points / 100) * o.roomRevenue * (spread / 100);
  }

  /* Negotiating the OTA commission rate down by N points. Savings apply only to
     the OTA-channeled portion of room revenue. */
  function commissionCutBenefit(o) {
    if (!isNum(o.points) || !isNum(o.roomRevenue) || !isNum(o.otaSharePct)) return null;
    return (o.points / 100) * (o.otaSharePct / 100) * o.roomRevenue;
  }

  /* ----------------------------------------------------------------------
     Capital stack waterfall. Walks the stack from most senior to most junior
     and, at a given value, shows who is covered, impaired, or wiped — the
     "who gets paid first if things go sideways" view. Deterministic.
     layers: [{ name, kind, amount }] ordered senior -> junior (debt then pref).
     ---------------------------------------------------------------------- */
  function capitalStack(o) {
    var layers = (o.layers || []).filter(function (l) { return isNum(l.amount) && l.amount > 0; });
    var value = o.value, cum = 0, out = [];
    layers.forEach(function (l) {
      var lower = cum, upper = cum + l.amount;
      var recovery = null, status = "unknown", cushion = null, cushionPct = null, attachLTV = null, detachLTV = null;
      if (isNum(value)) {
        recovery = Math.max(0, Math.min(value - lower, l.amount));
        status = recovery >= l.amount - 1e-6 ? "covered" : recovery <= 1e-6 ? "wiped" : "impaired";
        cushion = value - upper;                       // $ of value above this layer's top
        cushionPct = value > 0 ? (cushion / value) * 100 : null;
      }
      if (isNum(value) && value > 0) { attachLTV = lower / value * 100; detachLTV = upper / value * 100; }
      out.push({ name: l.name, kind: l.kind, amount: l.amount, lower: lower, upper: upper,
        recovery: recovery, shortfall: isNum(recovery) ? (l.amount - recovery) : null,
        status: status, cushion: cushion, cushionPct: cushionPct, attachLTV: attachLTV, detachLTV: detachLTV });
      cum = upper;
    });
    var totalStack = cum;
    var commonEquity = isNum(o.commonEquity) ? o.commonEquity : (isNum(value) ? Math.max(0, value - totalStack) : null);
    var sponsorStatus = commonEquity == null ? "unknown" : (commonEquity > 0 ? "in the money" : "wiped");
    // how far value can fall before common equity is wiped (i.e., before debt+pref exceed value)
    var equityCushion = isNum(value) ? value - totalStack : null;
    var equityCushionPct = isNum(value) && value > 0 ? (equityCushion / value) * 100 : null;
    var leverageLTV = isNum(value) && value > 0 ? totalStack / value * 100 : null;
    return { layers: out, totalStack: totalStack, commonEquity: commonEquity, value: value,
      leverageLTVpct: leverageLTV, sponsorStatus: sponsorStatus,
      equityCushion: equityCushion, equityCushionPct: equityCushionPct };
  }

  /* Confidence — based on DATA COMPLETENESS, not good/bad results. */
  function confidence(fields) {
    var totW = 0, score = 0, sw = { known: 1, estimated: 0.6, range: 0.6, unknown: 0, skipped: 0 };
    fields.forEach(function (f) {
      var w = isNum(f.weight) ? f.weight : 1; totW += w;
      score += w * (sw[f.status] != null ? sw[f.status] : 0);
    });
    if (totW === 0) return { pct: 0, label: "Low", tone: "warn" };
    var p = score / totW;
    return { pct: Math.round(p * 100), label: p >= 0.8 ? "High" : p >= 0.5 ? "Medium" : "Low", tone: p >= 0.8 ? "good" : p >= 0.5 ? "ok" : "warn" };
  }

  var ENGINE = {
    loanConstant: loanConstant, annualDebtServiceFromLoan: annualDebtServiceFromLoan,
    dscr: dscr, dscrBand: dscrBand, cashAfterDebt: cashAfterDebt,
    requiredNOI: requiredNOI, breakEvenNOI: breakEvenNOI, debtYield: debtYield,
    supportableLoan: supportableLoan, requiredNOIToRefinance: requiredNOIToRefinance,
    refinanceGap: refinanceGap, noiLiftTranslation: noiLiftTranslation, rateShock: rateShock,
    maturityRisk: maturityRisk, capexPressure: capexPressure, triage: triage,
    flowThroughFromActuals: flowThroughFromActuals, channelShiftBenefit: channelShiftBenefit,
    commissionCutBenefit: commissionCutBenefit, capitalStack: capitalStack,
    confidence: confidence, round: round
  };
  if (typeof module !== "undefined" && module.exports) module.exports = ENGINE;
  global.HCSD = ENGINE;
})(typeof window !== "undefined" ? window : globalThis);
