from __future__ import annotations
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
import yfinance as yf

SYMBOLS = [
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
def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None

def price_rows(symbol):
    frame = yf.download(symbol, period="18mo", interval="1d", auto_adjust=True, progress=False, threads=False)
    if frame.empty:
        raise ValueError("no price history")
    if getattr(frame.columns, "nlevels", 1) > 1:
        frame.columns = frame.columns.get_level_values(0)
    output = []
    for stamp, row in frame.tail(340).iterrows():
        values = {key: finite(row.get(key)) for key in ("Open","High","Low","Close","Volume")}
        if all(values[key] is not None for key in ("Open","High","Low","Close")):
            output.append({
                "date": stamp.strftime("%Y-%m-%d"), "open": round(values["Open"], 6),
                "high": round(values["High"], 6), "low": round(values["Low"], 6),
                "close": round(values["Close"], 6), "volume": int(values["Volume"] or 0)
            })
    if len(output) < 253:
        raise ValueError("insufficient price history")
    return output

def fundamentals(symbol):
    info = yf.Ticker(symbol).get_info()
    result = {
        "trailingPE": finite(info.get("trailingPE")),
        "forwardPE": finite(info.get("forwardPE")),
        "pegRatio": finite(info.get("pegRatio")),
        "earningsGrowth": finite(info.get("earningsQuarterlyGrowth") or info.get("earningsGrowth")),
        "sector": str(info.get("sector") or "Unknown")[:80]
    }
    if sum(value is not None and value > 0 for key, value in result.items() if key != "earningsGrowth") < 2:
        raise ValueError("insufficient valuation coverage")
    return result

def main():
    snapshot = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance via scheduled GitHub Actions",
        "spy": price_rows("SPY"),
        "stocks": {},
        "errors": {}
    }
    for index, symbol in enumerate(SYMBOLS, 1):
        try:
            snapshot["stocks"][symbol] = {"rows": price_rows(symbol), "fundamentals": fundamentals(symbol)}
            print(f"[{index}/{len(SYMBOLS)}] {symbol}: ok", flush=True)
        except Exception as error:
            snapshot["errors"][symbol] = str(error)[:180]
            print(f"[{index}/{len(SYMBOLS)}] {symbol}: {error}", flush=True)
        time.sleep(0.15)
    output = Path("market-data/universe.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    if len(snapshot["stocks"]) < 40:
        raise RuntimeError(f"only {len(snapshot['stocks'])} stocks had complete data")
    print(f"Wrote {len(snapshot['stocks'])} stocks; {len(snapshot['errors'])} incomplete.")

if __name__ == "__main__":
    main()
