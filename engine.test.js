var E = require("./engine.js");
var fails = 0;
function ok(name, cond, got) {
  if (cond) { console.log("  PASS " + name); }
  else { console.log("  FAIL " + name + "  (got: " + JSON.stringify(got) + ")"); fails++; }
}
function near(a, b, tol) { return a != null && Math.abs(a - b) <= (tol == null ? 0.01 : tol); }

console.log("DSCR & required NOI (doc examples)");
ok("required NOI = 800k * 1.25 = 1,000,000", near(E.requiredNOI(800000, 1.25), 1000000), E.requiredNOI(800000,1.25));
var d = E.dscr(896000, 800000);
ok("DSCR 896k/800k = 1.12x", near(d, 1.12, 0.001), d);
ok("dscr band thin for 1.12", E.dscrBand(1.12).tone === "warn", E.dscrBand(1.12));
ok("dscr band critical for 0.95", E.dscrBand(0.95).tone === "critical", E.dscrBand(0.95));

console.log("Loan constant & ADS");
var k = E.loanConstant(7.5, 25, false);
ok("loan constant 7.5%/25yr ~0.0887", near(k, 0.0887, 0.001), k);
var io = E.loanConstant(7.5, 25, true);
ok("interest-only constant = rate 0.075", near(io, 0.075, 0.0001), io);
var ads = E.annualDebtServiceFromLoan(10000000, 7.5, 25, false);
ok("ADS on $10M ~ $887k", near(ads, 887000, 5000), ads);

console.log("Supportable loan (binding constraint)");
var s = E.supportableLoan({ noi: 1000000, targetDSCR: 1.25, refiRatePct: 7.5, amortYears: 25, minDebtYieldPct: 9, maxLTVPct: 65, value: 14000000 });
// DSCR test: ADSmax=800k; loan=800k/0.0887 ~ 9.02M
// DY test: 1,000,000/0.09 = 11.11M ; LTV: 0.65*14M=9.1M -> binding = DSCR ~9.0M
ok("supportable loan binding is DSCR", s.binding === "dscr", s);
ok("supportable loan ~ $9.0M", near(s.loan, 9020000, 100000), s.loan);

console.log("Refinance gap (sources & uses)");
var gapO = E.refinanceGap({ balance: 11000000, supportableProceeds: s.loan, refiCostPct: 1.5, netCapex: 1000000, prepay: 0 });
ok("refi gap positive (shortfall)", gapO.gap > 0, gapO);
ok("uses include balance + capex + costs", near(gapO.uses, 11000000 + 1000000 + s.loan*0.015, 1), gapO.uses);
var gapBase = E.refinanceGap({ balance: 11000000, supportableProceeds: s.loan });
ok("gap with no capex/costs = balance - proceeds", near(gapBase.gap, 11000000 - s.loan, 1), gapBase.gap);

console.log("Required NOI to refinance (binding-aware)");
var rno = E.requiredNOIToRefinance({ balance: 11000000, refiRatePct: 7.5, amortYears: 25, targetDSCR: 1.25, minDebtYieldPct: 9.5 });
// DSCR-implied: 11M*0.0887*1.25 ~ 1.219M ; DY-implied: 11M*0.095 = 1.045M -> max = DSCR
ok("required NOI to refi takes the binding (max) test", near(rno.value, Math.max(11000000*E.loanConstant(7.5,25)*1.25, 11000000*0.095), 100), rno.value);
ok("binding is dscr here", rno.binding === "dscr", rno);

console.log("Cash after debt service (plain dollars)");
ok("cash after debt = NOI - ADS", near(E.cashAfterDebt(1000000, 800000), 200000), E.cashAfterDebt(1000000,800000));
ok("negative when uncovered", E.cashAfterDebt(700000, 800000) < 0, E.cashAfterDebt(700000,800000));

