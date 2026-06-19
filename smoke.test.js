const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

// Use the single-file standalone build so jsdom needs no external fetches.
const html = fs.readFileSync(path.join(__dirname, "Hotel-Capital-Stack-Diagnostic.html"), "utf8");

const errors = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.alert = () => {};
    window.URL.createObjectURL = () => "blob:fake";
    window.print = () => {};
    window.onerror = (m) => errors.push(String(m));
  }
});
const { window } = dom;
const { document } = window;

let failures = 0;
function pass(n){ console.log("  PASS " + n); }
function fail(n,d){ console.log("  FAIL " + n + (d?("  -> "+d):"")); failures++; }

function setField(key, value){
  const f = document.querySelector('.field[data-key="'+key+'"]');
  if(!f) return false;
  const input = f.querySelector('.inputHost input')
             || f.querySelector('input[type=text],input[type=date]')
             || f.querySelector('select:not(.method)');
  if(!input) return false;
  input.value = value;
  input.dispatchEvent(new window.Event(input.tagName==="SELECT"?"change":"input"));
  return true;
}
function lastNavButton(){
  const nav = document.querySelector(".navbtns");
  if(!nav) return null;
  const btns = nav.querySelectorAll("button");
  return btns[btns.length-1];
}
// Try to fill every known field if its section is currently visible.
function fillVisible(){
  const data = {
    rooms:"120", ptype:"Self-check-in / no front desk",
    noi:"1500000", totalRevenue:"6000000", noiBasis:"Yes — fee and reserve removed", occ:"72", adr:"165",
    marketPosition:"Below comp set (room to grow)", noiTrend:"Flat",
    loanBalance:"18000000", rate:"7.25", floating:"Fixed", amort:"25", maturity:"2027-03-01",
    value:"20000000", prefBalance:"3000000", lenderType:"CMBS", recourse:"Non-recourse",
    guarantee:"Only ‘bad-boy’ carve-outs", cashMgmt:"Yes",
    pip:"2500000", liquidity:"1000000",
    otaShare:"60", otaCommission:"20", directCost:"7", cpor:"35",
    targetDSCR:"1.30", refiRate:"7.5"
  };
  Object.keys(data).forEach(k=>setField(k, data[k]));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  try {
    await sleep(400); // let initial scripts settle
    const hero = document.querySelector(".hero h1");
    hero && /support its debt/i.test(hero.textContent) ? pass("landing hero renders") : fail("landing hero renders");

    // --- Quick Check path ---
    document.getElementById("startQuick").click();
    const quickHead = Array.from(document.querySelectorAll(".section-h h2")).some(h=>/quick check/i.test(h.textContent));
    quickHead ? pass("quick check screen renders") : fail("quick check screen renders");
    setField("rooms","120"); setField("noi","1500000"); setField("monthlyPayment","130000"); setField("maturity","2027-03-01");
    await sleep(240); // allow the debounced live refresh to repaint quickOut
    const qOut = document.getElementById("quickOut");
    const qHasCash = qOut && /\/yr/.test(qOut.textContent);
    qHasCash ? pass("quick check shows cash-after-debt headline") : fail("quick check headline", qOut?qOut.textContent.slice(0,80):"none");

    // --- Full flow (beginner): start fresh ---
    document.getElementById("privacyBtn"); // noop ref
    // Go back home then start guided
    // Beginner has NO assumptions step now.
    // Reset by clicking the Quick "Home" then Guide me on landing:
    const homeBtn = document.querySelector(".navbtns .btn.ghost");
    if(homeBtn){ homeBtn.click(); }
    document.getElementById("startGuide").click();

    let banner=null, guard=0;
    while(guard++ < 8){
      fillVisible();
      banner = document.querySelector(".banner h2");
      if(banner) break;
      const nb = lastNavButton();
      if(!nb) break;
      nb.click();
    }
    banner ? pass("results reached in beginner flow: "+banner.textContent) : fail("results reached", "looped "+guard);

    // Beginner: property, performance, debt, structure, capital, distribution, results = 7 (no assumptions step)
    const stepCount = document.querySelectorAll(".stepper .s").length;
    stepCount===7 ? pass("beginner flow has 7 steps (incl. structure & distribution, no assumptions)") : fail("beginner step count", stepCount);

    // Diagnostic scan panel present
    const scanPanel = Array.from(document.querySelectorAll(".section-h h2")).some(h=>/Diagnostic scan/i.test(h.textContent));
    scanPanel ? pass("diagnostic scan panel present") : fail("diagnostic scan panel");

    // Capital stack waterfall + who-gets-paid-first
    const stackCard = Array.from(document.querySelectorAll(".callout")).some(c=>/who gets paid first/i.test(c.textContent));
    stackCard ? pass("capital stack waterfall / cushion present") : fail("capital stack waterfall");

    // Exposure read present
    const expRead = Array.from(document.querySelectorAll("h3")).some(h=>/on the hook/i.test(h.textContent));
    expRead ? pass("personal exposure read present") : fail("exposure read");

    // Loan-type tactics present (CMBS)
    const loanType = Array.from(document.querySelectorAll("h3")).some(h=>/loan type: CMBS/i.test(h.textContent));
    loanType ? pass("loan-type (CMBS) good/risk/tactics present") : fail("loan-type card");

    // self-check-in property type: margin reasonableness callout + type-based flow-through
    const marginCheck = Array.from(document.querySelectorAll(".callout")).some(c=>/NOI margin check/i.test(c.textContent));
    marginCheck ? pass("NOI margin reasonableness check fires for self-check-in type") : fail("margin check callout");
    const flowAdj = /Flow-through defaults adjusted/i.test(document.body.textContent);
    flowAdj ? pass("type-based flow-through defaults applied (self-check-in)") : fail("type-based flow-through note");

    // Cash-after-debt metric present (plain dollars, /yr)
    const metricVals = Array.from(document.querySelectorAll(".metric .val")).map(v=>v.textContent);
    metricVals.some(v=>/\/yr/.test(v)) ? pass("cash-after-debt metric shown: "+metricVals[0]) : fail("cash metric", metricVals.join("|"));
    metricVals.some(v=>/x$/.test(v)) ? pass("DSCR metric computed") : fail("DSCR metric", metricVals.join("|"));

    // Sources & uses breakdown exists
    const sNu = Array.from(document.querySelectorAll(".acc summary")).some(s=>/sources & uses/i.test(s.textContent));
    sNu ? pass("refi gap sources & uses breakdown present") : fail("sources & uses present");

    // Ops plausibility verdict present
    const verdict = Array.from(document.querySelectorAll(".callout")).some(c=>/Verdict:/i.test(c.textContent));
    verdict ? pass("operations plausibility verdict present") : fail("ops verdict present");

    // Options table
    const optRows = document.querySelectorAll(".card table tr").length;
    optRows > 1 ? pass("capital stack options table renders ("+optRows+" rows)") : fail("options table");

    // Scenario workbench (drive a slider for synchronous recalc)
    const slider = document.querySelector(".slider input[type=range]");
    if(slider){ slider.value="10"; slider.dispatchEvent(new window.Event("input")); }
    const scOut = document.getElementById("scenarioOut");
    scOut && scOut.children.length>=3 ? pass("scenario workbench renders ("+scOut.children.length+" cells)") : fail("scenario workbench", scOut?scOut.children.length:"none");

    // Memo generation
    try { Array.from(document.querySelectorAll("button")).find(b=>/Download owner memo/i.test(b.textContent)).click(); pass("memo generation does not throw"); }
    catch(e){ fail("memo generation", e.message); }

    // Distribution lever row appears in the ops-fix table
    const distRow = Array.from(document.querySelectorAll("td")).some(td=>/OTA→direct/.test(td.textContent));
    distRow ? pass("distribution lever row shown in ops-fix table") : fail("distribution lever row");

    // Distribution sliders present in workbench
    const sliderLabels = Array.from(document.querySelectorAll(".slider label")).map(l=>l.textContent).join("|");
    /Shift OTA/.test(sliderLabels)&&/Cut OTA commission/.test(sliderLabels) ? pass("distribution sliders present") : fail("distribution sliders", sliderLabels);

    // Expert mode collapses to a single dense input page + results (2 steps)
    document.querySelector('#modeswitch button[data-mode="expert"]').click();
    const expSteps = document.querySelectorAll(".stepper .s").length;
    expSteps===2 ? pass("expert flow is one dense input page + results (2 steps)") : fail("expert step count", expSteps);
    // expert uses terse labels (e.g., "NOI ($/yr)") and still shows help text
    const expLabels = Array.from(document.querySelectorAll(".field label")).map(l=>l.textContent);
    expLabels.includes("NOI ($/yr)") ? pass("expert shows terse labels") : fail("expert terse labels", expLabels.slice(0,6).join("|"));
    const helpKept = document.querySelectorAll(".field .help").length > 0;
    helpKept ? pass("help text kept in expert mode") : fail("help kept in expert");

    // Privacy modal
    document.getElementById("privacyBtn").click();
    document.querySelector(".modal") ? pass("privacy modal opens") : fail("privacy modal");

    errors.length===0 ? pass("no uncaught JS errors") : fail("no uncaught JS errors", errors.join(" | "));

    console.log("\n" + (failures===0 ? "ALL SMOKE TESTS PASSED" : failures+" SMOKE TEST(S) FAILED"));
    process.exit(failures===0?0:1);
  } catch(e){
    console.log("SMOKE HARNESS ERROR: " + e.stack);
    process.exit(1);
  }
})();
