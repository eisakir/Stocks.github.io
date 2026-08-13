const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let rows = [];
let benchmarkRows = [];
let fundamentals = null;
let ticker = 'AAPL';
let active = 'ensemble';
let source = 'DEMO';
let analysis = null;
let priceChart = null;
let equityChart = null;
let currentPaperTicket = null;
let paperTradeQueue = [];
const DEFAULT_VIRTUAL_BALANCE = 148264.79;
const LARGE_CAP_UNIVERSE = [
  'AAPL','MSFT','NVDA','AMZN','GOOGL','META','BRK-B','AVGO','TSLA','LLY',
  'JPM','WMT','V','ORCL','MA','XOM','COST','NFLX','UNH','HD',
  'PG','JNJ','ABBV','BAC','KO','CRM','PM','CVX','CSCO','IBM',
  'WFC','GE','ABT','MCD','NOW','CAT','AXP','GS','MRK','TMO',
  'ISRG','PEP','ACN','QCOM','DIS','AMD','TXN','INTU','AMGN','RTX',
  'BKNG','SPGI','PGR','AMAT','HON','NEE','LOW','DHR','PFE','UNP',
  'BLK','ETN','C','TJX','VRTX','SYK','BSX','COP','LRCX','ADP',
  'PANW','CB','SCHW','GILD','MMC','ADI','MDT','DE','SBUX','AMT',
  'PLD','BMY','BA','MO','SO','CI','KLAC','ICE','SHW','DUK',
  'CME','ZTS','MCK','CVS','USB','MDLZ','ORLY','APO','WM','EOG'
];
let universeRecommendations = [];
let universeScanRunning = false;

const average = values => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const deviation = values => {
  const mean = average(values);
  return Math.sqrt(average(values.map(value => (value - mean) ** 2)));
};
const clamp = (value, low = 0, high = 100) => Math.min(high, Math.max(low, value));
const sma = (data, length, index) => index + 1 < length ? null : average(data.slice(index - length + 1, index + 1).map(row => row.close));
const change = (data, length, index) => index < length ? 0 : data[index].close / data[index - length].close - 1;
const formatMoney = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const formatPercent = value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const formatNumber = value => Number.isFinite(value) ? value.toFixed(2) : '—';

