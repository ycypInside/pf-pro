/** Pure validation. Apps Script loads this as globals; Node tests load the same file. */

function ckRoundDigits_(n, digits) {
  var x = Number(n);
  if (!isFinite(x) || x === 0) return x === 0 ? 0 : NaN;
  var sign = x < 0 ? -1 : 1;
  var factor = Math.pow(10, digits);
  var rounded = sign * Math.round(Math.abs(x) * factor + 1e-6) / factor;
  return rounded === 0 ? 0 : rounded;
}

function ckRound2_(n) { return ckRoundDigits_(n, 2); }
function ckRound4_(n) { return ckRoundDigits_(n, 4); }

/** V2 expected TWD amount: half-up cents, with the same epsilon as round2_. */
function ckExpectTwd_(amount, fx) {
  return ckRound2_(Number(amount) * Number(fx));
}

/** V2: stored amount_twd may differ from the rounded product by at most half a cent. */
function ckAmountTwdOk_(amount, fx, amountTwd) {
  return Math.abs(Number(amountTwd) - ckExpectTwd_(amount, fx)) <= 0.005;
}

/** V2: a TWD leg uses fx 1. Other currencies are not checked here. */
function ckTwdFxOk_(currency, fx) {
  if (currency !== 'TWD') return true;
  return Number(fx) === 1;
}

/**
 * V3: same-currency legs must cancel at 4 decimal places.
 * Rounding the sum to cents hides a 0.0001 mismatch.
 */
function ckSameCurrencyOk_(currencyA, amountA, currencyB, amountB) {
  if (currencyA !== currencyB) return true;
  return ckRound4_(Number(amountA) + Number(amountB)) === 0;
}

function ckOppositeSignsOk_(amountA, amountB) {
  var a = Number(amountA);
  var b = Number(amountB);
  if (!(a > 0 || a < 0) || !(b > 0 || b < 0)) return false;
  return (a > 0) !== (b > 0);
}

/** V8: YYYY-MM-DD strings compare in calendar order. */
function ckDateOnOrAfter_(date, opening) {
  return String(date) >= String(opening);
}

/** V12: a positive investment inflow must be marked external or internal. */
function ckInvestmentInflowOk_(isInvestment, amount, txnType, flowClass) {
  var invest = isInvestment === true || String(isInvestment).toUpperCase() === 'TRUE';
  if (!invest || !(Number(amount) > 0)) return true;
  if (['transfer_in', 'fx_in', 'income'].indexOf(txnType) < 0) return true;
  return ['external', 'internal'].indexOf(flowClass) >= 0;
}

/** V10: a void needs a reason that is not only whitespace. */
function ckVoidReasonOk_(reason) {
  return String(reason == null ? '' : reason).trim().length > 0;
}
