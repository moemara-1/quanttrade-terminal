import { Component, useMemo, useState, type ReactNode } from 'react';
import { FastFinancialChart } from '@pairlens/fast-financial-charts/react';
import type { ChartSeriesInput, ChartThemeInput } from '@pairlens/fast-financial-charts/types';
import type { Candle, Market } from '../shared/types';

const theme: ChartThemeInput = {
  background: '#111615', axisBackground: '#111615', grid: '#202825', axisText: '#8d9b93',
  upCandle: '#83c6ad', downCandle: '#d58b83', crosshair: '#bac4bd', hudBg: '#18211e', hudText: '#e8ebe3',
  fontFamilyMono: 'Consolas, monospace', fontSizeAxis: 11,
};
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="empty-state">The chart could not initialize. Enable WebGL2 in your browser, then reload. Market data and order review remain available.</div> : this.props.children;
  }
}
export function MarketChart({ candles, market }: { candles: Candle[]; market: Market }) {
  const [ema, setEma] = useState(false);
  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const series = useMemo<ChartSeriesInput[]>(() => [{
    id: market.symbol, label: market.symbol, pricePrecision: market.priceDecimals, color: '#83c6ad',
    bars: candles.map(c => ({ ts: c.time * 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
  }], [candles, market.symbol, market.priceDecimals]);
  return <>
    <div className="chart-toolbar"><span className="tag">1H</span><button className={chartType === 'candles' ? 'text-button active' : 'text-button'} onClick={() => setChartType('candles')}>Candles</button><button className={chartType === 'line' ? 'text-button active' : 'text-button'} onClick={() => setChartType('line')}>Line</button><span className="toolbar-divider" /><button className={ema ? 'text-button active' : 'text-button'} aria-pressed={ema} onClick={() => setEma(!ema)}>EMA 21</button><span className="chart-credit">PAIRLENS ENGINE</span></div>
    <div className="chart-canvas"><ChartBoundary><FastFinancialChart series={series} timeframe="1h" chartType={chartType} theme={theme} defaultViewport={{ type: 'last-bars', bars: 90 }} indicators={ema ? [{ type: 'EMA', seriesId: market.symbol, params: { period: 21 }, pane: 'overlay' }] : []} style={{ height: '100%', width: '100%' }} /></ChartBoundary></div>
  </>;
}
