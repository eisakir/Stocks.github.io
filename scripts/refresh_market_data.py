from __future__ import annotations
import json
import math
import re
import time
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

BASE_US = [
    "AAPL","MSFT","NVDA","AMZN","GOOGL","META","BRK-B","AVGO","TSLA","LLY",
    "JPM","WMT","V","ORCL","MA","XOM","COST","NFLX","UNH","HD",
    "PG","JNJ","ABBV","BAC","KO","CRM","PM","CVX","CSCO","IBM",
    "WFC","GE","ABT","MCD","NOW","CAT","AXP","GS","MRK","TMO",
    "ISRG","PEP","ACN","QCOM","DIS","AMD","TXN","INTU","AMGN","RTX",
    "BKNG","SPGI","PGR","AMAT","HON","NEE","LOW","DHR","PFE","UNP",
    "BLK","ETN","C","TJX","VRTX","SYK","BSX","COP","LRCX","ADP",
    "PANW","CB","SCHW","GILD","MMC","ADI","MDT","DE","SBUX","AMT",
    "PLD","BMY","BA","MO","SO","CI","KLAC","ICE","SHW","DUK",
    "CME","ZTS","MCK","CVS","USB","MDLZ","ORLY","APO","WM","EOG"
]

SOURCES = [
    {"region":"United States","url":"https://en.wikipedia.org/wiki/List_of_S%26P_500_companies","columns":["Symbol"],"suffix":"","quota":200,"benchmark":"SPY","currency":"USD"},
    {"region":"Canada","url":"https://en.wikipedia.org/wiki/S%26P/TSX_60","columns":["Symbol","Ticker"],"suffix":".TO","quota":40,"benchmark":"EWC","currency":"CAD"},
    {"region":"United Kingdom","url":"https://en.wikipedia.org/wiki/FTSE_100_Index","columns":["Ticker","EPIC"],"suffix":".L","quota":50,"benchmark":"EWU","currency":"GBP"},
    {"region":"Europe","url":"https://en.wikipedia.org/wiki/EURO_STOXX_50","columns":["Ticker","Ticker symbol","Symbol"],"suffix":"","quota":50,"benchmark":"VGK","currency":"EUR"},
    {"region":"Switzerland","url":"https://en.wikipedia.org/wiki/Swiss_Market_Index","columns":["Ticker","Ticker symbol","Symbol"],"suffix":".SW","quota":10,"benchmark":"EWL","currency":"CHF"},
    {"region":"Japan","url":"https://en.wikipedia.org/wiki/Nikkei_225","columns":["Code","Ticker","Symbol"],"suffix":".T","quota":50,"benchmark":"EWJ","currency":"JPY"},
    {"region":"Hong Kong","url":"https://en.wikipedia.org/wiki/Hang_Seng_Index","columns":["Ticker","Ticker symbol","Code"],"suffix":".HK","quota":30,"benchmark":"EWH","currency":"HKD"},
    {"region":"Australia","url":"https://en.wikipedia.org/wiki/S%26P/ASX_50","columns":["Code","Ticker","Symbol"],"suffix":".AX","quota":25,"benchmark":"EWA","currency":"AUD"},
    {"region":"India","url":"https://en.wikipedia.org/wiki/NIFTY_50","columns":["Symbol","Ticker"],"suffix":".NS","quota":25,"benchmark":"INDA","currency":"INR"},
    {"region":"South Korea","url":"https://en.wikipedia.org/wiki/KOSPI_50","columns":["Code","Ticker","Symbol"],"suffix":".KS","quota":10,"benchmark":"EWY","currency":"KRW"},
    {"region":"Taiwan","url":"https://en.wikipedia.org/wiki/FTSE_Taiwan_50_Index","columns":["Ticker","Code","Symbol"],"suffix":".TW","quota":10,"benchmark":"EWT","currency":"TWD"},
]
TARGET_COUNT = 500
HEADERS = {"User-Agent":"StockStrategyLab/2.0 educational project; contact via github.com/eisakir/Stocks.github.io"}

def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None

def flat_columns(frame):
    if getattr(frame.columns, "nlevels", 1) > 1:
        frame.columns = [" ".join(str(part) for part in item if str(part) != "nan").strip() for item in frame.columns]
    else:
        frame.columns = [str(item).strip() for item in frame.columns]
    return frame