function rsi(data, length, index) {
  if (index < length) return null;
  let gains = 0;
  let losses = 0;
  for (let cursor = index - length + 1; cursor <= index; cursor++) {
    const move = data[cursor].close - data[cursor - 1].close;
    gains += Math.max(move, 0);
    losses += Math.max(-move, 0);
  }
  if (!losses) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function atr(data, length, index) {
  if (index < length) return null;
  const ranges = [];
  for (let cursor = index - length + 1; cursor <= index; cursor++) {
    const row = data[cursor];
    const previous = data[cursor - 1].close;
    ranges.push(Math.max(row.high - row.low, Math.abs(row.high - previous), Math.abs(row.low - previous)));
  }
  return average(ranges);
}

function annualizedVolatility(data, length, index) {
  if (index < length) return 0;
  const returns = [];
  for (let cursor = index - length + 1; cursor <= index; cursor++) returns.push(Math.log(data[cursor].close / data[cursor - 1].close));
  return deviation(returns) * Math.sqrt(252) * 100;
}

function drawdown(data, length, index) {
  const peak = Math.max(...data.slice(Math.max(0, index - length + 1), index + 1).map(row => row.close));
  return (data[index].close / peak - 1) * 100;
}

function baseIndicators(data, index) {
  const s20 = sma(data, 20, index);
  const s50 = sma(data, 50, index);
  const s200 = sma(data, 200, index);
  const rsi14 = rsi(data, 14, index);
  const atr14 = atr(data, 14, index);
  if ([s20, s50, s200, rsi14, atr14].some(value => value == null)) return null;
  const closes = data.slice(index - 19, index + 1).map(row => row.close);
  const bandDeviation = deviation(closes);
  return {
    s20, s50, s200, rsi14, atr14,
    lower: s20 - 2 * bandDeviation,
    upper: s20 + 2 * bandDeviation,
    momentum63: change(data, 63, index) * 100,
    momentum126: change(data, 126, index) * 100,
    momentum252: change(data, 252, index) * 100,
    volatility20: annualizedVolatility(data, 20, index),
    drawdown252: drawdown(data, 252, index),
    slope20: index >= 20 ? (s20 / sma(data, 20, index - 20) - 1) * 100 : 0,
    slope50: index >= 20 ? (s50 / sma(data, 50, index - 20) - 1) * 100 : 0
  };
}

function matchedBenchmarkIndex(stockRow, benchmark, fallback) {
  const exact = benchmark.findIndex(row => row.date === stockRow.date);
  return exact >= 0 ? exact : Math.min(fallback, benchmark.length - 1);
}

function analyze(stockData, marketData = stockData, fundamentalData = null) {
  const index = stockData.length - 1;
  const previousIndex = index - 1;
  const latest = stockData[index];
  const values = baseIndicators(stockData, index);
  const previous = baseIndicators(stockData, previousIndex);
  if (!values || !previous) throw new Error('At least 253 valid trading days are required for the full model.');

  const marketIndex = matchedBenchmarkIndex(latest, marketData, index);
  const marketValues = baseIndicators(marketData, marketIndex) || values;
  const prior = stockData.slice(index - 20, index);
  const resistance = Math.max(...prior.map(row => row.high));
  const support = Math.min(...prior.map(row => row.low));
  const volumeAverage = average(prior.map(row => row.volume || 0));
  const volumeRatio = volumeAverage ? latest.volume / volumeAverage : 1;
  const closeLocation = (latest.close - latest.low) / Math.max(latest.high - latest.low, 0.0001);
  const relative63 = values.momentum63 - marketValues.momentum63;
  const relative126 = values.momentum126 - marketValues.momentum126;

  let regime = 'RANGE';
  if (marketValues.volatility20 > 30) regime = 'VOLATILE';
  else if (marketValues.s20 > marketValues.s50 && marketValues.s50 > marketValues.s200 && marketValues.slope50 > 0) regime = 'BULL TREND';
  else if (marketValues.s20 < marketValues.s50 && marketValues.s50 < marketValues.s200 && marketValues.slope50 < 0) regime = 'BEAR TREND';

  const trendScore = clamp(50
    + (latest.close > values.s200 ? 10 : -10)
    + (values.s20 > values.s50 ? 9 : -9)
    + clamp(values.momentum63, -20, 20) * 0.7
    + clamp(values.momentum126, -30, 30) * 0.45
    + clamp(values.slope50, -8, 8) * 1.4);
  const relativeScore = clamp(50 + clamp(relative63, -20, 20) * 1.3 + clamp(relative126, -30, 30) * 0.7);
  const bandPosition = (latest.close - values.lower) / Math.max(values.upper - values.lower, 0.0001);
  const meanScore = clamp(50 + (50 - values.rsi14) * 0.75 + (0.5 - bandPosition) * 28);
  const breakoutDistance = (latest.close - resistance) / values.atr14;
  const breakoutScore = clamp(50 + clamp(breakoutDistance, -2, 2) * 15 + (volumeRatio - 1) * 18 + (closeLocation - 0.5) * 12);
  const riskScore = clamp(100 - Math.max(0, values.volatility20 - 15) * 1.7 - Math.abs(Math.min(values.drawdown252, 0)) * 1.15);
  const validPE = value => Number.isFinite(value) && value > 0;
  const valuationInputs = [fundamentalData?.trailingPE, fundamentalData?.forwardPE, fundamentalData?.pegRatio].filter(validPE);
  const valuationAvailable = valuationInputs.length >= 2;
  const peComponent = validPE(fundamentalData?.trailingPE) ? clamp(50 + (25 - fundamentalData.trailingPE) * 1.4, 15, 85) : 50;
  const forwardComponent = validPE(fundamentalData?.forwardPE) ? clamp(50 + (22 - fundamentalData.forwardPE) * 1.6, 15, 85) : 50;
  const pegComponent = validPE(fundamentalData?.pegRatio) ? clamp(72 - (fundamentalData.pegRatio - 1) * 28, 10, 90) : 50;
  const growthPercent = Number.isFinite(fundamentalData?.earningsGrowth) ? fundamentalData.earningsGrowth * 100 : null;
  const growthQuality = growthPercent == null ? 50 : clamp(45 + growthPercent * 1.1, 15, 85);
  const forwardImprovement = validPE(fundamentalData?.trailingPE) && validPE(fundamentalData?.forwardPE) ? clamp(50 + (fundamentalData.trailingPE - fundamentalData.forwardPE) * 2, 20, 80) : 50;
  const valuationScore = valuationAvailable ? average([peComponent, forwardComponent, pegComponent, growthQuality, forwardImprovement]) : 50;

  const weightSets = {
    'BULL TREND': { trend: .25, relative: .20, mean: .08, breakout: .17, risk: .15, valuation: .15 },
    'BEAR TREND': { trend: .12, relative: .15, mean: .08, breakout: .15, risk: .30, valuation: .20 },
    'VOLATILE': { trend: .12, relative: .12, mean: .08, breakout: .18, risk: .30, valuation: .20 },
    'RANGE': { trend: .12, relative: .12, mean: .25, breakout: .12, risk: .19, valuation: .20 }
  };
  const weights = { ...weightSets[regime] };
  if (!valuationAvailable) {
    weights.valuation = 0;
    const remaining = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    Object.keys(weights).forEach(key => { weights[key] /= remaining; });
  }
  const subscores = { trend: trendScore, relative: relativeScore, mean: meanScore, breakout: breakoutScore, risk: riskScore, valuation: valuationScore };
  const ensembleScore = Object.entries(subscores).reduce((sum, [key, value]) => sum + value * weights[key], 0);
  const scoreValues = Object.values(subscores);
  const disagreement = deviation(scoreValues);
  const dataQuality = clamp(58 + Math.min(stockData.length - 253, 252) / 252 * 22 - Math.max(0, disagreement - 15) * 0.8 - (valuationAvailable ? 0 : 8));
  const confidence = Math.round(clamp(45 + Math.abs(ensembleScore - 50) * 1.1 + dataQuality * .2 - disagreement * .35, 35, 92));
  const ensembleSignal = ensembleScore >= 68 ? 'BUY' : ensembleScore <= 32 ? 'SELL' : ensembleScore >= 58 || ensembleScore <= 42 ? 'WATCH' : 'HOLD';

  const trendBuy = trendScore >= 68 && relativeScore >= 52;
  const trendSell = trendScore <= 32;
  const trendSignal = trendBuy ? 'BUY' : trendSell ? 'SELL' : trendScore >= 58 || trendScore <= 42 ? 'WATCH' : 'HOLD';
  const severeDowntrend = latest.close < values.s200 && values.s50 < values.s200 && values.slope50 < 0;
  const meanBuy = stockData[previousIndex].close < previous.lower && latest.close > values.lower && values.rsi14 < 42 && !severeDowntrend;
  const meanSell = stockData[previousIndex].close > previous.upper && latest.close < values.upper && values.rsi14 > 58;
  const meanSignal = meanBuy ? 'BUY' : meanSell ? 'SELL' : values.rsi14 < 35 || values.rsi14 > 65 ? 'WATCH' : 'HOLD';
  const breakoutBuy = latest.close > resistance + .15 * values.atr14 && volumeRatio > 1.15 && closeLocation > .6;
  const breakoutSell = latest.close < support - .15 * values.atr14 && volumeRatio > 1.15 && closeLocation < .4;
  const atrSignal = breakoutBuy ? 'BUY' : breakoutSell ? 'SELL' : Math.min(Math.abs(latest.close - resistance), Math.abs(latest.close - support)) < values.atr14 ? 'WATCH' : 'HOLD';
  const valuationSignal = !valuationAvailable ? 'WATCH' : valuationScore >= 65 && trendScore >= 55 ? 'BUY' : valuationScore <= 35 ? 'SELL' : valuationScore >= 58 || valuationScore <= 42 ? 'WATCH' : 'HOLD';

  const riskLevel = values.volatility20 > 35 || values.drawdown252 < -30 ? 'HIGH' : values.volatility20 > 24 || values.drawdown252 < -18 ? 'ELEVATED' : 'MODERATE';
  const invalidation = Math.max(support, values.s50 - values.atr14);
  const scoreLabel = ensembleScore >= 70 ? 'Strong bullish evidence' : ensembleScore >= 58 ? 'Moderately bullish' : ensembleScore <= 30 ? 'Strong bearish evidence' : ensembleScore <= 42 ? 'Moderately bearish' : 'Mixed or neutral evidence';
  const qualityLabel = !valuationAvailable ? 'Fundamental ratios missing; valuation excluded' : stockData.length >= 500 && disagreement < 22 ? 'Good history; reasonable agreement' : disagreement >= 22 ? 'Signals disagree; confidence reduced' : 'Limited history; interpret cautiously';
  const peText = validPE(fundamentalData?.trailingPE) ? fundamentalData.trailingPE.toFixed(1) : 'unavailable';
  const forwardText = validPE(fundamentalData?.forwardPE) ? fundamentalData.forwardPE.toFixed(1) : 'unavailable';
  const pegText = validPE(fundamentalData?.pegRatio) ? fundamentalData.pegRatio.toFixed(2) : 'unavailable';
  const valuationExplanation = !valuationAvailable ? 'At least two valid positive ratios are required. Negative earnings and missing analyst estimates are not interpreted as cheap.' : 'Trailing P/E is ' + peText + ', forward P/E is ' + forwardText + ', and PEG is ' + pegText + '. These are combined with earnings growth and momentum; they are not universal valuation cutoffs.';
  const reasons = [
    `${trendScore >= 55 ? 'Trend supports' : 'Trend weakens'} the case (${trendScore.toFixed(0)}/100).`,
    `${relativeScore >= 55 ? 'The stock is outperforming' : 'The stock is not outperforming'} SPY over medium horizons.`,
    `Risk conditions score ${riskScore.toFixed(0)}/100 and the current regime is ${regime.toLowerCase()}.`
  ];

  const strategies = {
    valuation: { id: 'valuation', name: 'Value + Momentum', subtitle: 'P/E + forward P/E + PEG + trend', signal: valuationSignal, confidence: valuationAvailable ? Math.round(clamp(48 + Math.abs(valuationScore - 50), 42, 88)) : 30, reason: valuationExplanation, metrics: [['Trailing P/E', fundamentalData?.trailingPE, 'ratio'], ['Forward P/E', fundamentalData?.forwardPE, 'ratio'], ['PEG ratio', fundamentalData?.pegRatio, 'ratio']] },
    ensemble: { id: 'ensemble', name: 'Quant Ensemble', subtitle: 'Regime-weighted multi-signal model', signal: ensembleSignal, confidence, reason: `${scoreLabel}. ${reasons.join(' ')}`, metrics: [['Ensemble score', ensembleScore, 'score'], ['SPY rel. 3M', relative63, 'percent'], ['Volatility 20D', values.volatility20, 'percent']] },
    trend: { id: 'trend', name: 'Trend Confirmation', subtitle: 'Multi-horizon trend + relative strength', signal: trendSignal, confidence: Math.round(clamp(45 + Math.abs(trendScore - 50), 40, 91)), reason: `Trend score is ${trendScore.toFixed(0)}/100. Price is ${latest.close > values.s200 ? 'above' : 'below'} the 200-day average, 6-month momentum is ${values.momentum126.toFixed(1)}%, and relative strength versus SPY is ${relative126.toFixed(1)}%.`, metrics: [['SMA 20', values.s20, 'money'], ['SMA 50', values.s50, 'money'], ['SMA 200', values.s200, 'money']] },
    mean: { id: 'mean', name: 'Bollinger + RSI Reversal', subtitle: 'Trend-filtered mean reversion', signal: meanSignal, confidence: severeDowntrend ? 42 : Math.round(clamp(50 + Math.abs(values.rsi14 - 50), 45, 88)), reason: severeDowntrend ? 'A bullish mean-reversion entry is blocked because the long-term trend is severely bearish.' : meanBuy ? 'Price re-entered the lower band after exhaustion while the long-term trend filter remained acceptable.' : meanSell ? 'Price re-entered the upper band after an overbought stretch.' : `RSI is ${values.rsi14.toFixed(1)} and no confirmed band re-entry occurred.`, metrics: [['RSI 14', values.rsi14, 'number'], ['Lower band', values.lower, 'money'], ['Upper band', values.upper, 'money']] },
    atr: { id: 'atr', name: 'ATR Breakout', subtitle: 'Volatility + volume + close confirmation', signal: atrSignal, confidence: Math.round(clamp(48 + Math.abs(breakoutScore - 50), 42, 90)), reason: breakoutBuy ? 'Price cleared prior resistance with an ATR buffer, strong volume, and a close near the session high.' : breakoutSell ? 'Price broke prior support with an ATR buffer, strong volume, and a close near the session low.' : `Confirmation requires a close above ${(resistance + .15 * values.atr14).toFixed(2)} or below ${(support - .15 * values.atr14).toFixed(2)}, plus volume and close-location confirmation.`, metrics: [['ATR 14', values.atr14, 'money'], ['Resistance', resistance, 'money'], ['Volume vs avg', volumeRatio, 'multiple']] }
  };

  return { latest, ...values, marketValues, resistance, support, volumeRatio, regime, riskLevel, invalidation, ensembleScore, ensembleSignal, confidence, subscores, weights, dataQuality, qualityLabel, scoreLabel, valuationAvailable, valuationScore, valuationExplanation, fundamentals: fundamentalData, strategies };
}

function strategySignal(data, market, index, strategy) {
  try { return analyze(data.slice(0, index + 1), market.slice(0, Math.min(index + 1, market.length))).strategies[strategy].signal; }
  catch { return 'HOLD'; }
}

function backtest(data, market, strategy) {
  const start = Math.min(252, data.length - 2);
  const cost = .001;
  let cash = 1, shares = 0, entry = 0, exposureDays = 0, wins = 0, grossWins = 0, grossLosses = 0;
  const trades = [], curve = [], dailyValues = [];
  const startingPrice = data[start + 1].open;
  const marketStart = market[Math.min(start + 1, market.length - 1)].close;
  for (let index = start; index < data.length - 1; index++) {
    const signal = strategySignal(data, market, index, strategy);
    const next = data[index + 1];
    if (!shares && signal === 'BUY') {
      cash *= 1 - cost;
      shares = cash / next.open;
      entry = next.open;
      cash = 0;
    } else if (shares && signal === 'SELL') {
      cash = shares * next.open * (1 - cost);
      const tradeReturn = next.open / entry * (1 - cost) - 1;
      trades.push(tradeReturn);
      if (tradeReturn > 0) { wins++; grossWins += tradeReturn; } else grossLosses += Math.abs(tradeReturn);
      shares = 0;
    }
    if (shares) exposureDays++;
    const value = shares ? shares * next.close : cash;
    dailyValues.push(value);
    const marketIndex = matchedBenchmarkIndex(next, market, index + 1);
    curve.push({ date: next.date, strategy: value, hold: next.close / startingPrice, spy: market[marketIndex].close / marketStart });
  }
  if (shares) {
    const finalPrice = data.at(-1).close;
    cash = shares * finalPrice * (1 - cost);
    const tradeReturn = finalPrice / entry * (1 - cost) - 1;
    trades.push(tradeReturn);
    if (tradeReturn > 0) { wins++; grossWins += tradeReturn; } else grossLosses += Math.abs(tradeReturn);
  }
  const finalValue = cash;
  const dailyReturns = dailyValues.slice(1).map((value, index) => value / dailyValues[index] - 1);
  const meanReturn = average(dailyReturns);
  const downside = dailyReturns.filter(value => value < 0);
  const annualizedReturn = meanReturn * 252;
  const sharpe = deviation(dailyReturns) ? annualizedReturn / (deviation(dailyReturns) * Math.sqrt(252)) : 0;
  const sortino = deviation(downside) ? annualizedReturn / (deviation(downside) * Math.sqrt(252)) : 0;
  let peak = 1, maximumDrawdown = 0;
  dailyValues.forEach(value => { peak = Math.max(peak, value); maximumDrawdown = Math.max(maximumDrawdown, (peak - value) / peak); });
  const years = Math.max((data.length - start) / 252, .1);
  return {
    returnPct: (finalValue - 1) * 100,
    holdPct: (data.at(-1).close / startingPrice - 1) * 100,
    spyPct: (curve.at(-1)?.spy - 1) * 100,
    cagr: (finalValue ** (1 / years) - 1) * 100,
    sharpe, sortino,
    maxDrawdown: maximumDrawdown * 100,
    trades: trades.length,
    winRate: trades.length ? wins / trades.length * 100 : 0,
    exposure: exposureDays / Math.max(data.length - start, 1) * 100,
    profitFactor: grossLosses ? grossWins / grossLosses : grossWins ? Infinity : 0,
    curve
  };
}

function demoRows(symbol) {
  let price = 90 + (symbol.charCodeAt(0) || 65) % 35;
  let seed = [...symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0) || 42;
  const output = [];
  let day = new Date();
  while (output.length < 560) {
    day = new Date(day.getTime() - 86400000);
    if ([0, 6].includes(day.getDay())) continue;
    seed = (seed * 9301 + 49297) % 233280;
    const noise = seed / 233280 - .48;
    const index = 559 - output.length;
    const move = .00035 + noise * .022 + Math.sin(index / 27) * .0035;
    const close = price;
    const open = close / (1 + move);
    const spread = close * (.005 + Math.abs(noise) * .012);
    price = open;
    output.push({ date: day.toISOString().slice(0, 10), open, high: Math.max(open, close) + spread, low: Math.min(open, close) - spread, close, volume: Math.round(1e7 * (.7 + Math.abs(noise) * 1.6)) });
  }
  return output.reverse();
}

async function fetchMarket(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3y&interval=1d&events=div%2Csplits`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`market service returned ${response.status}`);
  const body = await response.json();
  const result = body?.chart?.result?.[0];
  if (!result) throw new Error(body?.chart?.error?.description || 'ticker not found');
  const quote = result.indicators?.quote?.[0];
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || quote.close;
  const data = result.timestamp.map((timestamp, index) => ({ date: new Date(timestamp * 1000).toISOString().slice(0, 10), open: quote.open[index], high: quote.high[index], low: quote.low[index], close: adjusted[index], volume: quote.volume[index] })).filter(row => [row.open, row.high, row.low, row.close].every(Number.isFinite));
  if (data.length < 300) throw new Error('not enough price history');
  return data;
}

const rawValue = value => value && typeof value === 'object' && 'raw' in value ? value.raw : value;

async function fetchFundamentals(symbol) {
  const quoteUrl = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbol);
  try {
    const response = await fetch(quoteUrl);
    if (!response.ok) throw new Error('quote fundamentals unavailable');
    const quote = (await response.json())?.quoteResponse?.result?.[0];
    if (!quote) throw new Error('fundamentals not found');
    return {
      trailingPE: rawValue(quote.trailingPE),
      forwardPE: rawValue(quote.forwardPE),
      pegRatio: rawValue(quote.pegRatio),
      earningsGrowth: rawValue(quote.earningsQuarterlyGrowth),
      source: 'LIVE FUNDAMENTALS'
    };
  } catch {
    const summaryUrl = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' + encodeURIComponent(symbol) + '?modules=summaryDetail,defaultKeyStatistics,financialData';
    const response = await fetch(summaryUrl);
    if (!response.ok) throw new Error('fundamental ratios unavailable');
    const result = (await response.json())?.quoteSummary?.result?.[0];
    if (!result) throw new Error('fundamentals not found');
    return {
      trailingPE: rawValue(result.summaryDetail?.trailingPE),
      forwardPE: rawValue(result.summaryDetail?.forwardPE),
      pegRatio: rawValue(result.defaultKeyStatistics?.pegRatio),
      earningsGrowth: rawValue(result.financialData?.earningsGrowth),
      source: 'LIVE FUNDAMENTALS'
    };
  }
}

function demoFundamentals(symbol) {
  const seed = [...symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const trailingPE = 14 + seed % 28;
  const growth = .06 + (seed % 20) / 100;
  return { trailingPE, forwardPE: trailingPE * (.78 + (seed % 12) / 100), pegRatio: trailingPE / (growth * 100), earningsGrowth: growth, source: 'SIMULATED FUNDAMENTALS' };
}

async function scan(symbol) {
  const clean = symbol.toUpperCase().trim().replace(/[^A-Z.\-]/g, '').slice(0, 10);
  if (!clean) return;
  const button = $('#scanButton');
  button.disabled = true;
  button.classList.add('loading');
  button.querySelector('span').textContent = 'Scanning';
  let message = '';
  try {
    let snapshotLoaded = false;
    if (LARGE_CAP_UNIVERSE.includes(clean) || clean === 'SPY') {
      try {
        const snapshot = await loadUniverseSnapshot();
        const item = clean === 'SPY' ? { rows: snapshot.spy, fundamentals: null } : snapshot.stocks[clean];
        if (item?.rows?.length >= 253) {
          rows = item.rows;
          benchmarkRows = snapshot.spy;
          fundamentals = item.fundamentals ? { ...item.fundamentals, source: 'LIVE FUNDAMENTALS' } : null;
          source = 'LIVE';
          snapshotLoaded = true;
          message = 'Verified daily market snapshot loaded for ' + clean + '. Data generated ' + new Date(snapshot.generatedAt).toLocaleString() + '.';
          if (!fundamentals && clean !== 'SPY') message += ' Fundamental ratios were unavailable and are excluded from the score.';
        }
      } catch { /* Try the direct source before using the demo fallback. */ }
    }
    if (!snapshotLoaded) {
      const [stockResult, spyResult, fundamentalResult] = await Promise.allSettled([fetchMarket(clean), fetchMarket('SPY'), fetchFundamentals(clean)]);
      if (stockResult.status === 'rejected') throw stockResult.reason;
      rows = stockResult.value;
      benchmarkRows = spyResult.status === 'fulfilled' ? spyResult.value : rows.map(row => ({ ...row }));
      fundamentals = fundamentalResult.status === 'fulfilled' ? fundamentalResult.value : null;
      source = 'LIVE';
      message = spyResult.status === 'fulfilled'
        ? 'Live market and SPY benchmark data loaded for ' + clean + '. Quotes may be delayed.'
        : 'Live ' + clean + ' data loaded. SPY was unavailable, so relative-strength inputs are neutralized.';
      if (!fundamentals) message += ' Fundamental ratios were unavailable and are excluded from the score.';
    }
  } catch (error) {
    rows = demoRows(clean);
    benchmarkRows = demoRows('SPY');
    source = 'DEMO';
    fundamentals = demoFundamentals(clean);
    message = 'Live and verified snapshot data unavailable (' + error.message + '). Showing clearly labeled simulated data—do not use it for trading decisions.';
  }
  try {
    ticker = clean;
    analysis = analyze(rows, benchmarkRows, fundamentals);
    setSource(message);
    render();
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
    button.querySelector('span').textContent = 'Run scan';
  }
}

function setSource(message) {
  const badge = $('#dataBadge');
  const notice = $('#notice');
  badge.className = `data-badge ${source.toLowerCase()}`;
  badge.querySelector('span').textContent = `${source} DATA`;
  notice.className = `notice show ${source.toLowerCase()}`;
  notice.textContent = message;
  $('#footerSource').textContent = source === 'LIVE' ? 'Market data is supplied by Yahoo Finance and may be delayed.' : 'Demo data is simulated and not suitable for trading decisions.';
}

function applySignal(element, signal) {
  element.className = signal.toLowerCase();
  element.textContent = signal;
}

function render() {
  const selected = analysis.strategies[active];
  $('#ticker').textContent = $('#heroTicker').textContent = ticker;
  $('#price').textContent = formatMoney(analysis.latest.close);
  $('#asOf').textContent = `As of ${analysis.latest.date}`;
  $('#regime').textContent = $('#heroRegime').textContent = analysis.regime;
  $('#regimeText').textContent = `${analysis.regime.toLowerCase()} market context changes the ensemble weights.`;
  applySignal($('#heroSignal'), analysis.ensembleSignal);
  $('#heroReason').textContent = `${analysis.scoreLabel}; score ${analysis.ensembleScore.toFixed(0)}/100 with ${analysis.confidence}% evidence confidence.`;
  Object.values(analysis.strategies).forEach(strategy => applySignal($(`.strategy-button[data-strategy="${strategy.id}"] em`), strategy.signal));
  $$('.strategy-button').forEach(button => {
    const selectedButton = button.dataset.strategy === active;
    button.classList.toggle('active', selectedButton);
    button.setAttribute('aria-pressed', String(selectedButton));
  });
  $('#strategyName').textContent = selected.name;
  $('#strategySubtitle').textContent = selected.subtitle.toUpperCase();
  applySignal($('#currentSignal'), selected.signal);
  $('#reasonText').textContent = selected.reason;
  $('#metrics').innerHTML = [...selected.metrics, ['Confidence', selected.confidence, 'percent-plain']].map(([name, value, type]) => `<div><span>${name}</span><b>${formatMetric(value, type)}</b></div>`).join('');
  $('#ensembleScore').textContent = `${analysis.ensembleScore.toFixed(0)}/100`;
  $('#scoreLabel').textContent = analysis.scoreLabel;
  $('#riskLevel').textContent = analysis.riskLevel;
  $('#riskReason').textContent = `${analysis.volatility20.toFixed(1)}% annualized volatility; ${analysis.drawdown252.toFixed(1)}% drawdown`;
  $('#invalidation').textContent = formatMoney(analysis.invalidation);
  $('#dataQuality').textContent = `${analysis.dataQuality.toFixed(0)}/100`;
  $('#qualityReason').textContent = analysis.qualityLabel;
  const fd = analysis.fundamentals;
  $('#fundamentalSource').textContent = fd ? (fd.source || 'Fundamental data') : 'Unavailable · excluded from score';
  $('#trailingPE').textContent = Number.isFinite(fd?.trailingPE) ? fd.trailingPE.toFixed(2) : '—';
  $('#forwardPE').textContent = Number.isFinite(fd?.forwardPE) ? fd.forwardPE.toFixed(2) : '—';
  $('#pegRatio').textContent = Number.isFinite(fd?.pegRatio) ? fd.pegRatio.toFixed(2) : '—';
  $('#earningsGrowth').textContent = Number.isFinite(fd?.earningsGrowth) ? (fd.earningsGrowth * 100).toFixed(1) + '%' : '—';
  $('#trailingPELabel').textContent = Number.isFinite(fd?.trailingPE) ? (fd.trailingPE < 20 ? 'Lower multiple' : fd.trailingPE > 35 ? 'Higher multiple' : 'Middle range') : 'Unavailable';
  $('#forwardPELabel').textContent = Number.isFinite(fd?.forwardPE) ? (fd?.trailingPE > fd.forwardPE ? 'Below trailing P/E' : 'Above trailing P/E') : 'Unavailable';
  $('#pegLabel').textContent = Number.isFinite(fd?.pegRatio) ? (fd.pegRatio < 1 ? 'Low vs expected growth' : fd.pegRatio > 2 ? 'High vs expected growth' : 'Middle range') : 'Unavailable';
  $('#growthLabel').textContent = Number.isFinite(fd?.earningsGrowth) ? 'Consensus estimate' : 'Unavailable';
  $('#valuationExplanation').textContent = analysis.valuationExplanation;
  const labels = { trend: 'Trend', relative: 'Relative strength', mean: 'Mean reversion', breakout: 'Breakout', risk: 'Risk quality', valuation: 'Fundamental value' };
  $('#scoreBars').innerHTML = Object.entries(analysis.subscores).map(([key, value]) => `<div class="score-row"><span>${labels[key]} <small>${Math.round(analysis.weights[key] * 100)}% weight</small></span><div><i style="width:${value.toFixed(1)}%"></i></div><b>${value.toFixed(0)}</b></div>`).join('');
  renderPriceChart();
  renderBacktest();
  renderLog();
  renderPaperTicket();
}

function formatMetric(value, type) {
  if (!Number.isFinite(value)) return '—';
  if (type === 'money') return formatMoney(value);
  if (type === 'multiple') return `${value.toFixed(2)}×`;
  if (type === 'percent') return formatPercent(value);
  if (type === 'percent-plain') return `${Math.round(value)}%`;
  if (type === 'score') return `${value.toFixed(0)}/100`;
  if (type === 'ratio') return value.toFixed(2);
  return value.toFixed(1);
}

function chartColors() {
  const styles = getComputedStyle(document.documentElement);
  return { green: styles.getPropertyValue('--success-color').trim() || '#29bf7e', muted: styles.getPropertyValue('--muted-text-color').trim() || '#8491a1', border: styles.getPropertyValue('--border-color').trim() || '#e7e8e4', text: styles.getPropertyValue('--text-color').trim() || '#142031', gold: styles.getPropertyValue('--gold-color').trim() || '#b88a1b' };
}

function commonChartOptions() {
  const colors = chartColors();
  return { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 10, color: colors.text, font: { size: 11 } } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: colors.muted, font: { size: 10 } } }, y: { grid: { color: colors.border }, ticks: { color: colors.muted, font: { size: 10 } } } } };
}

function renderPriceChart() {
  const view = rows.slice(-160);
  const offset = rows.length - view.length;
  const reference = view.map((_, cursor) => active === 'trend' || active === 'ensemble' ? sma(rows, 50, offset + cursor) : active === 'mean' ? sma(rows, 20, offset + cursor) : analysis.resistance);
  const colors = chartColors();
  priceChart?.destroy();
  priceChart = new Chart($('#priceChart'), { type: 'line', data: { labels: view.map(row => row.date), datasets: [{ label: 'Adjusted close', data: view.map(row => row.close), borderColor: colors.green, backgroundColor: `${colors.green}22`, fill: true, pointRadius: 0, borderWidth: 2 }, { label: active === 'mean' ? 'Bollinger midpoint' : active === 'atr' ? 'Prior resistance' : 'SMA 50', data: reference, borderColor: colors.muted, pointRadius: 0, borderDash: [5, 5], borderWidth: 1.5 }] }, options: commonChartOptions() });
}

function renderBacktest() {
  const result = backtest(rows, benchmarkRows, active);
  $('#strategyReturn').textContent = formatPercent(result.returnPct);
  $('#strategyReturn').className = result.returnPct >= 0 ? 'buy' : 'sell';
  $('#holdReturn').textContent = formatPercent(result.holdPct);
  $('#cagr').textContent = formatPercent(result.cagr);
  $('#sharpe').textContent = formatNumber(result.sharpe);
  $('#sortino').textContent = formatNumber(result.sortino);
  $('#drawdown').textContent = `-${result.maxDrawdown.toFixed(1)}%`;
  $('#trades').textContent = result.trades;
  $('#winRate').textContent = `${result.winRate.toFixed(0)}%`;
  $('#exposure').textContent = `${result.exposure.toFixed(0)}%`;
  $('#profitFactor').textContent = result.profitFactor === Infinity ? '∞' : formatNumber(result.profitFactor);
  $('#spyReturn').textContent = formatPercent(result.spyPct);
  $('#points').textContent = rows.length;
  $('#sampleWarning').textContent = active === 'valuation' ? 'A historical valuation backtest is intentionally unavailable because this app does not have point-in-time P/E, forward P/E, PEG, and analyst forecasts. Using today’s ratios in the past would create look-ahead bias.' : active === 'ensemble' ? 'The historical ensemble excludes today’s valuation ratios because point-in-time fundamentals are unavailable. Results include estimated 0.10% cost per side.' : result.trades < 8 ? `Only ${result.trades} completed/open trades: this sample is too small for a reliable conclusion.` : 'Results include estimated 0.10% cost on every entry and exit.';
  const colors = chartColors();
  equityChart?.destroy();
  equityChart = new Chart($('#equityChart'), { type: 'line', data: { labels: result.curve.map(point => point.date), datasets: [{ label: 'Strategy net', data: result.curve.map(point => point.strategy), borderColor: colors.green, pointRadius: 0, borderWidth: 2.8 }, { label: 'Buy & hold', data: result.curve.map(point => point.hold), borderColor: '#67c7ff', backgroundColor: '#67c7ff', pointRadius: 0, borderWidth: 2.5, borderDash: [8, 5] }, { label: 'SPY', data: result.curve.map(point => point.spy), borderColor: colors.gold, backgroundColor: colors.gold, pointRadius: 0, borderWidth: 2.2 }] }, options: { ...commonChartOptions(), scales: { x: { ticks: { display: false }, grid: { display: false } }, y: { ticks: { color: '#c3ced8', callback: value => `${value.toFixed(2)}×` }, grid: { color: '#33465a' } } }, plugins: { legend: { labels: { color: '#e5edf3', boxWidth: 18, boxHeight: 3, padding: 18 } } } } });
}

function logRows() {
  return Object.values(analysis.strategies).map(strategy => ({ date: analysis.latest.date, symbol: ticker, strategy: strategy.name, regime: analysis.regime, signal: strategy.signal, reason: strategy.reason, score: strategy.id === 'ensemble' ? analysis.ensembleScore.toFixed(1) : '', risk: analysis.riskLevel, source: `${source} DATA` }));
}

function renderLog() {
  $('#logBody').innerHTML = logRows().map(row => `<tr><td>${row.date}</td><td><b>${row.symbol}</b></td><td>${row.strategy}</td><td>${row.regime}</td><td><em class="${row.signal.toLowerCase()}">${row.signal}</em></td><td>${row.reason}</td></tr>`).join('');
}

function downloadCsv() {
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const header = 'date,symbol,strategy,regime,signal,ensemble_score,risk_level,reason,data_source';
  const data = [header, ...logRows().map(row => [row.date, row.symbol, row.strategy, row.regime, row.signal, row.score, row.risk, row.reason, row.source].map(quote).join(','))].join('\n');
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
  anchor.download = `${ticker}-quant-decision-log.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function loadPaperTrades() {
  try { paperTradeQueue = JSON.parse(localStorage.getItem('stocks-paper-trades') || '[]'); }
  catch { paperTradeQueue = []; }
  renderTradeQueue();
}

function savePaperTrades() {
  localStorage.setItem('stocks-paper-trades', JSON.stringify(paperTradeQueue));
  renderTradeQueue();
  renderPaperTicket();
}

function getVirtualBalance() {
  const input = $('#virtualBalanceInput');
  const value = Number(input?.value);
  return Number.isFinite(value) && value >= 100 ? value : DEFAULT_VIRTUAL_BALANCE;
}

function updateVirtualBalance() {
  const balance = getVirtualBalance();
  localStorage.setItem('stocks-virtual-balance', balance.toFixed(2));
  $('#virtualBalanceInput').value = balance.toFixed(2);
  $('#maxRiskDisplay').textContent = formatMoney(balance * .01);
  $('#maxPositionDisplay').textContent = formatMoney(balance * .10);
  renderPaperTicket();
}

function buildPaperTicket() {
  if (!analysis) return { allowed: false, reason: 'Scan a ticker first.' };
  if (paperTradeQueue.some(ticket => ticket.symbol === ticker && ['APPROVED', 'PLACED'].includes(ticket.status))) return { allowed: false, reason: 'An approved or placed ticket for this ticker already exists. Duplicate orders are blocked.' };
  if (source !== 'LIVE') return { allowed: false, reason: 'Paper-trade recommendations are blocked while simulated market data is displayed.' };
  if (!analysis.valuationAvailable || analysis.fundamentals?.source !== 'LIVE FUNDAMENTALS') return { allowed: false, reason: 'A BUY ticket requires live P/E, forward P/E, and PEG coverage. Valuation data is currently incomplete.' };
  if (analysis.ensembleSignal !== 'BUY' || analysis.ensembleScore < 68) return { allowed: false, reason: 'No trade: the Quant Ensemble has not reached the 68/100 BUY threshold.' };
  if (analysis.riskLevel === 'HIGH') return { allowed: false, reason: 'No trade: current volatility or drawdown produces a HIGH risk classification.' };
  const entry = analysis.latest.close;
  const stop = Math.min(analysis.invalidation, entry - analysis.atr14 * .75);
  const riskPerShare = entry - stop;
  if (!(riskPerShare > 0)) return { allowed: false, reason: 'No trade: a valid protective stop could not be calculated below the entry price.' };
  const virtualBalance = getVirtualBalance();
  const sharesByRisk = Math.floor((virtualBalance * .01) / riskPerShare);
  const sharesByPosition = Math.floor((virtualBalance * .10) / entry);
  const shares = Math.max(0, Math.min(sharesByRisk, sharesByPosition));
  if (shares < 1) return { allowed: false, reason: 'No trade: the risk-based position size is below one share.' };
  return {
    allowed: true,
    id: Date.now().toString(36),
    created: new Date().toISOString(),
    symbol: ticker,
    action: 'BUY',
    orderType: 'LIMIT BUY',
    entry,
    shares,
    positionValue: entry * shares,
    stop,
    target: entry + riskPerShare * 2,
    dollarsAtRisk: riskPerShare * shares,
    timing: 'Place only at or below the limit after confirming the ensemble still reads BUY.',
    score: analysis.ensembleScore,
    valuationScore: analysis.valuationScore,
    riskLevel: analysis.riskLevel,
    reason: analysis.strategies.ensemble.reason,
    status: 'APPROVED'
  };
}


function candidateTicket(symbol, candidateAnalysis, virtualBalance) {
  if (!candidateAnalysis.valuationAvailable || candidateAnalysis.fundamentals?.source !== 'LIVE FUNDAMENTALS') return null;
  if (candidateAnalysis.ensembleSignal !== 'BUY' || candidateAnalysis.ensembleScore < 68 || candidateAnalysis.riskLevel === 'HIGH') return null;
  const entry = candidateAnalysis.latest.close;
  const stop = Math.min(candidateAnalysis.invalidation, entry - candidateAnalysis.atr14 * .75);
  const riskPerShare = entry - stop;
  if (!(riskPerShare > 0)) return null;
  const shares = Math.max(0, Math.min(Math.floor((virtualBalance * .01) / riskPerShare), Math.floor((virtualBalance * .10) / entry)));
  if (shares < 1) return null;
  return {
    allowed: true, id: Date.now().toString(36) + '-' + symbol.toLowerCase(), created: new Date().toISOString(),
    symbol, action: 'BUY', orderType: 'LIMIT BUY', entry, shares, positionValue: entry * shares, stop,
    target: entry + riskPerShare * 2, dollarsAtRisk: riskPerShare * shares,
    timing: 'Place only at or below the limit after rescanning the symbol and confirming the ensemble still reads BUY.',
    score: candidateAnalysis.ensembleScore, valuationScore: candidateAnalysis.valuationScore,
    riskLevel: candidateAnalysis.riskLevel, reason: candidateAnalysis.strategies.ensemble.reason,
    status: 'APPROVED', scannedAt: new Date().toISOString()
  };
}
function setUniverseProgress(done, total, message) {
  const progress = $('#universeProgress');
  if (!progress) return;
  progress.querySelector('i').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  progress.querySelector('span').textContent = message;
}
function renderUniverseResults(summary = '') {
  const container = $('#universeResults');
  if (!container) return;
  if (!universeRecommendations.length) {
    container.innerHTML = '<p class="empty-queue">' + (summary || 'No stocks passed every trade gate.') + '</p>';
    return;
  }
  container.innerHTML = (summary ? '<p class="universe-summary">' + summary + '</p>' : '') + universeRecommendations.map((ticket, index) =>
    '<article class="candidate-card" data-candidate="' + ticket.symbol + '">' +
      '<div class="candidate-rank"><small>RANK</small><b>' + (index + 1) + '</b></div>' +
      '<div><small>SYMBOL</small><b>' + ticket.symbol + '</b></div>' +
      '<div><small>ENSEMBLE</small><b>' + ticket.score.toFixed(0) + '/100</b></div>' +
      '<div><small>VALUATION</small><b>' + ticket.valuationScore.toFixed(0) + '/100</b></div>' +
      '<div><small>BUY</small><b>' + ticket.shares + ' shares</b></div>' +
      '<div><small>POSITION</small><b>' + formatMoney(ticket.positionValue) + '</b></div>' +
      '<div><small>LIMIT / STOP</small><b>' + formatMoney(ticket.entry) + ' / ' + formatMoney(ticket.stop) + '</b></div>' +
      '<button class="add-candidate" type="button">Add to queue</button>' +
      '<p>' + ticket.reason + '</p></article>'
  ).join('');
  document.querySelectorAll('.add-candidate').forEach(button => button.addEventListener('click', () => {
    const symbol = button.closest('[data-candidate]').dataset.candidate;
    const ticket = universeRecommendations.find(item => item.symbol === symbol);
    if (!ticket) return;
    if (paperTradeQueue.some(item => item.symbol === symbol && ['APPROVED', 'PLACED'].includes(item.status))) {
      button.textContent = 'Already queued'; button.disabled = true; return;
    }
    paperTradeQueue.unshift({ ...ticket, id: Date.now().toString(36) + '-' + symbol.toLowerCase() });
    savePaperTrades(); button.textContent = 'Added ✓'; button.disabled = true;
  }));
}
async function loadUniverseSnapshot() {
  const response = await fetch('./market-data/universe.json?cache=' + Date.now(), { cache: 'no-store' });
  if (!response.ok) throw new Error('daily market snapshot is not available yet');
  const snapshot = await response.json();
  const ageHours = (Date.now() - new Date(snapshot.generatedAt).getTime()) / 3600000;
  if (!Number.isFinite(ageHours) || ageHours > 96) throw new Error('daily market snapshot is stale');
  if (!Array.isArray(snapshot.spy) || snapshot.spy.length < 253 || !snapshot.stocks) throw new Error('daily market snapshot is incomplete');
  return snapshot;
}
async function runUniverseScan() {
  if (universeScanRunning) return;
  universeScanRunning = true;
  const button = $('#runUniverseScan');
  button.disabled = true;
  button.textContent = 'Loading daily data…';
  universeRecommendations = [];
  renderUniverseResults('Loading the latest GitHub-hosted market snapshot…');
  const size = $('#universeSelect').value === 'core50' ? 50 : 100;
  const symbols = LARGE_CAP_UNIVERSE.slice(0, size);
  const maxResults = Number($('#maxRecommendations').value) || 5;
  const virtualBalance = getVirtualBalance();
  let snapshot;
  try {
    snapshot = await loadUniverseSnapshot();
  } catch (error) {
    setUniverseProgress(0, symbols.length, 'Daily market data is being prepared or refreshed. Please try again shortly.');
    renderUniverseResults('The automated data snapshot is not ready: ' + error.message + '. No simulated recommendations were produced.');
    button.disabled = false;
    button.textContent = 'Scan ' + size + ' stocks';
    universeScanRunning = false;
    return;
  }
  const candidates = [];
  let completed = 0, live = 0, failed = 0, qualified = 0;
  for (const symbol of symbols) {
    try {
      const item = snapshot.stocks[symbol];
      if (!item || !Array.isArray(item.rows) || item.rows.length < 253) throw new Error('price history unavailable');
      if (!item.fundamentals) throw new Error('fundamentals unavailable');
      const candidateAnalysis = analyze(item.rows, snapshot.spy, { ...item.fundamentals, source: 'LIVE FUNDAMENTALS' });
      live++;
      const ticket = candidateTicket(symbol, candidateAnalysis, virtualBalance);
      if (ticket) {
        ticket.dataAsOf = item.rows.at(-1).date;
        ticket.snapshotGeneratedAt = snapshot.generatedAt;
        qualified++;
        candidates.push(ticket);
      }
    } catch { failed++; }
    completed++;
    setUniverseProgress(completed, symbols.length, 'Analyzed ' + completed + ' of ' + symbols.length + ' · ' + qualified + ' passed all gates');
    if (completed % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const queued = new Set(paperTradeQueue.filter(item => ['APPROVED', 'PLACED'].includes(item.status)).map(item => item.symbol));
  const deploymentCap = virtualBalance * .50;
  let deployed = 0;
  universeRecommendations = candidates.filter(ticket => !queued.has(ticket.symbol))
    .sort((a, b) => b.score - a.score || b.valuationScore - a.valuationScore)
    .filter(ticket => {
      if (deployed + ticket.positionValue > deploymentCap) return false;
      deployed += ticket.positionValue;
      return true;
    })
    .slice(0, maxResults);
  const updated = new Date(snapshot.generatedAt).toLocaleString();
  const summary = 'Daily snapshot updated ' + updated + '. Coverage: ' + live + '/' + symbols.length + '. ' + failed + ' incomplete. ' + qualified + ' passed every gate; showing ' + universeRecommendations.length + ' portfolio-sized recommendation' + (universeRecommendations.length === 1 ? '' : 's') + '.';
  setUniverseProgress(symbols.length, symbols.length, summary);
  renderUniverseResults(summary);
  button.disabled = false;
  button.textContent = 'Scan ' + size + ' stocks';
  universeScanRunning = false;
}
function renderPaperTicket() {
  if (!$('#ticketSymbol')) return;
  const ticket = buildPaperTicket();
  currentPaperTicket = ticket.allowed ? ticket : null;
  $('#ticketSymbol').textContent = analysis ? ticker : 'Scan a ticker';
  applySignal($('#ticketAction'), ticket.allowed ? 'BUY' : 'WAIT');
  $('#ticketGate').textContent = ticket.allowed ? 'All gates passed: live data, live valuation, ensemble BUY, and acceptable risk.' : ticket.reason;
  $('#ticketOrderType').textContent = ticket.allowed ? ticket.orderType : '—';
  $('#ticketEntry').textContent = ticket.allowed ? formatMoney(ticket.entry) : '—';
  $('#ticketShares').textContent = ticket.allowed ? ticket.shares : '—';
  $('#ticketValue').textContent = ticket.allowed ? formatMoney(ticket.positionValue) : '—';
  $('#ticketStop').textContent = ticket.allowed ? formatMoney(ticket.stop) : '—';
  $('#ticketTarget').textContent = ticket.allowed ? formatMoney(ticket.target) : '—';
  $('#ticketRisk').textContent = ticket.allowed ? formatMoney(ticket.dollarsAtRisk) : '—';
  $('#ticketTiming').textContent = ticket.allowed ? ticket.timing : 'Wait and rescan after conditions change.';
  $('#ticketReason').textContent = ticket.allowed ? ticket.reason : 'The system produces no order until every paper-trading gate passes.';
  $('#queueTradeButton').disabled = !ticket.allowed;
  $('#copyTradeButton').disabled = !ticket.allowed;
}

function renderTradeQueue() {
  const container = $('#tradeQueue');
  if (!container) return;
  if (!paperTradeQueue.length) {
    container.innerHTML = '<p class="empty-queue">No proposed paper trades yet.</p>';
    return;
  }
  container.innerHTML = paperTradeQueue.map(ticket => '<article class="queue-card" data-ticket="' + ticket.id + '"><div><small>ORDER</small><b>' + ticket.action + ' ' + ticket.shares + ' ' + ticket.symbol + '</b></div><div><small>LIMIT</small><b>' + formatMoney(ticket.entry) + '</b></div><div><small>STOP</small><b>' + formatMoney(ticket.stop) + '</b></div><div><small>TARGET</small><b>' + formatMoney(ticket.target) + '</b></div><div><small>RISK</small><b>' + formatMoney(ticket.dollarsAtRisk) + '</b></div><div><small>STATUS</small><b class="queue-status">' + ticket.status + '</b></div><div class="queue-actions"><button class="place-ticket">' + (ticket.status === 'PLACED' ? 'Placed ✓' : 'Mark placed') + '</button><button class="remove-ticket">Remove</button></div></article>').join('');
  $$('.place-ticket').forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-ticket]').dataset.ticket;
    paperTradeQueue = paperTradeQueue.map(ticket => ticket.id === id ? { ...ticket, status: 'PLACED', placed: new Date().toISOString() } : ticket);
    savePaperTrades();
  }));
  $$('.remove-ticket').forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-ticket]').dataset.ticket;
    paperTradeQueue = paperTradeQueue.filter(ticket => ticket.id !== id);
    savePaperTrades();
  }));
}