console.log("Per-lever flow-through");
var pl = E.noiLiftTranslation({ currentNOI: 900000, targetNOI: 1000000, rooms: 120, occPct: 70, adr: 150 });
// ADR uses 90% flow-through, occupancy uses 65% -> occupancy rooms-rev requirement is larger
var adrRoomsRev = 100000/0.90, occRoomsRev = 100000/0.65;
ok("ADR lever uses higher flow-through than occupancy", occRoomsRev > adrRoomsRev, {adrRoomsRev:adrRoomsRev, occRoomsRev:occRoomsRev});
ok("ADR increase = (lift/0.90)/(rooms*365*occ)", near(pl.adrIncreaseAtCurrentOcc, (100000/0.90)/(120*365*0.70), 0.01), pl.adrIncreaseAtCurrentOcc);
ok("occ points = (lift/0.65)/(adr*rooms*365)*100", near(pl.occPointIncreaseAtCurrentADR, (100000/0.65)/(150*120*365)*100, 0.01), pl.occPointIncreaseAtCurrentADR);

console.log("NOI lift translation");
var t = E.noiLiftTranslation({ currentNOI: 904000, targetNOI: 1000000, rooms: 120, occPct: 70, adr: 150, flowThroughPct: 55 });
ok("noi lift = 96,000", near(t.noiLift, 96000, 1), t.noiLift);
ok("revenue increase = 96000/0.55 ~ 174,545", near(t.annualRevenueIncrease, 174545, 5), t.annualRevenueIncrease);
ok("revpar increase = rev/(120*365)", near(t.revparIncrease, 174545/(120*365), 0.01), t.revparIncrease);
ok("adr increase at 70% occ positive", t.adrIncreaseAtCurrentOcc > 0, t.adrIncreaseAtCurrentOcc);
ok("occ point increase at current adr positive", t.occPointIncreaseAtCurrentADR > 0, t.occPointIncreaseAtCurrentADR);
ok("expense reduction = noi lift", near(t.expenseReduction, 96000, 1), t.expenseReduction);
var t2 = E.noiLiftTranslation({ currentNOI: 1200000, targetNOI: 1000000 });
ok("already meets when current>target", t2.alreadyMeets === true, t2);

console.log("Distribution: actuals-based flow-through");
var fa = E.flowThroughFromActuals({ otaSharePct: 60, otaCommissionPct: 20, cpor: 35, adr: 150 });
// blendedComm = 0.60*20 = 12 -> adrFlow = 88
ok("ADR flow-through = 100 - (otaShare*comm)", near(fa.adrFlow, 88, 0.01), fa.adrFlow);
// occFlow = 100 - 12 - (35/150*100=23.33) = 64.67
ok("occ flow-through nets CPOR too", near(fa.occFlow, 100-12-(35/150*100), 0.01), fa.occFlow);
ok("100% direct => ADR flow-through 100%", near(E.flowThroughFromActuals({otaSharePct:0,otaCommissionPct:20}).adrFlow,100), null);
ok("null when mix missing", E.flowThroughFromActuals({adr:150})===null, null);

console.log("Distribution: channel shift uses the spread, not full commission");
var cs = E.channelShiftBenefit({ points: 10, roomRevenue: 3000000, otaCommissionPct: 22, directCostPct: 7 });
// 0.10 * 3,000,000 * (15/100) = 45,000
ok("shift 10 pts OTA->direct on $3M = spread benefit", near(cs, 0.10*3000000*0.15, 1), cs);
var csFull = E.channelShiftBenefit({ points: 10, roomRevenue: 3000000, otaCommissionPct: 22, directCostPct: 0 });
ok("spread benefit < full-commission benefit", cs < csFull, {cs:cs, csFull:csFull});

console.log("Distribution: commission cut applies only to OTA portion");
var cc = E.commissionCutBenefit({ points: 4, roomRevenue: 3000000, otaSharePct: 60 });
// 0.04 * 0.60 * 3,000,000 = 72,000
ok("cut 4 pts on 60% OTA book of $3M = 72,000", near(cc, 0.04*0.60*3000000, 1), cc);