def normalize_symbol(value, suffix, region):
    raw = str(value).strip().upper()
    raw = re.sub(r"\[[^]]+\]", "", raw)
    raw = raw.replace("\u00a0", "").replace(" ", "")
    if region in {"Japan","Hong Kong","South Korea","Taiwan"}:
        match = re.search(r"\d{4,6}", raw)
        if not match:
            return None
        digits = match.group(0)
        if region == "Hong Kong":
            digits = digits.zfill(4)
        elif region == "South Korea":
            digits = digits.zfill(6)
        raw = digits
    else:
        raw = re.sub(r"[^A-Z0-9.\-]", "", raw)
        raw = raw.replace(".", "-") if suffix in {"", ".TO"} else raw
    if not raw or raw in {"NAN","NONE","TICKER","SYMBOL"}:
        return None
    if suffix and not raw.endswith(suffix):
        raw += suffix
    return raw

def read_constituents(source):
    response = requests.get(source["url"], headers=HEADERS, timeout=30)
    response.raise_for_status()
    tables = pd.read_html(StringIO(response.text))
    best = []
    wanted = {name.lower() for name in source["columns"]}
    for frame in tables:
        frame = flat_columns(frame)
        column = next((col for col in frame.columns if col.lower() in wanted), None)
        if column is None:
            column = next((col for col in frame.columns if any(name in col.lower() for name in wanted)), None)
        if column is None:
            continue
        values = []
        for value in frame[column].tolist():
            symbol = normalize_symbol(value, source["suffix"], source["region"])
            if symbol and symbol not in values:
                values.append(symbol)
        if len(values) > len(best):
            best = values
    if len(best) < min(8, source["quota"]):
        raise ValueError(f"only {len(best)} constituents found")
    return best

def build_universe():
    pools = {}
    errors = {}
    for source in SOURCES:
        try:
            values = read_constituents(source)
            if source["region"] == "United States":
                values = BASE_US + [symbol for symbol in values if symbol not in BASE_US]
            pools[source["region"]] = values
            print(f'{source["region"]}: discovered {len(values)} constituents', flush=True)
        except Exception as error:
            errors[source["region"]] = str(error)
            pools[source["region"]] = BASE_US if source["region"] == "United States" else []
            print(f'{source["region"]}: constituent discovery failed: {error}', flush=True)
    entries = []
    used = set()
    for source in SOURCES:
        selected = []
        for symbol in pools[source["region"]]:
            if symbol in used:
                continue
            selected.append(symbol)
            used.add(symbol)
            if len(selected) >= source["quota"]:
                break
        for symbol in selected:
            entries.append({key:source[key] for key in ("region","benchmark","currency")} | {"symbol":symbol})
    if len(entries) < TARGET_COUNT:
        for source in SOURCES:
            for symbol in pools[source["region"]][source["quota"]:]:
                if symbol in used:
                    continue
                entries.append({key:source[key] for key in ("region","benchmark","currency")} | {"symbol":symbol})
                used.add(symbol)
                if len(entries) >= TARGET_COUNT:
                    break
            if len(entries) >= TARGET_COUNT:
                break
    if len(entries) < 400:
        raise RuntimeError(f"global universe discovery produced only {len(entries)} symbols: {errors}")
    return entries[:TARGET_COUNT], errors

def last_close(symbol):
    frame = yf.download(symbol, period="10d", interval="1d", auto_adjust=True, progress=False, threads=False)
    if frame.empty:
        raise ValueError("no FX data")
    if getattr(frame.columns, "nlevels", 1) > 1:
        frame.columns = frame.columns.get_level_values(0)
    value = finite(frame["Close"].dropna().iloc[-1])
    if not value:
        raise ValueError("invalid FX data")
    return value

FX_CACHE = {"USD":1.0}
def currency_to_usd(currency):
    code = str(currency or "USD").upper()
    if code in {"GBX","GBPENCE","GBP PENCE"}:
        return currency_to_usd("GBP") * .01
    if code in FX_CACHE:
        return FX_CACHE[code]
    try:
        rate = last_close(f"{code}USD=X")
    except Exception:
        rate = 1 / last_close(f"USD{code}=X")
    FX_CACHE[code] = rate
    return rate

