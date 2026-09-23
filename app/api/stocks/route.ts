import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();
const allowedRanges = new Set(["1d", "1mo", "6mo", "1y"]);
const periods: Record<string, { days: number; interval: "5m" | "1d" }> = {
  "1d": { days: 1, interval: "5m" },
  "1mo": { days: 31, interval: "1d" },
  "6mo": { days: 183, interval: "1d" },
  "1y": { days: 366, interval: "1d" },
};
export async function GET(request: NextRequest) {
  const raw =
    request.nextUrl.searchParams.get("symbols") ||
    "AAPL,MSFT,NVDA,EDP.LS,SAN.MC,SAP.DE";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 12);
  const requestedRange = request.nextUrl.searchParams.get("range") || "1mo";
  const range = allowedRanges.has(requestedRange) ? requestedRange : "1mo";
  const config = periods[range];
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - config.days * 86400000);
  const stocks = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const [quote, chart] = await Promise.all([
          yahooFinance.quote(symbol),
          yahooFinance.chart(symbol, {
            period1,
            period2,
            interval: config.interval,
          }),
        ]);
        return {
          symbol,
          name: quote.longName || quote.shortName || symbol,
          currency: quote.currency,
          points: chart.quotes
            .filter((p) => p.close != null)
            .map((p) => ({ date: p.date.toISOString(), close: p.close })),
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
    }),
  );
  return NextResponse.json(
    { stocks },
    {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" },
    },
  );
}