console.log("Capital stack waterfall");
var st = E.capitalStack({ value: 14000000, layers: [
  {name:"Senior", kind:"debt", amount:10000000},
  {name:"Mezzanine", kind:"debt", amount:2000000},
  {name:"Preferred", kind:"pref", amount:1000000}
]});
ok("3 layers", st.layers.length===3, st.layers.length);
ok("senior fully covered at $14M", st.layers[0].status==="covered", st.layers[0]);
ok("pref covered (value 14 > 13 stack)", st.layers[2].status==="covered", st.layers[2]);
ok("common equity = value - stack = 1,000,000", near(st.commonEquity,1000000), st.commonEquity);
ok("equity cushion % = 1M/14M", near(st.equityCushionPct, 1000000/14000000*100, 0.01), st.equityCushionPct);

var st2 = E.capitalStack({ value: 11000000, layers: [
  {name:"Senior", kind:"debt", amount:10000000},
  {name:"Mezzanine", kind:"debt", amount:2000000},
  {name:"Preferred", kind:"pref", amount:1000000}
]});
ok("at $11M senior still covered", st2.layers[0].status==="covered", st2.layers[0].status);
ok("mezz impaired (recovers 1M of 2M)", st2.layers[1].status==="impaired" && near(st2.layers[1].recovery,1000000), st2.layers[1]);
ok("pref wiped at $11M", st2.layers[2].status==="wiped", st2.layers[2].status);
ok("common equity wiped (0) at $11M", st2.commonEquity===0, st2.commonEquity);
ok("sponsor status wiped", st2.sponsorStatus==="wiped", st2.sponsorStatus);
ok("senior attach LTV 0, detach ~71%", near(st2.layers[0].detachLTV, 10000000/11000000*100, 0.01), st2.layers[0].detachLTV);

console.log("Rate shock");
var rs = E.rateShock({ balance: 10000000, amortYears: 25, noi: 900000, rates: [7, 8, 9] });
ok("rate shock 3 rows", rs.length === 3, rs.length);
ok("dscr falls as rate rises", rs[0].dscr > rs[2].dscr, rs.map(function(r){return r.dscr;}));

console.log("Maturity & capex");
ok("maturity 3mo critical", E.maturityRisk(3).score === "Critical", E.maturityRisk(3));
ok("maturity 12mo high", E.maturityRisk(12).score === "High", E.maturityRisk(12));
ok("maturity 48mo low", E.maturityRisk(48).score === "Low", E.maturityRisk(48));
ok("capex 2x NOI high", E.capexPressure(2000000, 1000000).score === "High", E.capexPressure(2000000,1000000));
ok("capex 0.3x NOI low", E.capexPressure(300000, 1000000).score === "Low", E.capexPressure(300000,1000000));

console.log("Confidence (completeness, not good/bad)");
var c1 = E.confidence([{weight:2,status:"known"},{weight:2,status:"known"},{weight:1,status:"known"}]);
ok("all known => High", c1.label === "High", c1);
var c2 = E.confidence([{weight:2,status:"known"},{weight:2,status:"skipped"},{weight:1,status:"estimated"}]);
ok("mixed => Medium/Low", c2.label !== "High", c2);
var c3 = E.confidence([{weight:1,status:"skipped"},{weight:1,status:"unknown"}]);
ok("all missing => Low", c3.label === "Low", c3);

console.log("Triage");
var tr = E.triage({ dscr: 0.95, targetDSCR: 1.25, refiGap: 2000000, monthsToMaturity: 4, capexRatio: 1.8, floating: true, currentRatePct: 9, currentNOI: 900000 });
ok("triage primary = operations (DSCR<1)", tr.primary.key === "operations", tr.primary);
ok("triage flags combination", tr.combination === true, tr.combination);
var tr2 = E.triage({ dscr: 1.4, targetDSCR: 1.25, refiGap: 1500000, monthsToMaturity: 5 });
ok("triage primary = maturity when imminent & coverage ok", tr2.primary.key === "maturity", tr2.primary);

console.log("\n" + (fails === 0 ? "ALL TESTS PASSED" : (fails + " TEST(S) FAILED")));
process.exit(fails === 0 ? 0 : 1);