def price_rows(symbol, usd_factor=1.0):
    frame = yf.download(symbol, period="18mo", interval="1d", auto_adjust=True, progress=False, threads=False)
    if frame.empty:
        raise ValueError("no price history")
    if getattr(frame.columns, "nlevels", 1) > 1:
        frame.columns = frame.columns.get_level_values(0)
    output = []
    for stamp, row in frame.tail(340).iterrows():
        values = {key:finite(row.get(key)) for key in ("Open","High","Low","Close","Volume")}
        if all(values[key] is not None for key in ("Open","High","Low","Close")):
            output.append({
                "date":stamp.strftime("%Y-%m-%d"),
                "open":round(values["Open"] * usd_factor, 6),
                "high":round(values["High"] * usd_factor, 6),
                "low":round(values["Low"] * usd_factor, 6),
                "close":round(values["Close"] * usd_factor, 6),
                "volume":int(values["Volume"] or 0)
            })
    if len(output) < 253:
        raise ValueError("insufficient price history")
    return output

def fundamentals(symbol, default_currency):
    info = yf.Ticker(symbol).get_info()
    result = {
        "trailingPE":finite(info.get("trailingPE")),
        "forwardPE":finite(info.get("forwardPE")),
        "pegRatio":finite(info.get("pegRatio")),
        "earningsGrowth":finite(info.get("earningsQuarterlyGrowth") or info.get("earningsGrowth")),
        "sector":str(info.get("sector") or "Unknown")[:80],
        "currency":str(info.get("currency") or default_currency or "USD")[:12],
        "exchange":str(info.get("exchange") or "Unknown")[:40],
        "name":str(info.get("shortName") or info.get("longName") or symbol)[:120]
    }
    valid = [result["trailingPE"],result["forwardPE"],result["pegRatio"]]
    if sum(value is not None and value > 0 for value in valid) < 2:
        raise ValueError("insufficient valuation coverage")
    return result

def main():
    universe, discovery_errors = build_universe()
    benchmark_tickers = sorted({item["benchmark"] for item in universe})
    benchmarks = {}
    for symbol in benchmark_tickers:
        try:
            benchmarks[symbol] = price_rows(symbol)
        except Exception as error:
            print(f"Benchmark {symbol}: {error}", flush=True)
    if "SPY" not in benchmarks:
        benchmarks["SPY"] = price_rows("SPY")
    snapshot = {
        "schemaVersion":2,
        "generatedAt":datetime.now(timezone.utc).isoformat(),
        "source":"Yahoo Finance via scheduled GitHub Actions; index constituents from public index tables",
        "pricing":"OHLC converted to current USD equivalents for comparable sizing; historical returns exclude changing FX rates",
        "spy":benchmarks["SPY"],
        "benchmarks":benchmarks,
        "universe":[item["symbol"] for item in universe],
        "universeMeta":{item["symbol"]:item for item in universe},
        "stocks":{},
        "errors":{},
        "discoveryErrors":discovery_errors
    }
    for index, item in enumerate(universe, 1):
        symbol = item["symbol"]
        try:
            fundamental = fundamentals(symbol, item["currency"])
            fx = currency_to_usd(fundamental["currency"])
            meta = item | {
                "currency":fundamental["currency"],
                "currencyToUSD":fx,
                "exchange":fundamental["exchange"],
                "name":fundamental["name"]
            }
            snapshot["stocks"][symbol] = {
                "rows":price_rows(symbol, fx),
                "fundamentals":fundamental,
                "meta":meta
            }
            print(f"[{index}/{len(universe)}] {symbol}: ok", flush=True)
        except Exception as error:
            snapshot["errors"][symbol] = str(error)[:180]
            print(f"[{index}/{len(universe)}] {symbol}: {error}", flush=True)
        time.sleep(.08)
    output = Path("market-data/universe.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, separators=(",",":"), allow_nan=False), encoding="utf-8")
    if len(snapshot["stocks"]) < 250:
        raise RuntimeError(f'only {len(snapshot["stocks"])} global stocks had complete data')
    print(f'Wrote {len(snapshot["stocks"])} global stocks; {len(snapshot["errors"])} incomplete.')

if __name__ == "__main__":
    main()
