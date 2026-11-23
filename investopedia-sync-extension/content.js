(() => {
  const ext = globalThis.browser || globalThis.chrome;
  const LAB_ORIGIN = 'https://eisakir.github.io';
  const LAB_PATH = '/Stocks.github.io/';
  const isLab = location.origin === LAB_ORIGIN && location.pathname.startsWith(LAB_PATH);
  const isInvestopedia = /(^|\.)investopedia\.com$/i.test(location.hostname) && /simulator/i.test(location.pathname);

  const storageGet = key => new Promise((resolve, reject) => {
    try {
      const result = ext.storage.local.get(key);
      if (result && typeof result.then === 'function') result.then(resolve, reject);
      else ext.storage.local.get(key, value => ext.runtime.lastError ? reject(ext.runtime.lastError) : resolve(value));
    } catch (error) { reject(error); }
  });
  const storageSet = value => new Promise((resolve, reject) => {
    try {
      const result = ext.storage.local.set(value);
      if (result && typeof result.then === 'function') result.then(resolve, reject);
      else ext.storage.local.set(value, () => ext.runtime.lastError ? reject(ext.runtime.lastError) : resolve());
    } catch (error) { reject(error); }
  });

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const number = value => {
    const parsed = Number(clean(value).replace(/[$,%(),]/g, match => match === '(' ? '-' : '').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const symbol = value => (clean(value).match(/\b[A-Z][A-Z.\-]{0,9}\b/) || [])[0] || '';
  const headerIndex = (headers, patterns) => headers.findIndex(header => patterns.some(pattern => pattern.test(header)));
  const tableData = table => {
    const rows = [...table.querySelectorAll('tr')];
    if (rows.length < 2) return null;
    const headers = [...rows[0].querySelectorAll('th,td')].map(cell => clean(cell.textContent).toLowerCase());
    return { headers, rows: rows.slice(1).map(row => [...row.querySelectorAll('td,th')].map(cell => clean(cell.textContent))) };
  };

  function scrape() {
    const holdings = [];
    const pendingOrders = [];
    [...document.querySelectorAll('table')].forEach(table => {
      const data = tableData(table);
      if (!data) return;
      const { headers, rows } = data;
      const symbolAt = headerIndex(headers, [/^symbol$/, /ticker/]);
      const quantityAt = headerIndex(headers, [/quantity/, /shares/, /^qty$/]);
      if (symbolAt < 0 || quantityAt < 0) return;
      const transactionAt = headerIndex(headers, [/^transaction$/, /trade type/, /order type/]);
      const averageAt = headerIndex(headers, [/purchase price/, /average price/, /avg.*price/, /cost basis/]);
      const currentAt = headerIndex(headers, [/current price/, /last price/, /^price$/]);
      const valueAt = headerIndex(headers, [/market value/, /total value/, /position value/]);
      const statusAt = headerIndex(headers, [/status/]);
      rows.forEach(cells => {
        const ticker = symbol(cells[symbolAt]);
        const quantity = number(cells[quantityAt]);
        if (!ticker || !(quantity > 0)) return;
        if (transactionAt >= 0 || /pending|open orders/i.test(clean(table.closest('section,div')?.textContent).slice(0, 250))) {
          pendingOrders.push({
            symbol: ticker,
            quantity,
            transaction: transactionAt >= 0 ? cells[transactionAt] : 'Pending order',
            price: currentAt >= 0 ? number(cells[currentAt]) : null,
            status: statusAt >= 0 ? cells[statusAt] : 'PENDING'
          });
        } else {
          const averagePrice = averageAt >= 0 ? number(cells[averageAt]) : null;
          const currentPrice = currentAt >= 0 ? number(cells[currentAt]) : null;
          holdings.push({
            symbol: ticker,
            quantity,
            averagePrice,
            currentPrice,
            marketValue: valueAt >= 0 ? number(cells[valueAt]) : currentPrice ? currentPrice * quantity : null
          });
        }
      });
    });

    const pageText = clean(document.body.innerText);
    const labeledMoney = label => {
      const match = pageText.match(new RegExp(label + '\\s*[:$]?\\s*\\$?([0-9,]+(?:\\.[0-9]{2})?)', 'i'));
      return match ? number(match[1]) : null;
    };
    const dedupe = list => [...new Map(list.map(item => [item.symbol + ':' + item.quantity + ':' + (item.transaction || ''), item])).values()];
    return {
      version: 1,
      capturedAt: new Date().toISOString(),
      sourceUrl: location.href,
      holdings: dedupe(holdings),
      pendingOrders: dedupe(pendingOrders),
      account: {
        accountValue: labeledMoney('(?:account value|portfolio value|total value)'),
        cash: labeledMoney('(?:cash|available cash)'),
        buyingPower: labeledMoney('buying power')
      }
    };
  }

  if (isInvestopedia) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Capture for Stock Strategy Lab';
    Object.assign(button.style, {
      position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647',
      padding: '12px 16px', border: '0', borderRadius: '10px', background: '#0b1627',
      color: '#fff', font: '600 14px system-ui', boxShadow: '0 6px 20px rgba(0,0,0,.25)', cursor: 'pointer'
    });
    button.addEventListener('click', async () => {
      const snapshot = scrape();
      const pageText = clean(document.body.innerText).toLowerCase();
      const validEmptyPortfolio = /no (stock )?holdings( yet)?/.test(pageText);
      if (!snapshot.holdings.length && !snapshot.pendingOrders.length && !validEmptyPortfolio) {
        button.textContent = 'Open Portfolio or Pending Trades first';
        setTimeout(() => { button.textContent = 'Capture for Stock Strategy Lab'; }, 3500);
        return;
      }
      snapshot.validEmptyPortfolio = validEmptyPortfolio;
      await storageSet({ investopediaSnapshot: snapshot });
      button.textContent = validEmptyPortfolio ? 'Empty portfolio captured ✓' : 'Captured ✓ Open Stock Strategy Lab';
      setTimeout(() => { button.textContent = 'Capture for Stock Strategy Lab'; }, 3500);
    });
    document.documentElement.appendChild(button);
  }

  if (isLab) {
    window.addEventListener('message', async event => {
      if (event.source !== window || event.origin !== LAB_ORIGIN || event.data?.type !== 'STOCK_LAB_REQUEST_INVESTOPEDIA') return;
      try {
        const stored = await storageGet('investopediaSnapshot');
        window.postMessage({ type: 'STOCK_LAB_INVESTOPEDIA_RESPONSE', requestId: event.data.requestId, snapshot: stored.investopediaSnapshot || null }, LAB_ORIGIN);
      } catch (error) {
        window.postMessage({ type: 'STOCK_LAB_INVESTOPEDIA_RESPONSE', requestId: event.data.requestId, error: error.message }, LAB_ORIGIN);
      }
    });
    window.postMessage({ type: 'STOCK_LAB_EXTENSION_READY' }, LAB_ORIGIN);
  }
})();