function paperTicketText(ticket) {
  return ['INVESTOPEDIA PAPER TRADE', ticket.action + ' ' + ticket.symbol, 'Order: ' + ticket.orderType, 'Shares: ' + ticket.shares, 'Limit: ' + formatMoney(ticket.entry), 'Protective stop: ' + formatMoney(ticket.stop), 'Profit objective: ' + formatMoney(ticket.target), 'Position value: ' + formatMoney(ticket.positionValue), 'Maximum dollars at risk: ' + formatMoney(ticket.dollarsAtRisk), 'Timing: ' + ticket.timing, 'Ensemble score: ' + ticket.score.toFixed(1) + '/100', 'Valuation score: ' + ticket.valuationScore.toFixed(1) + '/100', 'Reason: ' + ticket.reason].join('\n');
}

function exportPaperTrades() {
  const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  const header = 'created,placed,status,symbol,action,order_type,shares,entry_limit,stop,target,position_value,dollars_at_risk,ensemble_score,valuation_score,risk_level,reason';
  const rows = paperTradeQueue.map(ticket => [ticket.created, ticket.placed, ticket.status, ticket.symbol, ticket.action, ticket.orderType, ticket.shares, ticket.entry, ticket.stop, ticket.target, ticket.positionValue, ticket.dollarsAtRisk, ticket.score, ticket.valuationScore, ticket.riskLevel, ticket.reason].map(quote).join(','));
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([[header, ...rows].join('\n')], { type: 'text/csv' }));
  anchor.download = 'investopedia-paper-trade-journal.csv';
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

