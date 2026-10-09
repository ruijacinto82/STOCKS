const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");

const source = readFileSync(path.join(__dirname, "..", "app", "api", "stocks", "route.ts"), "utf8");
const compiled = transformSync(source, {
  jsc: { parser: { syntax: "typescript" }, target: "es2022" },
  module: { type: "commonjs" },
  isModule: true,
}).code;

function harness(quoteFields = { fiftyTwoWeekLow: 5.25, fiftyTwoWeekHigh: 30.75 }) {
  const requests = [];
  const module = { exports: {} };
  class YahooFinance {
    async quote() {
      return { longName: "Test stock", currency: "EUR", ...quoteFields };
    }
    async chart(symbol, options) {
      requests.push({ symbol, ...options });
      return {
        quotes: [
          { date: options.period1, close: 10 },
          { date: options.period2, close: 20 },
          { date: options.period2, close: null },
        ],
      };
    }
  }
  vm.runInNewContext(compiled, {
    exports: module.exports,
    require(name) {
      if (name === "yahoo-finance2") return YahooFinance;
      if (name === "next/server") return { NextResponse: { json: (data, options) => ({ data, ...options }) } };
      throw new Error(`Unexpected import: ${name}`);
    },
    console,
  });
  return { api: module.exports, requests };
}

test("daily ranges request the full history and return available points without null prices", async () => {
  for (const [range, days] of [
    ["1mo", 31], ["6mo", 183], ["1y", 366], ["2y", 731], ["5y", 1827], ["10y", 3653],
  ]) {
    const store = harness();
    const response = await store.api.GET({
      nextUrl: new URL(`https://example.test/api/stocks?symbols=EDP.LS&range=${range}`),
    });
    const request = store.requests[0];
    assert.equal(request.interval, "1d");
    assert.equal(request.period2.getTime() - request.period1.getTime(), days * 86400000);
    assert.equal(response.data.stocks[0].points.length, 2);
    assert.equal(response.data.stocks[0].points[0].date, request.period1.toISOString());
    assert.equal(response.headers["Cache-Control"], "s-maxage=300, stale-while-revalidate=600");
  }
});

test("intraday intervals and invalid range fallback remain unchanged", async () => {
  for (const [range, interval, days] of [["1d", "5m", 7], ["5d", "15m", 10], ["invalid", "1d", 31]]) {
    const store = harness();
    await store.api.GET({
      nextUrl: new URL(`https://example.test/api/stocks?symbols=EDP.LS&range=${range}`),
    });
    assert.equal(store.requests[0].interval, interval);
    assert.equal(store.requests[0].period2 - store.requests[0].period1, days * 86400000);
  }
});

test("52-week extrema come from the quote regardless of the selected chart range", async () => {
  for (const range of ["1d", "5d", "1mo", "1y", "10y"]) {
    const store = harness();
    const response = await store.api.GET({
      nextUrl: new URL(`https://example.test/api/stocks?symbols=EDP.LS&range=${range}`),
    });
    const stock = response.data.stocks[0];
    assert.equal(stock.fiftyTwoWeekLow, 5.25);
    assert.equal(stock.fiftyTwoWeekHigh, 30.75);
    assert.equal(stock.currency, "EUR");
    assert.notEqual(stock.fiftyTwoWeekLow, stock.points[0]?.close);
  }
});

test("missing or invalid 52-week extrema remain unavailable without discarding chart data", async () => {
  for (const fields of [
    {}, { fiftyTwoWeekLow: null, fiftyTwoWeekHigh: undefined },
    { fiftyTwoWeekLow: NaN, fiftyTwoWeekHigh: Infinity },
    { fiftyTwoWeekLow: "5.25", fiftyTwoWeekHigh: "30.75" },
  ]) {
    const store = harness(fields);
    const response = await store.api.GET({ nextUrl: new URL("https://example.test/api/stocks?symbols=EDP.LS") });
    const stock = response.data.stocks[0];
    assert.equal(stock.fiftyTwoWeekLow, null);
    assert.equal(stock.fiftyTwoWeekHigh, null);
    assert.equal(stock.points.length, 2);
  }
  const store = harness({ fiftyTwoWeekLow: 0, fiftyTwoWeekHigh: 4 });
  const response = await store.api.GET({ nextUrl: new URL("https://example.test/api/stocks?symbols=EDP.LS") });
  assert.equal(response.data.stocks[0].fiftyTwoWeekLow, 0);
  const partial = harness({ fiftyTwoWeekHigh: 4 });
  const partialResponse = await partial.api.GET({ nextUrl: new URL("https://example.test/api/stocks?symbols=EDP.LS") });
  assert.equal(partialResponse.data.stocks[0].fiftyTwoWeekLow, null);
  assert.equal(partialResponse.data.stocks[0].fiftyTwoWeekHigh, 4);
});
