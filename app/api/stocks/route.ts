import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();
const MAX_SYMBOLS = 24;
const allowedRanges = new Set(["1d", "5d", "1mo", "6mo", "1y"]);
const periods: Record<
  string,
  { days: number; interval: "5m" | "15m" | "1d"; sessionCount?: number }
> = {
  "1d": { days: 7, interval: "5m", sessionCount: 1 },
  "5d": { days: 10, interval: "15m", sessionCount: 5 },
  "1mo": { days: 31, interval: "1d" },
  "6mo": { days: 183, interval: "1d" },
  "1y": { days: 366, interval: "1d" },
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function latestSessions<T extends { date: Date }>(
  points: T[],
  sessionCount: number,
): T[] {
  const sessions = Array.from(
    new Set(points.map((point) => point.date.toISOString().slice(0, 10))),
  ).slice(-sessionCount);
  const visibleSessions = new Set(sessions);
  return points.filter((point) =>
    visibleSessions.has(point.date.toISOString().slice(0, 10)),
  );
}

export async function GET(request: NextRequest) {
  const raw =
    request.nextUrl.searchParams.get("symbols") ||
    "AAPL,MSFT,NVDA,EDP.LS,SAN.MC,SAP.DE";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);
  const requestedRange = request.nextUrl.searchParams.get("range") || "1mo";
  const range = allowedRanges.has(requestedRange) ? requestedRange : "1mo";
  const config = periods[range];
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - config.days * 86400000);
  const stocks = await mapWithConcurrency(
    symbols,
    6,
    async (symbol) => {
      try {
        const [quote, chart] = await Promise.all([
          yahooFinance.quote(symbol),
          yahooFinance.chart(symbol, {
            period1,
            period2,
            interval: config.interval,
          }),
        ]);
        const quotes = chart.quotes.filter(
          (point): point is typeof point & { close: number } => point.close != null,
        );
        const visibleQuotes = config.sessionCount
          ? latestSessions(quotes, config.sessionCount)
          : quotes;

        return {
          symbol,
          name: quote.longName || quote.shortName || symbol,
          currency: quote.currency,
          points: visibleQuotes.map((point) => ({
            date: point.date.toISOString(),
            close: point.close,
          })),
        };
      } catch (err) {
        console.error("=================================");
        console.error("ERRO PARA:", symbol);
        console.error(err);
        console.error("=================================");

        return {
          symbol,
          name: symbol,
          currency: "",
          points: [],
          error: true,
        };
      }
    },
  );
  const cacheControl = range === "1d" || range === "5d"
    ? "s-maxage=60, stale-while-revalidate=120"
    : "s-maxage=300, stale-while-revalidate=600";

  return NextResponse.json(
    { stocks },
    {
      headers: { "Cache-Control": cacheControl },
    },
  );
}