if (typeof document !== 'undefined') {
  $('#searchForm').addEventListener('submit', event => { event.preventDefault(); scan($('#tickerInput').value); });
  $$('.strategy-button').forEach(button => button.addEventListener('click', () => { active = button.dataset.strategy; render(); }));
  $$('[data-open]').forEach(button => button.addEventListener('click', () => { active = button.dataset.open; render(); $('#scanner').scrollIntoView({ behavior: 'smooth' }); }));
  $('#downloadCsv').addEventListener('click', downloadCsv);
  $('#queueTradeButton').addEventListener('click', () => {
    if (!currentPaperTicket) return;
    paperTradeQueue.unshift({ ...currentPaperTicket });
    savePaperTrades();
    $('#ticketStatus').textContent = 'Trade approved and added to your queue. It has not been sent to Investopedia.';
  });
  $('#copyTradeButton').addEventListener('click', async () => {
    if (!currentPaperTicket) return;
    try {
      await navigator.clipboard.writeText(paperTicketText(currentPaperTicket));
      $('#ticketStatus').textContent = 'Order details copied. Review them before entering the trade in Investopedia.';
    } catch {
      $('#ticketStatus').textContent = 'Copy is unavailable in this browser. Use the visible ticket details to enter the trade manually.';
    }
  });
  $('#exportTradesButton').addEventListener('click', exportPaperTrades);
  $('#runUniverseScan').addEventListener('click', runUniverseScan);
  $('#universeSelect').addEventListener('change', () => {
    const count = $('#universeSelect').value === 'core50' ? 50 : 100;
    $('#runUniverseScan').textContent = 'Scan ' + count + ' stocks';
  });
  $('#virtualBalanceInput').value = localStorage.getItem('stocks-virtual-balance') || DEFAULT_VIRTUAL_BALANCE.toFixed(2);
  $('#virtualBalanceInput').addEventListener('change', updateVirtualBalance);
  updateVirtualBalance();
  loadPaperTrades();
  scan('AAPL');
}
if (typeof module !== 'undefined') module.exports = { analyze, backtest, demoRows, baseIndicators };
