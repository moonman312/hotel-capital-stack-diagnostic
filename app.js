/* ============================================================================
   Hotel Capital Stack Diagnostic — App layer (MHS)
   Vanilla JS, no dependencies. Runs fully client-side / offline.
   Modes: quick (30-second check) · beginner ("Guide me") · expert.
   Privacy: state in memory; opt-in save to this browser's localStorage only.
   ============================================================================ */
(function () {
"use strict";
var E = window.HCSD;
var app = document.getElementById("app");
var SAVE_KEY = "mhs_hcsd_v1";

/* ---------- default assumptions (visible, never hidden) ---------- */
var DEF = {
  targetDSCRs: [1.25, 1.35, 1.45], targetDSCRmid: 1.25,
  refiRates: [7.0, 7.5, 8.0], refiRateMid: 7.5,
  refiAmort: 25, minDebtYield: 9.5, maxLTV: 65,
  flowThrough: 55, adrFlow: 90, occFlow: 65, refiCostPct: 1.5, directCost: 7
};

/* ---------- state ---------- */
var S = { mode: "beginner", anon: false, step: 0, propertyName: "", f: {} };

/* ---------- field metadata ----------
   sensitive fields support: exact | estimate | range | idk | prefer
   tier: expertOnly => only shown in expert mode.
   showIf: optional predicate for conditional display. */
var FIELDS = {
  // property
  rooms:        {label:"How many guest rooms does the property have?", help:"Total keys.", kind:"num", sensitive:false, section:"property", weight:1},
  ptype:        {label:"Property type", kind:"select", section:"property", opts:["Select-service","Full-service","Resort","Boutique","Extended-stay","Other"], sensitive:false, weight:0.5},
  branded:      {label:"Branded or independent?", kind:"select", section:"property", opts:["Branded (flag)","Independent"], sensitive:false, weight:0.5},
  mgmt:         {label:"Who operates it?", kind:"select", section:"property", opts:["Owner-operated","Third-party managed"], sensitive:false, weight:0.5},
  objective:    {label:"Current ownership objective", kind:"select", section:"property", opts:["Hold long-term","Refinance soon","Sell within 1–2 yrs","Stabilize / fix performance","Undecided"], sensitive:false, weight:0.5},
  // operating
  noi:          {label:"After normal operating expenses — but before debt payments and major one-time renovations — roughly how much cash does the property generate per year?", help:"This is often called NOI. If you don't know it, estimate it, or estimate it from revenue and margin below.", kind:"money", sensitive:true, section:"operating", weight:3},
  noiBasis:     {label:"Does that number already subtract a management fee and an FF&E reserve?", help:"This is the #1 source of error. Lenders expect NOI after a management fee (~3%) and a reserve (~4%). If yours doesn't, your NOI is likely overstated.", kind:"select", section:"operating", opts:["Yes — fee and reserve removed","No / not sure"], sensitive:false, weight:0.5, alwaysHelp:true},
  totalRevenue: {label:"Roughly, total annual revenue (all departments)?", help:"Rooms + F&B + other, before expenses. Only needed if you estimate NOI from a margin.", kind:"money", sensitive:true, section:"operating", weight:1},
  margin:       {label:"If you don't know NOI: roughly what % of revenue is left after operating expenses?", help:"Typical hotel NOI margins run ~20–40%. Used only if NOI is left blank.", kind:"pct", sensitive:true, section:"operating", weight:0.5},
  occ:          {label:"Average occupancy (%)", help:"Rooms sold ÷ rooms available.", kind:"pct", sensitive:true, section:"operating", weight:1},
  adr:          {label:"Average daily rate (ADR, $)", help:"Average room rate actually achieved.", kind:"money", sensitive:true, section:"operating", weight:1},
  noiTrend:     {label:"Over the last 1–2 years, NOI has been:", kind:"select", section:"operating", opts:["Growing","Flat","Declining","Not sure"], sensitive:false, weight:0.5},
  marketPosition:{label:"Compared with your direct competitors, your RevPAR is:", help:"Be honest — this tells us whether there’s room to raise rate/occupancy or whether you’re already maxed out.", kind:"select", section:"operating", opts:["Below comp set (room to grow)","About at comp set","Above comp set (limited headroom)","Not sure"], sensitive:false, weight:0.5},
  // debt
  loanBalance:  {label:"Current loan balance", help:"From your latest lender statement.", kind:"money", sensitive:true, section:"debt", weight:2.5},
  monthlyPayment:{label:"Monthly loan payment ($)", help:"Total monthly debt payment (principal + interest).", kind:"money", sensitive:true, section:"debt", weight:1.5},
  rate:         {label:"Interest rate (%)", help:"From your note or monthly statement.", kind:"pct", sensitive:true, section:"debt", weight:1.5},
  floating:     {label:"Fixed or floating rate?", kind:"select", section:"debt", opts:["Fixed","Floating","Not sure"], sensitive:false, weight:1},
  rateCap:      {label:"If floating: do you have a rate cap in place?", kind:"select", section:"debt", opts:["Yes","No","Not sure"], sensitive:false, weight:0.4, expertOnly:true, showIf:function(){return get("floating").value==="Floating";}},
  amort:        {label:"Amortization (years)", help:"How the loan is scheduled to pay down, e.g. 25 or 30. Interest-only = 0.", kind:"num", sensitive:true, section:"debt", weight:1},
  interestOnly: {label:"Is the loan currently interest-only?", kind:"select", section:"debt", opts:["No","Yes"], sensitive:false, weight:0.5},
  maturity:     {label:"Loan maturity date", help:"When the loan comes due / balloons. From your loan agreement.", kind:"date", sensitive:true, section:"debt", weight:2},
  prepayPenalty:{label:"Prepayment penalty / defeasance cost (if any)", help:"Common on CMBS and some fixed-rate loans. Skip if none or unknown.", kind:"money", sensitive:true, section:"debt", weight:0.5, expertOnly:true},
  // capex / resources
  pip:          {label:"Required PIP / brand renovation cost", help:"From a brand letter or franchise agreement, if any.", kind:"money", sensitive:true, section:"capex", weight:1},
  deferred:     {label:"Deferred maintenance / known repairs", kind:"money", sensitive:true, section:"capex", weight:0.8},
  plannedReno:  {label:"Planned renovations (discretionary)", kind:"money", sensitive:true, section:"capex", weight:0.5},
  capexReserve: {label:"Capex reserve currently available", kind:"money", sensitive:true, section:"capex", weight:0.8},
  capexTiming:  {label:"Within how many months must the capital be spent?", kind:"num", sensitive:true, section:"capex", weight:0.5},
  liquidity:    {label:"Cash you could realistically inject if needed (equity / paydown)", help:"This decides which fixes are actually available to you. Rough range is fine.", kind:"money", sensitive:true, section:"capex", weight:1, alwaysHelp:true},
  // distribution & unit costs (forward-only — power the fix simulation, never the current diagnosis)
  otaShare:     {label:"What share of room revenue comes through OTAs (Expedia, Booking, etc.)?", help:"Rough % is fine. The rest is direct, GDS, or other.", kind:"pct", sensitive:true, section:"distribution", weight:0.6, alwaysHelp:true},
  otaCommission:{label:"Average OTA commission rate (%)", help:"Typically 15–25%.", kind:"pct", sensitive:true, section:"distribution", weight:0.6, alwaysHelp:true},
  directCost:   {label:"Cost to drive a direct booking (% of room revenue)", help:"Booking engine + metasearch + paid search + loyalty. Often ~5–10%. Leave blank to use 7%.", kind:"pct", sensitive:true, section:"distribution", weight:0.4, alwaysHelp:true},
  cpor:         {label:"Variable cost per occupied room ($)", help:"Housekeeping, laundry, amenities, supplies for one room night. Often $20–45. Lets us model occupancy honestly.", kind:"money", sensitive:true, section:"distribution", weight:0.4, alwaysHelp:true},
  // refi assumptions (expert step)
  targetDSCR:   {label:"Lender target DSCR", help:"Coverage a lender will require. If unknown we model 1.25 / 1.35 / 1.45.", kind:"num", sensitive:true, section:"assumptions", weight:1},
  refiRate:     {label:"Assumed refinance rate (%)", help:"If unknown we model 7.0 / 7.5 / 8.0%.", kind:"pct", sensitive:true, section:"assumptions", weight:1},
  refiAmort:    {label:"Assumed refinance amortization (years)", kind:"num", sensitive:true, section:"assumptions", weight:0.5},
  minDebtYield: {label:"Minimum debt yield (%)", help:"NOI ÷ loan. Common floor ~9–10%.", kind:"pct", sensitive:true, section:"assumptions", weight:0.5},
  maxLTV:       {label:"Maximum LTV (%)", kind:"pct", sensitive:true, section:"assumptions", weight:0.5},
  // capital stack & risk (guided; all optional, "not sure" allowed)
  value:        {label:"What is the property worth today (rough estimate)?", help:"A ballpark is fine. If you don’t know, enter a market cap rate below and we’ll estimate it.", kind:"money", sensitive:true, section:"stack", weight:0.6, alwaysHelp:true},
  capRate:      {label:"…or a market cap rate (%) to estimate value", help:"Value ≈ NOI ÷ cap rate. Often easier to know than a dollar value.", kind:"pct", sensitive:true, section:"stack", weight:0.4, alwaysHelp:true},
  mezzBalance:  {label:"Is there a mezzanine or second loan? Balance (leave blank if none)", help:"A junior loan that sits behind your main mortgage but ahead of your equity.", kind:"money", sensitive:true, section:"stack", weight:0.5, alwaysHelp:true},
  prefBalance:  {label:"Is there preferred equity? Balance (leave blank if none)", help:"Outside investors who get paid back — with their preferred return — before you do.", kind:"money", sensitive:true, section:"stack", weight:0.5, alwaysHelp:true},
  mezzRate:     {label:"Mezzanine / second-loan rate (%)", kind:"pct", sensitive:true, section:"stack", weight:0.2, expertOnly:true},
  prefRate:     {label:"Preferred return / accrual (%)", kind:"pct", sensitive:true, section:"stack", weight:0.2, expertOnly:true},
  lenderType:   {label:"What kind of lender is your main loan from?", help:"Each type behaves very differently in a workout — pick the closest.", kind:"select", section:"stack", opts:["Bank / credit union","CMBS","Debt fund / bridge","SBA","Life company","Other / not sure"], sensitive:false, weight:0.5, alwaysHelp:true},
  recourse:     {label:"Is the loan recourse or non-recourse?", help:"Recourse = the lender can pursue you personally / other assets if the property doesn’t cover the debt. Non-recourse = generally limited to the property (with exceptions). Not sure is fine.", kind:"select", section:"stack", opts:["Recourse","Non-recourse","Not sure"], sensitive:false, weight:0.6, alwaysHelp:true},
  guarantee:    {label:"Did you or a partner sign a personal guarantee?", help:"Full = you’re on the hook for the whole loan. Partial/limited = capped or burns off. ‘Bad-boy’ carve-outs = normally non-recourse, but becomes personal if certain bad acts occur (bankruptcy filing, fraud, unapproved transfer).", kind:"select", section:"stack", opts:["No personal guarantee","Yes — full guarantee","Yes — partial / limited","Only ‘bad-boy’ carve-outs","Not sure"], sensitive:false, weight:0.5, alwaysHelp:true},
  guarantor:    {label:"Who carries that exposure?", kind:"select", section:"stack", opts:["Just me","Me and partners","An entity only (no individuals)","Not sure"], sensitive:false, weight:0.3},
  otherGuarantees:{label:"Any completion or environmental guarantee/indemnity?", help:"Separate promises that usually stay personal even on non-recourse loans.", kind:"select", section:"stack", opts:["No / not sure","Yes"], sensitive:false, weight:0.2},
  cashMgmt:     {label:"Is there a lockbox or cash-management arrangement?", help:"Where revenue flows into a lender-controlled account. Common on CMBS; can ‘spring’ a cash trap if performance dips.", kind:"select", section:"stack", opts:["No / not sure","Yes"], sensitive:false, weight:0.2},
  covenants:    {label:"Does the loan have financial covenants (min DSCR or debt yield)?", kind:"select", section:"stack", opts:["No / not sure","Yes"], sensitive:false, weight:0.2}
};

/* ---------- step model ---------- */
var STEP = {
  property:    {key:"property",    title:"Property",     sub:"A quick profile so the analysis fits your hotel."},
  operating:   {key:"operating",  title:"Performance",  sub:"How the hotel earns. NOI is the single most important number."},
  debt:        {key:"debt",       title:"Debt",         sub:"Your current loan. Enter what you know; skip the rest."},
  stack:       {key:"stack",      title:"Structure & risk",sub:"Your loan type, the rest of the capital stack, and who’s exposed. All optional — “not sure” is fine; this is how we spot structural and personal-liability problems you might not know to look for."},
  capex:       {key:"capex",      title:"Capital & cash",sub:"Capital needs, reserves, and what you could inject if needed."},
  distribution:{key:"distribution",title:"Distribution",sub:"How you sell rooms and what each room costs. All optional — this powers the fix simulation."},
  assumptions: {key:"assumptions",title:"Assumptions",  sub:"Refinance assumptions. Leave blank to use conservative ranges."},
  results:     {key:"results",    title:"Results",      sub:""}
};
function getSteps(){
  var s=[STEP.property, STEP.operating, STEP.debt, STEP.stack, STEP.capex, STEP.distribution];
  if(S.mode==="expert") s.push(STEP.assumptions);
  s.push(STEP.results);
  return s;
}

/* ---------- helpers ---------- */
function el(html){var d=document.createElement("div");d.innerHTML=html.trim();return d.firstChild;}
function fmtMoney(x){if(x==null||isNaN(x))return "—";var n=Math.round(x);return (n<0?"-$":"$")+Math.abs(n).toLocaleString("en-US");}
function fmtPct(x,d){if(x==null||isNaN(x))return "—";var f=Math.pow(10,d==null?1:d);return (Math.round(x*f)/f)+"%";}
function fmtX(x){if(x==null||isNaN(x))return "—";return (Math.round(x*100)/100).toFixed(2)+"x";}
function get(key){return S.f[key]||{method:"exact",value:""};}
function valOf(key){var x=get(key);if(x.method==="range"){var lo=parseFloat(x.low),hi=parseFloat(x.high);if(isFinite(lo)&&isFinite(hi))return (lo+hi)/2;if(isFinite(lo))return lo;if(isFinite(hi))return hi;return null;}if(x.method==="idk"||x.method==="prefer")return null;var v=parseFloat(x.value);return isFinite(v)?v:null;}
function rawOf(key){return get(key).value;}
/* status reflects what's actually usable: exact/estimate with no value => unknown */
function statusOf(key){
  var x=get(key), m=x.method;
  if(m==="prefer")return "skipped";
  if(m==="idk")return "unknown";
  if(m==="range"){var lo=parseFloat(x.low),hi=parseFloat(x.high);return (isFinite(lo)||isFinite(hi))?"range":"unknown";}
  return valOf(key)==null ? "unknown" : (m==="estimate"?"estimated":"known");
}
function monthsTo(dateStr){if(!dateStr)return null;var d=new Date(dateStr);if(isNaN(d))return null;var now=new Date();return (d.getFullYear()-now.getFullYear())*12+(d.getMonth()-now.getMonth());}

/* ---------- field component ---------- */
function methodOptions(){return [{v:"exact",t:"Exact"},{v:"estimate",t:"Estimate"},{v:"range",t:"Range"},{v:"idk",t:"I don't know"},{v:"prefer",t:"Prefer not to say"}];}
function renderField(key){
  var meta=FIELDS[key], cur=get(key);
  var wrap=el('<div class="field" data-key="'+key+'"></div>');
  var lab=document.createElement("label");lab.textContent=meta.label;wrap.appendChild(lab);
  if(meta.help && (S.mode==="beginner"||S.mode==="quick"||meta.alwaysHelp)){var h=el('<div class="help"></div>');h.textContent=meta.help;wrap.appendChild(h);}
  var row=el('<div class="row"></div>');

  if(meta.kind==="select"){
    var sel=document.createElement("select");
    sel.appendChild(el('<option value="">—</option>'));
    meta.opts.forEach(function(o){var op=document.createElement("option");op.value=o;op.textContent=o;if(cur.value===o)op.selected=true;sel.appendChild(op);});
    sel.onchange=function(){S.f[key]={method:"exact",value:sel.value};maybeLiveRefresh();};
    row.appendChild(sel);wrap.appendChild(row);return wrap;
  }
  if(meta.sensitive){
    var msel=document.createElement("select");msel.className="method";
    methodOptions().forEach(function(o){var op=document.createElement("option");op.value=o.v;op.textContent=o.t;if(cur.method===o.v)op.selected=true;msel.appendChild(op);});
    row.appendChild(msel);
    var inputHost=el('<div class="inputHost"></div>');row.appendChild(inputHost);
    function ensure(){if(!S.f[key])S.f[key]={method:msel.value||"exact",value:"",low:"",high:""};return S.f[key];}
    msel.onchange=function(){var v=msel.value;S.f[key]={method:v,value:v==="range"?"":cur.value,low:cur.low,high:cur.high};paintInputs();maybeLiveRefresh();};
    function makeInput(ph,val,onin){var t=meta.kind==="date"?"date":"text";var inp=document.createElement("input");inp.type=t;inp.placeholder=ph||"";if(val!=null)inp.value=val;inp.oninput=onin;return inp;}
    function paintInputs(){
      inputHost.innerHTML="";var c=get(key);
      if(c.method==="idk"){inputHost.appendChild(el('<span class="pill"><span class="dot unknown"></span>We’ll note this is unknown</span>'));return;}
      if(c.method==="prefer"){inputHost.appendChild(el('<span class="pill"><span class="dot unknown"></span>Kept private</span>'));return;}
      if(c.method==="range"){
        var rng=el('<div class="rangeInputs"></div>');
        var lo=makeInput("low",c.low,function(){ensure().low=lo.value;maybeLiveRefresh();});
        var hi=makeInput("high",c.high,function(){ensure().high=hi.value;maybeLiveRefresh();});
        rng.appendChild(lo);rng.appendChild(el('<span class="muted small">to</span>'));rng.appendChild(hi);
        inputHost.appendChild(rng);return;
      }
      var ph=meta.kind==="money"?"$ amount":meta.kind==="pct"?"%":"";
      var inp=makeInput(ph,c.value,function(){ensure().value=inp.value;maybeLiveRefresh();});
      inputHost.appendChild(inp);
    }
    wrap.appendChild(row);paintInputs();return wrap;
  }
  var inp2=document.createElement("input");inp2.type=meta.kind==="date"?"date":"text";inp2.value=cur.value||"";
  inp2.placeholder=meta.kind==="money"?"$ amount":meta.kind==="pct"?"%":"";
  inp2.oninput=function(){S.f[key]={method:"exact",value:inp2.value};maybeLiveRefresh();};
  row.appendChild(inp2);wrap.appendChild(row);return wrap;
}
var _liveTimer=null;
function maybeLiveRefresh(){
  // refresh only the small live readouts, debounced, without rebuilding inputs
  if(_liveTimer)clearTimeout(_liveTimer);
  _liveTimer=setTimeout(function(){
    var ro=document.getElementById("liveReadout");if(ro)ro.replaceWith(liveReadout());
    var qo=document.getElementById("quickOut");if(qo)qo.replaceWith(quickOut());
    var pn=document.getElementById("progressNote");if(pn)pn.replaceWith(progressNote());
  },180);
}

/* ---------- topbar ---------- */
function syncTopbar(){
  document.querySelectorAll("#modeswitch button").forEach(function(b){b.classList.toggle("active",b.dataset.mode===S.mode);});
  document.getElementById("privacyLabel").textContent = S.anon ? "Anonymous · session-only" : "Session-only · nothing leaves your browser";
}

/* ---------- landing ---------- */
function renderLanding(){
  app.innerHTML="";
  var hero=el(
   '<div class="hero">'+
    '<h1>Can your hotel actually support its debt?</h1>'+
    '<p>A confidential diagnostic that tells you whether your debt-service pressure is an <strong>operations</strong> problem, a <strong>refinance</strong> problem, or a <strong>capital-stack</strong> problem — and which levers would actually fix it.</p>'+
    '<div class="ctas">'+
      '<button class="btn primary" id="startQuick">30-second quick check</button>'+
      '<button class="btn ghost" id="startGuide" style="color:#fff;border-color:rgba(255,255,255,.3)">Guide me</button>'+
      '<button class="btn ghost" id="startExpert" style="color:#fff;border-color:rgba(255,255,255,.3)">I have the numbers</button>'+
    '</div>'+
    '<div class="trust">By Modern Hospitality Solutions · Skip any sensitive question · No property name required · Nothing leaves your browser.</div>'+
   '</div>');
  app.appendChild(hero);
  var pick=el('<div class="cards3"></div>');
  [["Just want the headline","“Am I covering my debt — yes or no?”","Four numbers, 30 seconds. Cash after your loan payment, your DSCR, and whether refinance risk is looming.","quick"],
   ["Walk me through it","“I’m not a finance person.”","Plain-English questions, “I don’t know” allowed everywhere, and a clear list of what to do next.","beginner"],
   ["I have the numbers","“What’s the refi gap and required NOI?”","Full model control: DSCR, debt yield, loan constant, supportable debt, sensitivity, exportable memo.","expert"]
  ].forEach(function(c){var card=el('<div class="usercard"><div class="k">'+c[0]+'</div><h4>'+c[1]+'</h4><p>'+c[2]+'</p></div>');card.onclick=function(){S.mode=c[3];S.step=1;render();};pick.appendChild(card);});
  app.appendChild(el('<div style="height:8px"></div>'));app.appendChild(pick);
  app.appendChild(disclaimerCard());
  document.getElementById("startQuick").onclick=function(){S.mode="quick";S.step=1;render();};
  document.getElementById("startGuide").onclick=function(){S.mode="beginner";S.step=1;render();};
  document.getElementById("startExpert").onclick=function(){S.mode="expert";S.step=1;render();};
  syncTopbar();
}
function disclaimerCard(){
  return el('<div class="card no-print" style="margin-top:18px"><p class="muted small" style="margin:0">'+
    '<strong>This is a diagnostic and planning tool — not financial, legal, lending, or investment advice, and not a lending commitment.</strong> '+
    'Results are based on the information you provide and on clearly labeled assumptions. Final decisions should involve your lender, CPA, attorney, broker, or capital advisor as appropriate.</p></div>');
}

/* ---------- QUICK CHECK ---------- */
function renderQuick(){
  app.innerHTML="";
  var card=el('<div class="card"></div>');
  card.appendChild(el('<div class="section-h"><h2>30-second quick check</h2></div>'));
  card.appendChild(el('<p class="section-sub">Four numbers. Estimates and ranges are fine — you can refine later.</p>'));
  ["rooms","noi","monthlyPayment","maturity"].forEach(function(k){card.appendChild(renderField(k));});
  card.appendChild(el('<p class="small muted">Don’t know NOI? You can switch to “Guide me” and estimate it from revenue and margin.</p>'));
  card.appendChild(quickOut());
  app.appendChild(card);
  var nav=el('<div class="navbtns"></div>');
  var back=el('<button class="btn ghost">← Home</button>');back.onclick=function(){S.step=0;render();};
  var full=el('<button class="btn primary">Get the full diagnosis →</button>');
  full.onclick=function(){S.mode="beginner";S.step=1;render();};
  nav.appendChild(back);nav.appendChild(full);app.appendChild(nav);
  app.appendChild(disclaimerCard());
  syncTopbar();
}
function quickOut(){
  var m=compute();
  var box=el('<div class="card" id="quickOut" style="margin-top:14px;background:#f7fbfb"></div>');
  if(m.cashAfterDebt==null && m.dscr==null){
    box.innerHTML='<p class="muted" style="margin:0">Enter your annual NOI and monthly payment to see the headline.</p>';return box;
  }
  var band=m.dscr!=null?E.dscrBand(m.dscr):{tone:"unknown",label:"—"};
  var cashTone=m.cashAfterDebt==null?"":(m.cashAfterDebt>=0?"good":"critical");
  var mat=m.months!=null?(m.maturityRisk.score+" ("+m.months+" mo to maturity)"):"add maturity date";
  box.innerHTML=
    '<div class="metrics">'+
      '<div class="metric"><div class="lab">Cash after your loan payment</div><div class="val" style="color:var(--'+(cashTone||'navy')+')">'+fmtMoney(m.cashAfterDebt)+'/yr</div><div class="sub muted">NOI minus annual debt service</div></div>'+
      '<div class="metric"><div class="lab">Coverage (DSCR)</div><div class="val">'+fmtX(m.dscr)+'</div><div class="sub" style="color:var(--'+band.tone+')">'+(m.dscr!=null?band.label.split("—").slice(-1)[0]:"add numbers")+'</div></div>'+
      '<div class="metric"><div class="lab">Maturity</div><div class="val" style="font-size:18px">'+m.maturityRisk.score+'</div><div class="sub muted">'+mat+'</div></div>'+
    '</div>'+
    '<p class="small" style="margin:12px 0 0">'+quickVerdict(m)+'</p>';
  return box;
}
function quickVerdict(m){
  if(m.dscr==null)return "Add your monthly payment to see whether the property covers its debt.";
  if(m.dscr<1.0)return "<strong>The property is not covering its debt from operations.</strong> This is urgent — the full diagnosis will show whether operations or the capital stack is the bigger lever.";
  if(m.dscr<1.25)return "<strong>Coverage is thin.</strong> You’re covering the loan but with little cushion. Run the full diagnosis to see refinance risk and the fixes.";
  if(m.months!=null && m.months<=18)return "<strong>Coverage looks okay, but maturity is close.</strong> The refinance question matters more than the monthly payment — run the full diagnosis.";
  return "<strong>Coverage looks healthy.</strong> Run the full diagnosis to pressure-test refinance, capex, and rate risk.";
}

/* ---------- module steps ---------- */
function fieldsForSection(sec){
  return Object.keys(FIELDS).filter(function(k){
    if(FIELDS[k].section!==sec)return false;
    if(FIELDS[k].expertOnly && S.mode!=="expert")return false;
    if(FIELDS[k].showIf && !FIELDS[k].showIf())return false;
    return true;
  });
}
function renderStepper(){
  var steps=getSteps();
  var s=el('<div class="stepper"></div>');
  steps.forEach(function(st,i){var idx=i+1;var cls="s"+(S.step===idx?" active":"")+(S.step>idx?" done":"");var b=el('<div class="'+cls+'"><span class="num">'+idx+'</span>'+st.title+'</div>');b.onclick=function(){if(idx<=Math.max(S.step,1)){S.step=idx;render();}};s.appendChild(b);});
  return s;
}
function renderStep(){
  var steps=getSteps(), st=steps[S.step-1];
  if(!st){S.step=1;st=steps[0];}
  if(st.key==="results"){renderResults();return;}
  app.innerHTML="";app.appendChild(renderStepper());
  var card=el('<div class="card"></div>');
  card.appendChild(el('<div class="section-h"><h2>'+st.title+'</h2></div>'));
  if(st.sub){var sub=el('<p class="section-sub"></p>');sub.textContent=st.sub;card.appendChild(sub);}
  if(st.key==="debt") card.appendChild(el('<div class="callout small">Enter <strong>either</strong> your monthly payment <strong>or</strong> your balance + rate + amortization. More detail = higher confidence. Don’t have a number? Choose “I don’t know.”</div>'));
  if(st.key==="capex"&&S.mode!=="expert") card.appendChild(el('<div class="callout small">All optional — but the “cash you could inject” answer is what tells us which fixes are realistic for you.</div>'));
  if(st.key==="stack") card.appendChild(el('<div class="callout small">You don’t need to know what any of this means — answer what you can and choose “not sure” for the rest. The tool uses it to flag structural risks (how your loan type behaves in trouble), who’s personally on the hook, and whether your equity has any cushion left.</div>'));
  if(st.key==="distribution") card.appendChild(el('<div class="callout small">Optional, but powerful. These don’t change your current numbers — they let the tool base the operating-fix math on your actual mix and simulate <strong>shifting OTA→direct</strong> and <strong>negotiating commission</strong> as ways to close the gap. Skip and we’ll use industry defaults.</div>'));

  var keys=fieldsForSection(st.key);
  var dense = S.mode==="expert" && st.key!=="property";
  var host = dense ? el('<div class="grid2"></div>') : el('<div></div>');
  keys.forEach(function(k){host.appendChild(renderField(k));});
  card.appendChild(host);
  if(st.key==="operating"||st.key==="debt") card.appendChild(liveReadout());
  app.appendChild(card);
  app.appendChild(progressNote());
  var nav=el('<div class="navbtns"></div>');
  var back=el('<button class="btn ghost">← Back</button>');back.onclick=function(){S.step=Math.max(0,S.step-1);render();};
  var next=el('<button class="btn primary">Continue →</button>');
  if(S.step===steps.length-1)next.textContent="See my diagnosis →";
  next.onclick=function(){S.step++;render();};
  nav.appendChild(back);nav.appendChild(next);app.appendChild(nav);
  syncTopbar();
}
function liveReadout(){
  var m=compute();
  var box=el('<div class="callout" id="liveReadout" style="margin-top:16px"></div>');
  if(m.dscr!=null){
    box.innerHTML='<strong>So far:</strong> cash after debt ~<strong>'+fmtMoney(m.cashAfterDebt)+'/yr</strong>, DSCR <strong>'+fmtX(m.dscr)+'</strong> — <span class="muted">'+E.dscrBand(m.dscr).label+'</span>. <span class="muted small">Add more to refine.</span>';
  } else box.innerHTML='<span class="muted">Add NOI and either a monthly payment or loan terms to see a live read.</span>';
  return box;
}
function progressNote(){
  var c=overallConfidence();
  var n=el('<div class="card no-print" id="progressNote" style="margin-top:14px;padding:16px"></div>');
  var msg=c.pct>=80?"You’ve provided enough for a solid debt-health check, including refinance risk.":c.pct>=50?"Enough for a rough check. Add loan maturity and T-12 NOI to estimate refinance risk more reliably.":"Enough for a directional read. The more you add (NOI, balance, maturity), the more reliable the estimate.";
  n.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div class="small"><strong>Progress</strong> — '+msg+'</div><span class="pill"><span class="dot '+c.tone+'"></span>Overall confidence: '+c.label+' ('+c.pct+'%)</span></div><div class="confbar"><span style="width:'+c.pct+'%;background:var(--'+c.tone+')"></span></div>';
  return n;
}

/* ---------- compute orchestration ---------- */
function resolveADS(){
  var mp=valOf("monthlyPayment");
  if(mp!=null)return {ads:mp*12, src:"monthly payment", io:get("interestOnly").value==="Yes"};
  var bal=valOf("loanBalance"), rate=valOf("rate"), am=valOf("amort");
  var io=get("interestOnly").value==="Yes"||(am!=null&&am===0);
  if(bal!=null&&rate!=null&&(io||am!=null)){var k=E.loanConstant(rate,io?0:am,io);if(k!=null)return {ads:bal*k, src:"loan terms", io:io};}
  return {ads:null, src:null, io:io};
}
function resolveNOI(){
  var noi=valOf("noi");
  if(noi!=null)return {noi:noi, src:"entered"};
  var rev=valOf("totalRevenue"), margin=valOf("margin");
  if(rev!=null&&margin!=null)return {noi:rev*(margin/100), src:"estimated from revenue × margin"};
  return {noi:null, src:null};
}
function compute(scenario){
  scenario=scenario||{};
  var assumptions=[];
  var noiR=resolveNOI(), noi=noiR.noi;
  var rev=valOf("totalRevenue"), occ=valOf("occ"), adr=valOf("adr"), rooms=valOf("rooms");
  var flowThrough=DEF.flowThrough;
  // room revenue (for per-lever and distribution math); fall back to total revenue
  var roomRevenue=(adr!=null&&occ!=null&&rooms!=null)?adr*(occ/100)*rooms*365:(rev!=null?rev:null);
  // distribution inputs + actuals-derived per-lever flow-through
  var otaShare=valOf("otaShare"), otaComm=valOf("otaCommission"), directCost=valOf("directCost"), cpor=valOf("cpor");
  var adrFlow=DEF.adrFlow, occFlow=DEF.occFlow, flowSrc="default";
  var fa=E.flowThroughFromActuals({otaSharePct:otaShare,otaCommissionPct:otaComm,cpor:cpor,adr:adr});
  if(fa){flowSrc="actuals";adrFlow=fa.adrFlow;if(fa.occFlow!=null)occFlow=fa.occFlow;
    assumptions.push("Operating flow-through derived from your mix ("+otaShare+"% OTA at "+otaComm+"% commission"+(cpor!=null?(", $"+cpor+"/occupied room"):"")+"): ADR "+Math.round(adrFlow)+"%"+(fa.occFlow!=null?", occupancy "+Math.round(occFlow)+"%":" (occupancy uses default — add cost per occupied room)")+".");}
  else assumptions.push("Operating flow-through uses defaults (ADR "+DEF.adrFlow+"%, occupancy "+DEF.occFlow+"%) — add OTA mix & commission to base this on your actuals.");
  if(noi!=null&&scenario.applied){
    var addNOI=0;
    if(roomRevenue!=null){
      addNOI+=(scenario.adrPct||0)/100*roomRevenue*(adrFlow/100);   // ADR lever (per-lever flow-through)
      addNOI+=(scenario.occPct||0)/100*roomRevenue*(occFlow/100);   // occupancy lever
    }
    addNOI+=(scenario.expenseCut||0);
    if(roomRevenue!=null&&otaComm!=null&&scenario.shiftToDirect) addNOI+=E.channelShiftBenefit({points:scenario.shiftToDirect,roomRevenue:roomRevenue,otaCommissionPct:otaComm,directCostPct:directCost!=null?directCost:DEF.directCost});
    if(roomRevenue!=null&&otaShare!=null&&scenario.commissionCut) addNOI+=E.commissionCutBenefit({points:scenario.commissionCut,roomRevenue:roomRevenue,otaSharePct:otaShare});
    noi=noi+addNOI;
  }
  var adsR=resolveADS(), ads=adsR.ads;
  if(scenario.applied&&scenario.io&&valOf("loanBalance")!=null){ads=valOf("loanBalance")*E.loanConstant(scenario.refiRate||DEF.refiRateMid,0,true);}
  var dscr=E.dscr(noi,ads);
  var cash=E.cashAfterDebt(noi,ads);

  var tDSCR=valOf("targetDSCR"); if(tDSCR==null){tDSCR=DEF.targetDSCRmid;assumptions.push("Lender target DSCR not provided — modeled at "+DEF.targetDSCRs.join("x / ")+"x (base case "+DEF.targetDSCRmid+"x).");}
  var rRate=scenario.refiRate||valOf("refiRate"); if(rRate==null){rRate=DEF.refiRateMid;assumptions.push("Refinance rate not provided — modeled at "+DEF.refiRates.join("% / ")+"% (base case "+DEF.refiRateMid+"%).");}
  var rAmort=valOf("refiAmort"); if(rAmort==null){rAmort=DEF.refiAmort;assumptions.push("Refinance amortization assumed at "+DEF.refiAmort+" years.");}
  var mdy=valOf("minDebtYield"); if(mdy==null){mdy=DEF.minDebtYield;assumptions.push("Minimum debt yield assumed at "+DEF.minDebtYield+"%.");}
  var ltv=valOf("maxLTV"); if(ltv==null){ltv=DEF.maxLTV;assumptions.push("Maximum LTV assumed at "+DEF.maxLTV+"% (only applied if a value or cap rate is given).");}
  var value=valOf("value"), capRate=valOf("capRate");
  if(value==null&&capRate!=null&&capRate>0&&noi!=null){value=noi/(capRate/100);assumptions.push("Property value estimated from NOI ÷ cap rate ("+capRate+"%) = "+fmtMoney(value)+".");}

  var reqNOI=ads!=null?E.requiredNOI(ads,tDSCR):null;
  var bal=valOf("loanBalance");
  var dy=E.debtYield(noi,bal);
  var sup=E.supportableLoan({noi:noi,targetDSCR:tDSCR,refiRatePct:rRate,amortYears:rAmort,minDebtYieldPct:mdy,maxLTVPct:ltv,value:value});

  // capex (net of reserve) and sources&uses gap
  var capTotal=(valOf("pip")||0)+(valOf("deferred")||0)+(valOf("plannedReno")||0);
  var capNet=capTotal-(valOf("capexReserve")||0);
  var prepay=valOf("prepayPenalty")||0;
  var gapObj=(bal!=null&&sup.loan!=null)?E.refinanceGap({balance:bal,supportableProceeds:sup.loan,refiCostPct:DEF.refiCostPct,netCapex:Math.max(0,capNet),prepay:prepay}):null;
  var gap=gapObj?gapObj.gap:null;

  var rnoObj=E.requiredNOIToRefinance({balance:bal,refiRatePct:rRate,amortYears:rAmort,targetDSCR:tDSCR,minDebtYieldPct:mdy});
  var reqNOItoRefi=rnoObj?rnoObj.value:null;
  var lift=(noi!=null&&reqNOItoRefi!=null)?E.noiLiftTranslation({currentNOI:noi,targetNOI:reqNOItoRefi,rooms:rooms,occPct:occ,adr:adr,flowThroughPct:DEF.flowThrough,adrFlowPct:adrFlow,occFlowPct:occFlow}):null;

  var months=monthsTo(rawOf("maturity")), matRisk=E.maturityRisk(months);
  var capPress=E.capexPressure(capTotal,noi);
  var curRate=valOf("rate"), shock=null;
  if(bal!=null&&curRate!=null)shock=E.rateShock({balance:bal,amortYears:(adsR.io?0:(valOf("amort")||rAmort)),noi:noi,rates:[curRate,curRate+1,curRate+2,curRate+3]});
  var floating=get("floating").value==="Floating";

  // ---- capital stack waterfall ----
  var mezz=valOf("mezzBalance"), pref=valOf("prefBalance");
  var stackLayers=[];
  if(bal!=null) stackLayers.push({name:"Senior mortgage",kind:"debt",amount:bal});
  if(mezz!=null) stackLayers.push({name:"Mezzanine / 2nd loan",kind:"debt",amount:mezz});
  if(pref!=null) stackLayers.push({name:"Preferred equity",kind:"pref",amount:pref});
  var stack=(stackLayers.length&&value!=null)?E.capitalStack({layers:stackLayers,value:value}):(stackLayers.length?E.capitalStack({layers:stackLayers}):null);

  // ---- exposure / liability read ----
  var exposure=exposureRead();

  var tri=E.triage({dscr:dscr,targetDSCR:tDSCR,refiGap:gap,monthsToMaturity:months,capexRatio:capPress.ratio,floating:floating,currentRatePct:curRate,currentNOI:noi});
  // merge structural + exposure + stack findings into the SAME triage (one diagnosis, not separate tools)
  var extra=[];
  if(stack&&stack.value!=null){
    if(stack.sponsorStatus==="wiped") extra.push({key:"stack",weight:88,title:"Your equity is underwater",detail:"At today’s estimated value, the debt"+(pref!=null?" and preferred equity":"")+" exceed what the property is worth — in a sale today your common equity would not recover."});
    else if(stack.equityCushionPct!=null&&stack.equityCushionPct<10) extra.push({key:"stack",weight:70,title:"Thin equity cushion",detail:"Value would only need to fall about "+Math.round(stack.equityCushionPct)+"% before your equity is wiped out."});
    var impaired=stack.layers.filter(function(l){return l.status==="impaired"||l.status==="wiped";});
    if(impaired.length) extra.push({key:"stack",weight:74,title:"Part of the capital stack is exposed",detail:impaired.map(function(l){return l.name;}).join(" and ")+" would not be fully repaid at today’s value — expect resistance from those holders in any restructuring."});
  }
  if(exposure&&exposure.severity>=55) extra.push({key:"exposure",weight:exposure.weight,title:exposure.title,detail:exposure.detail});
  structuralIssues({dscr:dscr,targetDSCR:tDSCR,months:months,floating:floating}).forEach(function(i){extra.push(i);});
  if(extra.length){
    tri.issues=tri.issues.concat(extra).sort(function(a,b){return b.weight-a.weight;});
    tri.primary=tri.issues[0];
    tri.combination=tri.issues.length>=3;
  }

  return {noi:noi,noiSrc:noiR.src,annualDebtService:ads,adsSrc:adsR.src,io:adsR.io,dscr:dscr,cashAfterDebt:cash,
    targetDSCR:tDSCR,requiredNOI:reqNOI,debtYield:dy,supportable:sup,refiGap:gap,refiGapObj:gapObj,
    requiredNOItoRefi:reqNOItoRefi,reqNOIObj:rnoObj,noiLift:lift,months:months,maturityRisk:matRisk,
    capexTotal:capTotal,capexNet:capNet,capexPressure:capPress,liquidity:valOf("liquidity"),
    rateShock:shock,floating:floating,refiRate:rRate,refiAmort:rAmort,minDebtYield:mdy,maxLTV:ltv,value:value,
    triage:tri,assumptions:assumptions,rooms:rooms,occ:occ,adr:adr,
    roomRevenue:roomRevenue,otaShare:otaShare,otaComm:otaComm,directCost:directCost,cpor:cpor,
    adrFlow:adrFlow,occFlow:occFlow,flowSrc:flowSrc,
    stack:stack,exposure:exposure,lenderType:get("lenderType").value};
}

/* ---------- confidence ---------- */
function sectionConfidence(sec){
  var keys=Object.keys(FIELDS).filter(function(k){return FIELDS[k].section===sec&&(FIELDS[k].sensitive||FIELDS[k].weight>=1);});
  return E.confidence(keys.map(function(k){return {weight:FIELDS[k].weight,status:statusOf(k)};}));
}
function overallConfidence(){
  return E.confidence(Object.keys(FIELDS).map(function(k){return {weight:FIELDS[k].weight,status:statusOf(k)};}));
}

/* ---------- capital stack options ---------- */
var STACK_OPTIONS=[
  {n:"Improve NOI, refinance later",solves:"Refi proceeds gap; coverage",notsolve:"Imminent maturity",control:"Full",complexity:"Medium",fit:"Time before maturity + real operating upside"},
  {n:"Request a loan extension",solves:"Maturity timing",notsolve:"Underlying NOI gap",control:"Full",complexity:"Low–Med",fit:"Near maturity, lender relationship intact"},
  {n:"Temporary interest-only period",solves:"Short-term cash flow",notsolve:"Proceeds gap at refi",control:"Full",complexity:"Low",fit:"Thin coverage, fixable operations"},
  {n:"Pay down principal",solves:"Refi gap; debt yield",notsolve:"Operating weakness",control:"Full",complexity:"Low",fit:"Owner has capital to inject"},
  {n:"Preferred equity",solves:"Capital gap without full sale",notsolve:"Long-run economics if NOI weak",control:"Reduced",complexity:"High",fit:"Need capital, want to retain control-ish"},
  {n:"JV equity",solves:"Larger capital need",notsolve:"Full ownership retention",control:"Shared",complexity:"High",fit:"Larger gap, willing to share upside"},
  {n:"Sell the asset",solves:"Eliminates the debt problem",notsolve:"Retaining the asset",control:"None after sale",complexity:"Medium",fit:"Gap too large to bridge; better exit now"},
  {n:"Refinance at lower proceeds",solves:"Resets the loan",notsolve:"Requires equity to cover gap",control:"Full",complexity:"Medium",fit:"Some equity available; rate/term reset wanted"},
  {n:"Delay / phase capex",solves:"Near-term cash pressure",notsolve:"Brand/PIP obligations long-term",control:"Full",complexity:"Low",fit:"Discretionary capex; PIP timing flexible"},
  {n:"Operational fix + capital restructure",solves:"Most combination cases",notsolve:"—",control:"Varies",complexity:"High",fit:"Problem is genuinely multi-cause"}
];
function relevantOptions(m){
  var picks=[],k=m.triage.primary.key;
  function add(name){var o=STACK_OPTIONS.filter(function(x){return x.n===name;})[0];if(o&&picks.indexOf(o)<0)picks.push(o);}
  if(k==="maturity"){add("Request a loan extension");add("Improve NOI, refinance later");add("Refinance at lower proceeds");}
  if(k==="operations"){add("Improve NOI, refinance later");add("Temporary interest-only period");add("Operational fix + capital restructure");}
  if(k==="stack"){add("Pay down principal");add("Preferred equity");add("Improve NOI, refinance later");add("Refinance at lower proceeds");}
  if(k==="capex"){add("Delay / phase capex");add("Pay down principal");add("Improve NOI, refinance later");}
  if(k==="rate"){add("Temporary interest-only period");add("Refinance at lower proceeds");add("Improve NOI, refinance later");}
  if(m.triage.combination){add("Operational fix + capital restructure");add("JV equity");}
  if(m.refiGap!=null&&m.refiGap>0)add("Sell the asset");
  if(!picks.length){add("Improve NOI, refinance later");add("Request a loan extension");}
  return picks.slice(0,6);
}

/* ---------- knowledge: loan-type profiles (good / risks / tactics) ---------- */
var LOAN_PROFILES={
  "Bank / credit union":{good:["Relationship-driven — often the most willing to extend, modify, or restructure","Faster, human decisions than a securitized loan"],
    risks:["Frequently full or partial recourse — your other assets can be exposed","Financial covenants (min DSCR / debt yield) that can trip before maturity","Shorter terms with balloons; renewal at the bank’s discretion"],
    tactics:["Go to your relationship officer early with a plan, not a surprise","Fix a covenant breach before it happens — ask for a waiver or reset","Propose an extension or temporary interest-only to buy time"]},
  "CMBS":{good:["Usually non-recourse (subject to standard carve-outs)","Fixed rate, longer term, often higher leverage at origination"],
    risks:["Very rigid — handled by a master/special servicer, not a banker","Prepay is costly: defeasance or yield maintenance","A lockbox/cash-trap can ‘spring’ if DSCR drops below a trigger — your cash gets swept","Hard to modify until the loan transfers to special servicing (often only after distress)"],
    tactics:["Model your defeasance/yield-maintenance cost before assuming you can refinance or sell","Know your cash-management trigger and how close you are to it","Engage the master servicer early; understand the path to special servicing"]},
  "Debt fund / bridge":{good:["Flexible structuring, interest-only common, fast to close","Built for transitional business plans"],
    risks:["Floating rate — payments rise with the index unless you hold a cap","Short term; maturity comes fast","Extension options usually have hurdles (a DSCR/debt-yield test), an extension fee, and a fresh rate-cap purchase","Cash sweeps and performance tests are common"],
    tactics:["Read your extension conditions NOW — can you actually meet the test?","Budget for a new rate cap; they’ve gotten expensive","Line up your takeout (refi or sale) well before maturity"]},
  "SBA":{good:["Low down payment, long amortization","Good for owner-operated properties"],
    risks:["Personal guarantee is required — this is personal debt","Prepayment penalty schedule in early years","Occupancy / eligibility rules to maintain"],
    tactics:["Know where you are in the prepayment step-down","Treat this as personal exposure in any decision","Keep eligibility conditions in good standing"]},
  "Life company":{good:["Low rates, long fixed terms, very stable","Typically non-recourse"],
    risks:["Conservative leverage — less proceeds","Yield-maintenance prepayment is expensive","Little flexibility to modify"],
    tactics:["Model yield maintenance before considering an early payoff","Usually best to hold to term and plan the takeout in advance"]},
  "Other / not sure":{good:["—"],
    risks:["We can’t tailor structural risks without the lender type — worth finding on your loan agreement"],
    tactics:["Locate the loan agreement and note the lender type, recourse, prepay terms, and any covenants"]}
};

/* ---------- knowledge: default / workout sequencing (not legal advice) ---------- */
var DEFAULT_SEQUENCE=[
  ["Covenant trip (e.g., DSCR below the required level)","Often the FIRST signal. May trigger a cash sweep/trap or a default notice even while you’re current on payments. Usually has a cure path — a paydown, a waiver, or a reset."],
  ["Maturity default (loan comes due, can’t pay it off)","The most common hotel distress today. The lender can extend, modify, or pursue remedies. This is where an extension request lives."],
  ["Payment default (missed payments)","More serious. Starts cure periods, default interest, and the path toward enforcement."],
  ["Lender remedies","Forbearance (a written pause), loan modification, deed-in-lieu (hand back the keys), receivership, or foreclosure. Order and options depend on the documents and the state."],
  ["If there’s mezzanine / preferred above your equity","Intercreditor rules govern who can act, cure, or take over — the senior lender usually has standstill and consent rights over the junior. Juniors may cure to protect their position."]
];

/* ---------- exposure read (who’s on the hook, plain English) ---------- */
function exposureRead(){
  var rec=get("recourse").value, gtee=get("guarantee").value, who=get("guarantor").value, other=get("otherGuarantees").value;
  if(!rec && !gtee) return null;
  var flags=[], goods=[], severity=0, title="", detail="";
  if(gtee==="Yes — full guarantee" || rec==="Recourse"){
    severity=80; title="High personal exposure";
    flags.push("You appear to be personally on the hook for the debt — a shortfall on the property can reach your other assets.");
  } else if(gtee==="Yes — partial / limited"){
    severity=55; title="Partial personal exposure";
    flags.push("A partial/limited guarantee caps your exposure but it is still personal — know the cap and any burn-off conditions.");
  } else if(gtee==="Only ‘bad-boy’ carve-outs" || rec==="Non-recourse"){
    severity=25; title="Mostly limited exposure (with carve-outs)";
    goods.push("Non-recourse generally limits you to the property.");
    flags.push("‘Bad-boy’ carve-outs can make it personal if certain acts occur — most commonly filing bankruptcy, fraud/misrepresentation, or an unapproved transfer or further encumbrance. Avoid tripping them, especially in a workout.");
  } else {
    severity=10; title="Exposure unclear";
    flags.push("Find your recourse terms and any guaranty in the loan documents — this determines what’s personally at risk.");
  }
  if(other==="Yes") flags.push("A completion or environmental guarantee/indemnity usually stays personal even on a non-recourse loan.");
  if(who==="Me and partners") flags.push("Exposure is shared with partners — joint-and-several liability often means any one guarantor can be pursued for the whole amount.");
  if(who==="An entity only (no individuals)") goods.push("Exposure appears limited to an entity, not individuals — worth confirming.");
  detail=flags.join(" ");
  return {severity:severity, weight:severity, title:title, detail:detail, goods:goods, flags:flags};
}

/* ---------- structural risk from loan type + situation ---------- */
function structuralIssues(m){
  var out=[], lt=get("lenderType").value;
  if(lt==="CMBS"){
    if(get("cashMgmt").value==="Yes" && m.dscr!=null && m.dscr<1.25) out.push({key:"structural",weight:72,title:"CMBS cash-trap risk",detail:"With a lockbox in place and coverage thin, a cash-management sweep may trigger — diverting your cash flow. Confirm the trigger level and your headroom."});
    if(m.months!=null && m.months<=24) out.push({key:"structural",weight:68,title:"CMBS rigidity into maturity",detail:"CMBS loans are hard to modify and costly to prepay (defeasance/yield maintenance). Model that cost now and start the servicer conversation early."});
  }
  if(lt==="Debt fund / bridge"){
    if(m.floating) out.push({key:"structural",weight:64,title:"Bridge: floating-rate + extension risk",detail:"Bridge debt is floating and short. Check your extension test (often a DSCR/debt-yield hurdle plus a fee and a new rate cap) — you may not qualify when you need it."});
  }
  if(lt==="SBA"){
    out.push({key:"exposure",weight:60,title:"SBA = personal debt",detail:"SBA loans carry a personal guarantee. Treat this as personal exposure in every decision; check the prepayment step-down too."});
  }
  if(get("covenants").value==="Yes" && m.dscr!=null && m.dscr<(m.targetDSCR||1.25)){
    out.push({key:"structural",weight:66,title:"Covenant breach risk",detail:"You indicated financial covenants and coverage is below a typical required level — a covenant trip can precede any missed payment. Address it before it triggers."});
  }
  return out;
}

/* ---------- diagnostic scan: every dimension, status + one-liner ---------- */
function scan(m){
  function row(label,tone,note){return {label:label,tone:tone,note:note};}
  var rows=[];
  // coverage
  if(m.dscr==null) rows.push(row("Debt-service coverage","unknown","Add NOI and a payment to assess."));
  else { var b=E.dscrBand(m.dscr); rows.push(row("Debt-service coverage", b.tone, "DSCR "+fmtX(m.dscr)+" — "+b.label.split("—").slice(-1)[0].trim())); }
  // leverage / refi proceeds
  if(m.refiGap==null) rows.push(row("Leverage / refinance proceeds","unknown","Add balance + NOI to test the refi gap."));
  else rows.push(row("Leverage / refinance proceeds", m.refiGap>0?"critical":"good", m.refiGap>0?("Shortfall ~"+fmtMoney(m.refiGap)+" to refinance"):"Supportable debt covers the balance"));
  // maturity
  rows.push(row("Loan maturity", m.maturityRisk.tone, m.months!=null?(m.maturityRisk.score+" — "+m.months+" months out"):"Add maturity date"));
  // rate
  if(m.floating) rows.push(row("Interest-rate exposure","warn","Floating rate — exposed to further increases"));
  else if(valOfSafe("rate")!=null) rows.push(row("Interest-rate exposure","ok","Fixed / known rate"));
  else rows.push(row("Interest-rate exposure","unknown","Add rate + type"));
  // capex
  rows.push(row("Capital / PIP burden", m.capexPressure.tone, m.capexTotal?(m.capexPressure.score+" — "+fmtMoney(m.capexTotal)+" identified"):"None entered"));
  // capital stack / equity cushion
  if(m.stack && m.stack.value!=null) rows.push(row("Capital stack / equity cushion", m.stack.sponsorStatus==="wiped"?"critical":(m.stack.equityCushionPct!=null&&m.stack.equityCushionPct<10?"warn":"good"), m.stack.sponsorStatus==="wiped"?"Equity underwater at today’s value":("Value can fall ~"+Math.round(m.stack.equityCushionPct)+"% before equity is wiped")));
  else rows.push(row("Capital stack / equity cushion","unknown","Add property value (or cap rate) to test"));
  // personal exposure
  if(m.exposure) rows.push(row("Personal exposure / liability", m.exposure.severity>=70?"critical":m.exposure.severity>=40?"warn":m.exposure.severity>=20?"ok":"unknown", m.exposure.title));
  else rows.push(row("Personal exposure / liability","unknown","Add recourse + guarantee"));
  // distribution
  if(m.otaShare!=null && m.otaComm!=null){ var costly=(m.otaShare*m.otaComm/100)>=12; rows.push(row("Distribution / channel cost", costly?"warn":"ok", costly?("High OTA cost — ~"+Math.round(m.otaShare*m.otaComm/100)+"% of room revenue to commissions"):"Channel cost looks contained")); }
  else rows.push(row("Distribution / channel cost","unknown","Add OTA mix + commission"));
  return rows;
}
function valOfSafe(k){return valOf(k);}

/* ---------- operations plausibility ---------- */
function opsPlausibility(m){
  if(!m.noiLift||m.noiLift.alreadyMeets)return null;
  var pos=get("marketPosition").value;
  var adrLiftPct=(m.adr&&m.noiLift.adrIncreaseAtCurrentOcc)?(m.noiLift.adrIncreaseAtCurrentOcc/m.adr*100):null;
  if(adrLiftPct==null)return {tone:"unknown",verdict:"Add ADR, occupancy, and your comp-set position to judge how realistic an operations-only fix is."};
  var tight=pos==="Above comp set (limited headroom)", roomy=pos==="Below comp set (room to grow)";
  if(tight)return {tone:"warn",verdict:"Operations alone is unlikely to close the gap — you’re already at or above your comp set, so the capital stack probably needs to change.",adrLiftPct:adrLiftPct};
  if(adrLiftPct<=7)return {tone:"good",verdict:"Likely fixable through operations — the required rate/occupancy lift is modest"+(roomy?", and your below-comp-set position suggests real upside.":"."),adrLiftPct:adrLiftPct};
  if(adrLiftPct<=15)return {tone:"ok",verdict:"Possibly fixable through operations, but it would take a serious commercial push"+(roomy?" — your below-comp-set position helps.":"."),adrLiftPct:adrLiftPct};
  return {tone:"warn",verdict:"The required lift is large; operations may help but the capital stack likely needs to change too.",adrLiftPct:adrLiftPct};
}

/* ---------- diagnostic scan panel (the unifying "where are my problems" view) ---------- */
function renderScan(m){
  var card=el('<div class="card"></div>');
  card.appendChild(el('<div class="section-h"><h2>Diagnostic scan — where your problems are</h2></div>'));
  card.appendChild(el('<p class="section-sub">You don’t have to know which lens applies — we checked every dimension. Red needs attention, amber is worth watching, green looks okay, grey means we need a bit more info.</p>'));
  scan(m).forEach(function(r){
    card.appendChild(el('<div class="flagrow"><span class="dot '+r.tone+'" style="width:12px;height:12px;border-radius:50%;margin-top:4px;flex:0 0 auto"></span><div><strong>'+r.label+'</strong> <span class="muted">— '+r.note+'</span></div></div>'));
  });
  return card;
}

/* ---------- capital stack & risk detail (subordinate to the scan/triage) ---------- */
function renderStackRisk(m){
  var hasStack=m.stack&&m.stack.layers.length, hasExp=m.exposure, lt=m.lenderType, prof=lt&&LOAN_PROFILES[lt];
  if(!hasStack&&!hasExp&&!prof) return null;
  var card=el('<div class="card"></div>');
  card.appendChild(el('<div class="section-h"><h2>Capital stack & risk</h2></div>'));
  if(hasStack&&m.stack.value!=null){
    var s=m.stack, cushionTone=s.sponsorStatus==="wiped"?"critical":(s.equityCushionPct<10?"warn":"good");
    card.appendChild(el('<div class="callout '+(cushionTone==="good"?"":cushionTone)+'"><strong>Who gets paid first — and your cushion.</strong> At an estimated value of '+fmtMoney(s.value)+', '+(s.sponsorStatus==="wiped"?'your equity is underwater: debt'+(m.stack.layers.length>1?'/pref':'')+' exceeds value.':'value can fall about <strong>'+Math.round(s.equityCushionPct)+'%</strong> before your equity is wiped out.')+'</div>'));
    var t=el('<table><tr><th>Layer (senior → junior)</th><th class="num">Balance</th><th class="num">LTV band</th><th>At today’s value</th></tr></table>');
    s.layers.forEach(function(l){var tone=l.status==="covered"?"good":l.status==="impaired"?"warn":"critical";t.appendChild(el('<tr><td>'+l.name+'</td><td class="num">'+fmtMoney(l.amount)+'</td><td class="num">'+fmtPct(l.attachLTV,0)+'–'+fmtPct(l.detachLTV,0)+'</td><td><span class="pill"><span class="dot '+tone+'"></span>'+l.status+(l.status==="impaired"?(" · recovers "+fmtMoney(l.recovery)):"")+'</span></td></tr>'));});
    t.appendChild(el('<tr><td>Your (common) equity</td><td class="num">'+(s.commonEquity!=null?fmtMoney(s.commonEquity):"—")+'</td><td class="num">'+fmtPct(s.leverageLTVpct,0)+'–100%</td><td><span class="pill"><span class="dot '+(s.sponsorStatus==="wiped"?"critical":"good")+'"></span>'+s.sponsorStatus+'</span></td></tr>'));
    card.appendChild(t);
  } else if(hasStack){
    card.appendChild(el('<div class="callout small">Add a property value (or cap rate, in the Structure step) and we’ll show the full waterfall — who recovers and how much cushion your equity has.</div>'));
  }
  if(hasExp){
    var e=m.exposure;
    card.appendChild(el('<h3 style="font-size:16px;color:var(--navy);margin-top:14px">Who’s on the hook — '+e.title+'</h3>'));
    if(e.flags.length){var ul=el('<ul class="checklist small"></ul>');e.flags.forEach(function(f){ul.appendChild(el('<li>'+f+'</li>'));});card.appendChild(ul);}
    if(e.goods&&e.goods.length){card.appendChild(el('<p class="small" style="margin:4px 0"><strong>In your favor:</strong></p>'));var ulg=el('<ul class="checklist small"></ul>');e.goods.forEach(function(f){ulg.appendChild(el('<li>'+f+'</li>'));});card.appendChild(ulg);}
  }
  if(prof){
    card.appendChild(el('<h3 style="font-size:16px;color:var(--navy);margin-top:14px">Your loan type: '+lt+'</h3>'));
    function bl(title,arr){var d=el('<div></div>');d.appendChild(el('<p class="small" style="margin:6px 0 2px"><strong>'+title+'</strong></p>'));var ul=el('<ul class="checklist small"></ul>');arr.forEach(function(x){ul.appendChild(el('<li>'+x+'</li>'));});d.appendChild(ul);return d;}
    card.appendChild(bl("What’s good about it",prof.good));
    card.appendChild(bl("What to watch",prof.risks));
    card.appendChild(bl("Tactics",prof.tactics));
  }
  var acc=el('<details class="acc" style="margin-top:12px"><summary>If things go sideways: how a workout typically unfolds</summary><div class="body"></div></details>');
  var ab=acc.querySelector(".body"), ol=el('<ol class="checklist small"></ol>');
  DEFAULT_SEQUENCE.forEach(function(d){ol.appendChild(el('<li><strong>'+d[0]+'</strong> — '+d[1]+'</li>'));});
  ab.appendChild(ol);
  ab.appendChild(el('<div class="callout warn small">A general map, not legal advice. Triggers, cure rights, and remedies depend on your loan documents and state law — involve a workout attorney before acting.</div>'));
  card.appendChild(acc);
  return card;
}

/* ---------- RESULTS ---------- */
var scenarioState={applied:false,adrPct:0,occPct:0,expenseCut:0,shiftToDirect:0,commissionCut:0,refiRate:DEF.refiRateMid,io:false,equity:0};
function renderResults(){
  app.innerHTML="";app.appendChild(renderStepper());
  var m=compute();
  var band=m.dscr!=null?E.dscrBand(m.dscr):{tone:"unknown",label:"Not enough information yet"};
  var headline=m.dscr==null?"Need a few more numbers":m.dscr<1.0?"Debt service: Under pressure":m.dscr<m.targetDSCR?"Debt service: At risk":"Debt service: Covered";
  var banner=el('<div class="banner '+band.tone+'"></div>');
  banner.innerHTML='<h2>'+headline+'</h2><p>'+(m.dscr!=null?('After your loan payment, the property generates about <strong>'+fmtMoney(m.cashAfterDebt)+'/yr</strong> (DSCR '+fmtX(m.dscr)+'). Primary issue: <strong>'+m.triage.primary.title+'</strong>.'):'Add NOI and your loan details to generate a diagnosis.')+'</p>';
  app.appendChild(banner);
  app.appendChild(renderScan(m));

  if(get("noiBasis").value==="No / not sure"&&m.noi!=null){
    app.appendChild(el('<div class="callout warn small"><strong>Heads up on your NOI.</strong> You indicated it may not already subtract a management fee and an FF&E reserve. Lenders will. If it doesn’t, your true NOI — and every number below — is likely 5–8% lower than shown. Consider deducting ~3% management fee and ~4% reserve.</div>'));
  }

  var metric=function(lab,val,sub,tone){return '<div class="metric"><div class="lab">'+lab+'</div><div class="val"'+(tone?' style="color:var(--'+tone+')"':'')+'>'+val+'</div>'+(sub?'<div class="sub '+(tone?'':'muted')+'"'+(tone?' style="color:var(--'+tone+')"':'')+'>'+sub+'</div>':'')+'</div>';};
  var cashTone=m.cashAfterDebt==null?"":(m.cashAfterDebt>=0?"good":"critical");
  var gapTone=m.refiGap==null?"":(m.refiGap>0?"critical":"good");
  var metrics=el('<div class="metrics"></div>');
  metrics.innerHTML=
    metric("Cash after loan payment",m.cashAfterDebt==null?"—":fmtMoney(m.cashAfterDebt)+"/yr","NOI − annual debt service",cashTone)+
    metric("Current DSCR",fmtX(m.dscr),m.dscr!=null?(band.label.split("—").slice(-1)[0]):"—",band.tone)+
    metric("Refinance gap",m.refiGap==null?"—":fmtMoney(Math.abs(m.refiGap)),m.refiGap==null?"add balance + NOI":(m.refiGap>0?"shortfall (incl. capex & costs)":"surplus"),gapTone)+
    metric("Maturity risk",m.maturityRisk.score,m.months!=null?(m.months+" months out"):"add maturity date",m.maturityRisk.tone);
  app.appendChild(metrics);
  var metrics2=el('<div class="metrics" style="margin-top:12px"></div>');
  metrics2.innerHTML=
    metric("Annual debt service",fmtMoney(m.annualDebtService),m.adsSrc?("from "+m.adsSrc):"—")+
    metric("Required NOI to refinance",fmtMoney(m.requiredNOItoRefi),m.reqNOIObj?("bound by "+bindingLabel(m.reqNOIObj.binding)):"")+
    metric("Supportable new debt",m.supportable.loan==null?"—":fmtMoney(m.supportable.loan),m.supportable.binding?("bound by "+bindingLabel(m.supportable.binding)):"")+
    metric("Capex pressure",m.capexPressure.score,m.capexTotal?fmtMoney(m.capexTotal)+" identified":"none entered",m.capexPressure.tone);
  app.appendChild(metrics2);

  // refi gap breakdown
  if(m.refiGapObj){
    var g=m.refiGapObj;
    var br=el('<details class="acc"><summary>How the refinance gap is built (sources & uses)</summary><div class="body"></div></details>');
    br.querySelector(".body").innerHTML=
      '<table><tr><th>Uses (what must be covered at maturity)</th><th class="num">Amount</th></tr>'+
      '<tr><td>Pay off existing loan balance</td><td class="num">'+fmtMoney(g.balance)+'</td></tr>'+
      '<tr><td>Net capital / PIP due (after reserves)</td><td class="num">'+fmtMoney(g.netCapex)+'</td></tr>'+
      '<tr><td>Estimated refinancing costs ('+DEF.refiCostPct+'% of new loan)</td><td class="num">'+fmtMoney(g.refiCost)+'</td></tr>'+
      '<tr><td>Prepayment penalty / defeasance</td><td class="num">'+fmtMoney(g.prepay)+'</td></tr>'+
      '<tr><td><strong>Total needed</strong></td><td class="num"><strong>'+fmtMoney(g.uses)+'</strong></td></tr>'+
      '<tr><td>Less: supportable new loan</td><td class="num">('+fmtMoney(m.supportable.loan)+')</td></tr>'+
      '<tr><td><strong>'+(g.gap>0?"Shortfall to bridge":"Surplus")+'</strong></td><td class="num"><strong>'+fmtMoney(g.gap)+'</strong></td></tr></table>'+
      (m.liquidity!=null?('<p class="small '+(m.liquidity>=g.gap?'':'')+'" style="margin-top:8px">You indicated about <strong>'+fmtMoney(m.liquidity)+'</strong> of cash you could inject. '+(g.gap<=0?'No shortfall to cover.':(m.liquidity>=g.gap?'That appears sufficient to bridge the shortfall.':'That covers part of the '+fmtMoney(g.gap)+' shortfall, leaving ~'+fmtMoney(g.gap-m.liquidity)+' to find elsewhere.'))+'</p>'):'');
    app.appendChild(br);
  }

  // diagnosis
  var diag=el('<div class="card"></div>');
  diag.appendChild(el('<div class="section-h"><h2>What’s really going on</h2></div>'));
  diag.appendChild(el('<div class="callout '+(band.tone==="good"?"":band.tone==="critical"?"critical":"warn")+'"><strong>'+m.triage.primary.title+'.</strong> '+m.triage.primary.detail+'</div>'));
  if(m.triage.combination)diag.appendChild(el('<p class="small muted">This looks like a <strong>combination</strong> of issues rather than a single cause — see the full list below.</p>'));
  if(m.triage.issues.length>1){var ul=el('<ul class="checklist small"></ul>');m.triage.issues.forEach(function(is){ul.appendChild(el('<li><strong>'+is.title+'</strong> — '+is.detail+'</li>'));});diag.appendChild(el('<p class="small" style="margin-bottom:4px"><strong>All contributing factors:</strong></p>'));diag.appendChild(ul);}

  if(m.noiLift&&!m.noiLift.alreadyMeets){
    diag.appendChild(el('<div class="section-h" style="margin-top:14px"><h2 style="font-size:18px">Can operations realistically fix this?</h2></div>'));
    var nl=m.noiLift;
    diag.appendChild(el('<div><table><tr><th>Lever</th><th class="num">Required move</th></tr>'+
      '<tr><td>Increase annual NOI by</td><td class="num">'+fmtMoney(nl.noiLift)+'</td></tr>'+
      '<tr><td>…via incremental revenue (~'+nl.flowThroughPct+'% blended flow-through)</td><td class="num">'+fmtMoney(nl.annualRevenueIncrease)+'/yr ('+fmtMoney(nl.monthlyRevenueIncrease)+'/mo)</td></tr>'+
      (nl.revparIncrease!=null?'<tr><td>RevPAR increase</td><td class="num">+'+fmtMoney(nl.revparIncrease)+'</td></tr>':'')+
      (nl.adrIncreaseAtCurrentOcc!=null?'<tr><td>ADR increase, holding occupancy (~'+nl.adrFlowPct+'% flow-through)</td><td class="num">+'+fmtMoney(nl.adrIncreaseAtCurrentOcc)+'</td></tr>':'')+
      (nl.occPointIncreaseAtCurrentADR!=null?'<tr><td>Occupancy increase, holding ADR (~'+nl.occFlowPct+'% flow-through)</td><td class="num">+'+fmtPct(nl.occPointIncreaseAtCurrentADR,1)+' pts</td></tr>':'')+
      '<tr><td>…or pure expense reduction</td><td class="num">'+fmtMoney(nl.expenseReduction)+'/yr</td></tr>'+
      distributionLeverRows(m,nl)+'</table></div>'));
    var pl=opsPlausibility(m);
    if(pl)diag.appendChild(el('<div class="callout '+(pl.tone==="good"?"":pl.tone==="warn"?"warn":"")+'" style="margin-top:8px"><strong>Verdict:</strong> '+pl.verdict+(pl.adrLiftPct!=null?(' <span class="muted small">(needs ~'+fmtPct(pl.adrLiftPct,1)+' ADR lift at current occupancy.)</span>'):'')+'</div>'));
  } else if(m.noiLift&&m.noiLift.alreadyMeets){
    diag.appendChild(el('<div class="callout small">At current NOI, the property already appears to support the current balance under the assumed refinance terms. Any issue is more likely timing, rate, or capex than operating performance.</div>'));
  }
  app.appendChild(diag);

  // capital stack & risk detail (shown only when there's structure/exposure context)
  var stackCard=renderStackRisk(m);
  if(stackCard) app.appendChild(stackCard);

  // fixes
  var fixes=el('<div class="card"></div>');
  fixes.appendChild(el('<div class="section-h"><h2>Most relevant paths</h2></div>'));
  fixes.appendChild(el('<p class="section-sub">Ranked for your situation. Each shows what it solves, what it doesn’t, and the trade-offs.</p>'));
  var ftw=el('<div style="overflow-x:auto"><table><tr><th>Option</th><th>Solves</th><th>Doesn’t solve</th><th>Control</th><th>Complexity</th><th>Best fit</th></tr></table></div>');
  var tbl=ftw.querySelector("table");
  relevantOptions(m).forEach(function(o){tbl.appendChild(el('<tr><td><strong>'+o.n+'</strong></td><td class="small">'+o.solves+'</td><td class="small muted">'+o.notsolve+'</td><td class="small">'+o.control+'</td><td class="small">'+o.complexity+'</td><td class="small">'+o.fit+'</td></tr>'));});
  fixes.appendChild(ftw);
  if(m.liquidity!=null&&m.refiGap!=null&&m.refiGap>0&&m.liquidity<m.refiGap)fixes.appendChild(el('<p class="small muted" style="margin-top:8px">Note: paydown/equity options are ranked here, but your indicated cash ('+fmtMoney(m.liquidity)+') is below the estimated shortfall ('+fmtMoney(m.refiGap)+'), so they likely need to be combined with operational improvement or outside capital.</p>'));
  app.appendChild(fixes);

  app.appendChild(renderScenario(m));

  if(m.rateShock){
    var rs=el('<div class="card"></div>');rs.appendChild(el('<div class="section-h"><h2>Rate-shock sensitivity</h2></div>'));
    rs.appendChild(el('<p class="section-sub">What happens to coverage if your rate moves higher.</p>'));
    var rt=el('<table><tr><th>Rate</th><th class="num">Annual debt service</th><th class="num">DSCR</th></tr></table>');
    m.rateShock.forEach(function(r,i){rt.appendChild(el('<tr><td>'+fmtPct(r.ratePct,2)+(i===0?' (current)':'')+'</td><td class="num">'+fmtMoney(r.annualDebtService)+'</td><td class="num">'+fmtX(r.dscr)+'</td></tr>'));});
    rs.appendChild(rt);app.appendChild(rs);
  }

  var conf=el('<div class="card"></div>');conf.appendChild(el('<div class="section-h"><h2>Confidence by section</h2></div>'));
  conf.appendChild(el('<p class="section-sub">Based on how complete your inputs are — not on whether the result is good or bad.</p>'));
  var cg=el('<div class="grid2"></div>');
  [["operating","Operating / NOI"],["debt","Debt & coverage"],["stack","Structure & risk"],["capex","Capital & cash"]].forEach(function(p){var c=sectionConfidence(p[0]);cg.appendChild(el('<div><div style="display:flex;justify-content:space-between"><span class="small"><strong>'+p[1]+'</strong></span><span class="pill"><span class="dot '+c.tone+'"></span>'+c.label+'</span></div><div class="confbar"><span style="width:'+c.pct+'%;background:var(--'+c.tone+')"></span></div></div>'));});
  conf.appendChild(cg);app.appendChild(conf);

  app.appendChild(renderChecklist(m));

  var al=el('<details class="acc"><summary>Assumptions used <span class="pill">'+m.assumptions.length+'</span></summary><div class="body"></div></details>');
  var alb=al.querySelector(".body");
  if(m.assumptions.length){var ul2=el('<ul class="assumption-log"></ul>');m.assumptions.forEach(function(a){ul2.appendChild(el('<li>'+a+'</li>'));});alb.appendChild(ul2);}else alb.appendChild(el('<p class="small muted">No assumptions needed — you provided the key inputs directly.</p>'));
  alb.appendChild(el('<p class="small muted" style="margin-top:8px">Values marked <span class="tag estimated">estimated</span> or <span class="tag range">range</span> are treated as approximate. Skipped or unknown values reduce confidence and may make the result not lender-ready.</p>'));
  app.appendChild(al);

  app.appendChild(renderLenderPrep(m));
  app.appendChild(renderExportBar(m));
  app.appendChild(renderCTA(m));
  app.appendChild(disclaimerCard());
  var nav=el('<div class="navbtns no-print"><button class="btn ghost">← Edit inputs</button><span></span></div>');
  nav.querySelector("button").onclick=function(){S.step=getSteps().length-1;render();};
  app.appendChild(nav);
  syncTopbar();
}
function bindingLabel(b){return b==="dscr"?"DSCR test":b==="debtYield"?"debt-yield test":b==="ltv"?"LTV test":b||"—";}
function distributionLeverRows(m,nl){
  if(m.roomRevenue==null)return "";
  var rows="";
  if(m.otaComm!=null){
    var dc=m.directCost!=null?m.directCost:DEF.directCost, spread=m.otaComm-dc;
    if(spread>0){
      var pts=nl.noiLift/(m.roomRevenue*spread/100);
      var feasible=m.otaShare==null||pts<=m.otaShare;
      rows+='<tr><td>…or shift bookings OTA→direct by <span class="muted">(spread '+fmtPct(spread,0)+')</span></td><td class="num">+'+fmtPct(pts,1)+' pts'+(!feasible?' <span class="muted">(exceeds your '+fmtPct(m.otaShare,0)+' OTA share — needs other levers too)</span>':'')+'</td></tr>';
    }
  }
  if(m.otaShare!=null&&m.otaShare>0){
    var ptsC=nl.noiLift/((m.otaShare/100)*m.roomRevenue);
    rows+='<tr><td>…or negotiate OTA commission down by</td><td class="num">'+(ptsC>15?'&gt;15 pts (not realistic alone)':'+'+fmtPct(ptsC,1)+' pts')+'</td></tr>';
  }
  return rows;
}

function renderScenario(baseM){
  var card=el('<div class="card no-print"></div>');
  card.appendChild(el('<div class="section-h"><h2>Scenario workbench</h2></div>'));
  card.appendChild(el('<p class="section-sub">Test levers and watch cash flow, coverage, and the refinance gap move in real time.</p>'));
  var grid=el('<div class="grid2"></div>'),left=el('<div></div>'),right=el('<div></div>');
  function slider(key,label,min,max,step,val,suffix){var s=el('<div class="slider"></div>');s.innerHTML='<label><span>'+label+'</span><span id="lab_'+key+'">'+val+suffix+'</span></label><input type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'">';s.querySelector("input").oninput=function(e){scenarioState[key]=parseFloat(e.target.value);document.getElementById("lab_"+key).textContent=e.target.value+suffix;recalcScenario();};return s;}
  left.appendChild(slider("adrPct","ADR increase",0,30,1,scenarioState.adrPct,"%"));
  left.appendChild(slider("occPct","Occupancy / demand lift",0,30,1,scenarioState.occPct,"%"));
  left.appendChild(slider("expenseCut","Expense reduction ($/yr)",0,1000000,25000,scenarioState.expenseCut,""));
  left.appendChild(slider("shiftToDirect","Shift OTA→direct (points)",0,40,1,scenarioState.shiftToDirect,""));
  right.appendChild(slider("commissionCut","Cut OTA commission (points)",0,10,0.5,scenarioState.commissionCut,""));
  right.appendChild(slider("refiRate","Refinance rate",5,11,0.25,scenarioState.refiRate,"%"));
  right.appendChild(slider("equity","Equity injection / paydown ($)",0,10000000,250000,scenarioState.equity,""));
  var ioWrap=el('<div class="slider"><label><span>Interest-only period</span><span></span></label></div>');
  var ioBtn=el('<button class="btn ghost sm">'+(scenarioState.io?"On":"Off")+'</button>');if(scenarioState.io)ioBtn.classList.add("dark");
  ioBtn.onclick=function(){scenarioState.io=!scenarioState.io;ioBtn.textContent=scenarioState.io?"On":"Off";ioBtn.classList.toggle("dark",scenarioState.io);recalcScenario();};
  ioWrap.appendChild(ioBtn);right.appendChild(ioWrap);
  grid.appendChild(left);grid.appendChild(right);card.appendChild(grid);
  card.appendChild(el('<div class="scenario-out" id="scenarioOut"></div>'));
  var reset=el('<button class="btn ghost sm" style="margin-top:12px">Reset scenario</button>');reset.onclick=function(){scenarioState={applied:false,adrPct:0,occPct:0,expenseCut:0,shiftToDirect:0,commissionCut:0,refiRate:DEF.refiRateMid,io:false,equity:0};render();};
  card.appendChild(reset);
  setTimeout(recalcScenario,0);
  return card;
}
function recalcScenario(){
  var out=document.getElementById("scenarioOut");if(!out)return;
  scenarioState.applied=true;
  var base=compute(), sc=compute(scenarioState);
  var baseGap=base.refiGap, scGap=sc.refiGap;
  if(scGap!=null)scGap=scGap-(scenarioState.equity||0);
  function cell(lab,b,s,fmt,better){var arrow=(s==null||b==null)?"":(s>b?"▲":s<b?"▼":"=");var good=better==="up"?(s>b):(s<b);var tone=(s==null||b==null||s===b)?"muted":(good?"good":"critical");return '<div class="metric"><div class="lab">'+lab+'</div><div class="val">'+fmt(s)+'</div><div class="sub" style="color:var(--'+tone+')">'+arrow+' was '+fmt(b)+'</div></div>';}
  out.innerHTML=
    cell("Cash after debt",base.cashAfterDebt,sc.cashAfterDebt,function(v){return v==null?"—":fmtMoney(v);},"up")+
    cell("DSCR",base.dscr,sc.dscr,fmtX,"up")+
    cell("Refinance gap",baseGap,scGap,function(v){return v==null?"—":fmtMoney(v);},"down");
}

function renderChecklist(m){
  var card=el('<div class="card"></div>');card.appendChild(el('<div class="section-h"><h2>What would improve this analysis</h2></div>'));
  function bucket(title,items){if(!items.length)return null;var d=el('<div></div>');d.appendChild(el('<p class="small" style="margin:8px 0 4px"><strong>'+title+'</strong></p>'));var ul=el('<ul class="checklist small"></ul>');items.forEach(function(it){ul.appendChild(el('<li>'+it+'</li>'));});d.appendChild(ul);return d;}
  var required=[],useful=[];
  function lbl(key){return FIELDS[key].label.split("?")[0];}
  function miss(key){var st=statusOf(key);return st==="skipped"||st==="unknown"||valOf(key)==null;}
  [["loanBalance","latest lender statement"],["maturity","loan agreement"],["noi","T-12 P&L / trailing operating statement"],["monthlyPayment","monthly lender statement"]].forEach(function(p){if(miss(p[0]))required.push(lbl(p[0])+" — "+p[1]);});
  [["rate","promissory note or statement"],["pip","brand letter / franchise agreement"],["occ","STR report or PMS"],["adr","STR report or PMS"],["liquidity","your own cash position"],["marketPosition","STR comp report"]].forEach(function(p){if(miss(p[0]))useful.push(lbl(p[0])+" — "+p[1]);});
  var lender=["Full T-12 operating statement","Debt schedule / loan agreement","Capex / PIP plan","Recent appraisal (if available)","Borrower liquidity & guarantor info","Market narrative"];
  var b1=bucket("Required to improve accuracy",required.length?required:["You’ve provided the core inputs — nice."]);
  var b2=bucket("Useful but optional",useful);var b3=bucket("Needed for a lender-ready analysis",lender);
  if(b1)card.appendChild(b1);if(b2)card.appendChild(b2);if(b3)card.appendChild(b3);
  if(required.length||overallConfidence().pct<70)card.appendChild(el('<div class="callout warn small" style="margin-top:10px">This result is directionally useful but <strong>not lender-ready</strong> until the required items above are confirmed.</div>'));
  return card;
}
function renderLenderPrep(m){
  var d=el('<details class="acc"><summary>Lender conversation prep</summary><div class="body"></div></details>');var b=d.querySelector(".body");
  var asks=[],k=m.triage.primary.key;
  if(k==="maturity"){asks.push("A maturity extension (state the length you need and why).");asks.push("A short interest-only period while you execute a plan.");}
  if(k==="operations"||k==="rate"){asks.push("A temporary interest-only period to rebuild coverage.");asks.push("A covenant waiver or reset if you’re close to a breach.");}
  if(k==="stack"){asks.push("A refinance discussion at realistic proceeds.");asks.push("A principal paydown structure that unlocks better terms.");}
  if(k==="capex")asks.push("A capex reserve modification or phased PIP timeline.");
  asks.push("Time to deliver a credible operating plan before any hard decision.");
  b.innerHTML='<p class="small"><strong>Your narrative (one paragraph):</strong> The property '+(m.dscr!=null&&m.dscr>=1?'currently covers debt service':'is under coverage pressure')+', the primary issue is '+m.triage.primary.title.toLowerCase()+', and you have a specific, time-bound plan to address it. You are coming to the lender early and with numbers.</p><p class="small" style="margin-bottom:4px"><strong>Reasonable requests to discuss:</strong></p>';
  var ul=el('<ul class="checklist small"></ul>');asks.forEach(function(a){ul.appendChild(el('<li>'+a+'</li>'));});b.appendChild(ul);
  b.appendChild(el('<p class="small" style="margin-bottom:4px"><strong>Documents to bring:</strong> T-12, debt schedule, 12-month forecast, capex/PIP plan, and a short market narrative.</p>'));
  b.appendChild(el('<p class="small" style="margin-bottom:4px"><strong>Questions to ask the lender:</strong> What coverage and debt yield do you need at renewal? What would an extension require? Is there appetite for interest-only? What paydown would change the terms?</p>'));
  b.appendChild(el('<div class="callout warn small">This is conversation preparation, not legal advice. Loan modifications and forbearance have legal and credit consequences — involve your attorney and CPA before signing anything.</div>'));
  return d;
}
function renderExportBar(m){
  var card=el('<div class="card no-print"></div>');card.appendChild(el('<div class="section-h"><h2>Take it with you</h2></div>'));
  card.appendChild(el('<p class="section-sub">Generate an owner memo you can save, print, or share with an advisor. Marked clearly as prepared from your inputs and estimates.</p>'));
  var row=el('<div style="display:flex;gap:12px;flex-wrap:wrap"></div>');
  var dl=el('<button class="btn primary">Download owner memo (.html)</button>');dl.onclick=function(){downloadMemo(m);};
  var pr=el('<button class="btn dark">Print / Save as PDF</button>');pr.onclick=function(){openMemoPrint(m);};
  row.appendChild(dl);row.appendChild(pr);card.appendChild(row);return card;
}
function renderCTA(m){
  var pl=opsPlausibility(m), opsFixable=pl&&(pl.tone==="good"||pl.tone==="ok");
  var msg=opsFixable
    ? "Your diagnostic suggests the debt problem may be partly solvable through NOI improvement. MHS can help build the commercial recovery plan: pricing, channel mix, OTA strategy, group sales, direct booking, and acquisition efficiency."
    : "Your diagnostic suggests this is primarily a capital-stack problem. MHS can help prepare the operating narrative and commercial improvement plan to strengthen your lender conversation — though you may also need a lender, broker, attorney, or capital advisor.";
  var band=el('<div class="cta-band no-print"><h3>Want a second set of eyes?</h3><p>'+msg+'</p><button class="btn" style="background:#fff;color:var(--navy)">Book a consultation with MHS</button></div>');
  band.querySelector("button").onclick=function(){alert("In the live product this opens MHS scheduling. (Placeholder in this prototype.)");};
  return band;
}

/* ---------- MEMO ---------- */
function memoHTML(m){
  var name=(S.anon||!S.propertyName)?"Subject hotel (anonymous)":S.propertyName;
  var date=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
  function row(a,b){return '<tr><td>'+a+'</td><td style="text-align:right">'+b+'</td></tr>';}
  var nl=m.noiLift&&!m.noiLift.alreadyMeets?m.noiLift:null;
  var pl=opsPlausibility(m);
  var assumptions=m.assumptions.map(function(a){return '<li>'+a+'</li>';}).join("")||"<li>Core inputs provided directly.</li>";
  var opts=relevantOptions(m).map(function(o){return '<li><strong>'+o.n+'</strong> — solves: '+o.solves+'; doesn’t solve: '+o.notsolve+'; control: '+o.control+'; best fit: '+o.fit+'.</li>';}).join("");
  var conf=overallConfidence();
  var g=m.refiGapObj;
  return ''+
  '<div style="max-width:760px;margin:0 auto;font-family:Georgia,\'Times New Roman\',serif;color:#16242c;line-height:1.55">'+
  '<div style="border-bottom:3px solid #1f8a8a;padding-bottom:10px;margin-bottom:18px"><div style="font-family:Arial,sans-serif;font-weight:800;letter-spacing:.04em;color:#0e2a3b">MODERN HOSPITALITY SOLUTIONS</div><div style="font-family:Arial,sans-serif;color:#5d7079;font-size:13px">Hotel Capital Stack Diagnostic — Owner Memo</div></div>'+
  '<p style="font-size:13px;color:#5d7079">'+name+' · Prepared '+date+'</p>'+
  '<h2 style="color:#0e2a3b">1. Situation summary</h2><p>After debt service, the property generates about <strong>'+fmtMoney(m.cashAfterDebt)+'/yr</strong> (DSCR '+fmtX(m.dscr)+' vs. a '+fmtX(m.targetDSCR)+' target). The primary issue appears to be <strong>'+m.triage.primary.title.toLowerCase()+'</strong>. '+m.triage.primary.detail+'</p>'+
  '<h2 style="color:#0e2a3b">2. Current debt health</h2><table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">'+row("Cash after debt service",fmtMoney(m.cashAfterDebt))+row("Current DSCR",fmtX(m.dscr))+row("Annual debt service",fmtMoney(m.annualDebtService))+row("Debt yield",m.debtYield!=null?fmtPct(m.debtYield,1):"—")+row("Maturity risk",m.maturityRisk.score+(m.months!=null?(" ("+m.months+" mo)"):""))+'</table>'+
  '<h2 style="color:#0e2a3b">3. Operating performance</h2><p>Estimated NOI '+fmtMoney(m.noi)+(m.noiSrc?(" ("+m.noiSrc+")"):"")+'. '+(m.occ!=null?("Occupancy ~"+fmtPct(m.occ,0)+", "):"")+(m.adr!=null?("ADR ~"+fmtMoney(m.adr)+". "):"")+(get("noiBasis").value==="No / not sure"?"<em>Note: NOI may not yet reflect a management fee and reserve and could be overstated.</em>":"")+'</p>'+
  '<h2 style="color:#0e2a3b">4. Capital needs</h2><p>Identified capital need '+fmtMoney(m.capexTotal)+' ('+m.capexPressure.score+' pressure). Net of reserves: '+fmtMoney(m.capexNet)+'.'+(m.liquidity!=null?(' Owner indicates ~'+fmtMoney(m.liquidity)+' of injectable cash.'):'')+'</p>'+
  '<h2 style="color:#0e2a3b">5. Refinance readiness</h2><table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">'+row("Supportable new debt",m.supportable.loan!=null?fmtMoney(m.supportable.loan):"—")+(g?row("Total needed at maturity (incl. capex & costs)",fmtMoney(g.uses)):"")+row("Refinance gap",m.refiGap!=null?fmtMoney(m.refiGap)+(m.refiGap>0?" (shortfall)":" (surplus)"):"—")+row("Required NOI to refinance",fmtMoney(m.requiredNOItoRefi))+'</table>'+
  (nl?('<h2 style="color:#0e2a3b">6. Operational fix potential</h2><p>To support the current balance, NOI would need to rise by <strong>'+fmtMoney(nl.noiLift)+'</strong> — roughly '+fmtMoney(nl.annualRevenueIncrease)+' of incremental revenue'+(nl.adrIncreaseAtCurrentOcc!=null?(', equivalent to +'+fmtMoney(nl.adrIncreaseAtCurrentOcc)+' ADR at current occupancy'):"")+(nl.occPointIncreaseAtCurrentADR!=null?(', or +'+fmtPct(nl.occPointIncreaseAtCurrentADR,1)+' occupancy points at current ADR'):"")+'.'+(pl?(' <strong>'+pl.verdict+'</strong>'):'')+'</p>'):"")+
  '<h2 style="color:#0e2a3b">7. Recommended next steps</h2><ul>'+opts+'</ul>'+
  '<h2 style="color:#0e2a3b">8. What would improve this analysis</h2><p style="font-size:14px">Confirm loan balance, maturity date, T-12 NOI, and PIP requirement. For a lender-ready package: full T-12, debt schedule, capex plan, appraisal, and borrower liquidity.</p>'+
  (function(){var parts="";
    if(m.stack&&m.stack.value!=null){parts+='<p>Capital stack at an estimated value of '+fmtMoney(m.stack.value)+': '+(m.stack.sponsorStatus==="wiped"?'common equity is underwater (debt/pref exceed value).':'value can fall ~'+Math.round(m.stack.equityCushionPct)+'% before equity is wiped.')+' '+m.stack.layers.map(function(l){return l.name+' '+l.status;}).join('; ')+'.</p>';}
    if(m.exposure)parts+='<p>Personal exposure — '+m.exposure.title+': '+m.exposure.flags.join(' ')+'</p>';
    if(m.lenderType&&LOAN_PROFILES[m.lenderType]){var p=LOAN_PROFILES[m.lenderType];parts+='<p>Loan type ('+m.lenderType+') — watch: '+p.risks.join('; ')+'. Tactics: '+p.tactics.join('; ')+'.</p>';}
    return parts?('<h2 style="color:#0e2a3b">9. Capital stack &amp; exposure</h2>'+parts):"";})()+
  '<h2 style="color:#0e2a3b">10. Assumptions used</h2><ul style="font-size:14px">'+assumptions+'</ul><p style="font-size:13px;color:#5d7079"><em>Overall confidence: '+conf.label+' ('+conf.pct+'%), based on data completeness.</em></p>'+
  '<h2 style="color:#0e2a3b">11. Disclaimer</h2><p style="font-size:12px;color:#5d7079;background:#f5f7f8;padding:12px;border-radius:8px">Prepared from user-provided and estimated information. This memo is a diagnostic and planning aid only — not financial, legal, tax, lending, or investment advice, and not a lending commitment. Figures may be estimates or ranges. Verify all numbers and consult your lender, CPA, attorney, broker, or capital advisor before making decisions.</p>'+
  '<p style="font-size:11px;color:#9aa6ad;text-align:center;margin-top:20px">Watermark: Prepared from user-provided and estimated information · Modern Hospitality Solutions</p></div>';
}
function downloadMemo(m){var html='<!DOCTYPE html><html><head><meta charset="utf-8"><title>MHS Owner Memo</title></head><body style="margin:30px">'+memoHTML(m)+'</body></html>';var blob=new Blob([html],{type:"text/html"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="MHS-Owner-Memo.html";document.body.appendChild(a);a.click();a.remove();}
function openMemoPrint(m){var w=window.open("","_blank");if(!w){alert("Pop-up blocked — allow pop-ups or use the download button.");return;}w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>MHS Owner Memo</title></head><body style="margin:30px">'+memoHTML(m)+'<scr'+'ipt>window.onload=function(){setTimeout(function(){window.print();},250);}</scr'+'ipt></body></html>');w.document.close();}

/* ---------- PRIVACY ---------- */
function openPrivacy(){
  var root=document.getElementById("modalRoot"), saved=hasSaved();
  var bg=el('<div class="modal-bg"></div>'),mod=el('<div class="modal"></div>');
  mod.innerHTML='<h3 style="color:var(--navy)">Your privacy</h3>'+
    '<p class="small">By default this tool runs <strong>only in your browser</strong>. Nothing you type is uploaded or sent anywhere, and nothing is used to train any model.</p>'+
    '<div class="checkrow"><input type="checkbox" id="anonChk" '+(S.anon?"checked":"")+'><label for="anonChk" class="small"><strong>Anonymous mode</strong> — don’t ask for or show a property name anywhere, including the memo.</label></div>'+
    '<div class="checkrow"><input type="checkbox" id="saveChk" '+(saved?"checked":"")+'><label for="saveChk" class="small"><strong>Save my progress on this browser</strong> (optional) — stores answers locally on this device only; never uploaded.</label></div>'+
    (S.anon?"":'<div class="field" style="margin-top:8px"><label class="small">Property name (optional, only used on the memo)</label><input type="text" id="propName" value="'+(S.propertyName||"")+'" placeholder="Leave blank to stay anonymous"></div>')+
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><button class="btn primary sm" id="privSave">Save settings</button><button class="btn ghost sm" id="privDelete">Delete all my data</button><button class="btn ghost sm" id="privClose">Close</button></div>'+
    '<p class="small muted" style="margin-top:12px">A plain-English data policy is included in <strong>data-retention-policy.md</strong>.</p>';
  bg.appendChild(mod);root.appendChild(bg);
  bg.onclick=function(e){if(e.target===bg)root.innerHTML="";};
  mod.querySelector("#anonChk").onchange=function(e){S.anon=e.target.checked;root.innerHTML="";openPrivacy();syncTopbar();};
  mod.querySelector("#privClose").onclick=function(){root.innerHTML="";};
  mod.querySelector("#privSave").onclick=function(){S.anon=mod.querySelector("#anonChk").checked;var pn=mod.querySelector("#propName");if(pn)S.propertyName=pn.value;if(mod.querySelector("#saveChk").checked)saveLocal();else clearLocal();root.innerHTML="";syncTopbar();render();};
  mod.querySelector("#privDelete").onclick=function(){clearLocal();S={mode:S.mode,anon:false,step:0,propertyName:"",f:{}};root.innerHTML="";render();alert("All locally stored data has been deleted and your session has been reset.");};
}
function saveLocal(){try{localStorage.setItem(SAVE_KEY,JSON.stringify({anon:S.anon,propertyName:S.propertyName,f:S.f,mode:S.mode}));}catch(e){}}
function clearLocal(){try{localStorage.removeItem(SAVE_KEY);}catch(e){}}
function hasSaved(){try{return !!localStorage.getItem(SAVE_KEY);}catch(e){return false;}}
function loadLocal(){try{var raw=localStorage.getItem(SAVE_KEY);if(!raw)return;var o=JSON.parse(raw);S.anon=!!o.anon;S.propertyName=o.propertyName||"";S.f=o.f||{};if(o.mode)S.mode=o.mode;}catch(e){}}

/* ---------- router ---------- */
function render(){
  if(hasSaved())saveLocal();
  if(S.step===0){renderLanding();return;}
  if(S.mode==="quick"){ if(S.step>=2){renderQuick();} else {renderQuick();} window.scrollTo({top:0,behavior:"smooth"}); return; }
  renderStep();
  window.scrollTo({top:0,behavior:"smooth"});
}

/* ---------- init ---------- */
document.querySelectorAll("#modeswitch button").forEach(function(b){b.onclick=function(){S.mode=b.dataset.mode;S.step=Math.max(1,S.step);if(S.mode==="quick")S.step=1;syncTopbar();render();};});
document.getElementById("privacyBtn").onclick=openPrivacy;
loadLocal();render();
})();
