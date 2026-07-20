const idr = value => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0
}).format(value);
const number = value => new Intl.NumberFormat('en-US').format(value);
const parseIdr = value => Number(String(value).replace(/\D/g, '')) || 0;
const formatIdrInput = input => {
  const value = parseIdr(input.value);
  input.value = value ? `Rp ${new Intl.NumberFormat('id-ID').format(value)}` : '';
};

function calculate() {
  const listedPrice = parseIdr(document.getElementById('listedPrice').value);
  const rap = Math.max(0, Number(document.getElementById('calculatorRap').value) || 0);
  const rate = Number(document.getElementById('calculatorRate').value);
  const purchaseSource = document.querySelector('input[name="purchaseSource"]:checked').value;
  const taxed = purchaseSource === 'limitedsmarket';
  const price = Math.round(listedPrice * (taxed ? 1.053 : 1));
  const robuxSell = Math.round(rap * 0.7);
  const sellIdr = robuxSell * rate;
  const profit = sellIdr - price;
  const ratio = price ? profit / price * 100 : null;

  document.getElementById('resultPrice').textContent = idr(price);
  document.getElementById('taxHelp').textContent = taxed ? 'Price before the 5.3% LimitedsMarket tax.' : 'Direct Seller purchases have no 5.3% tax.';
  document.getElementById('priceHelp').textContent = taxed ? 'Listed price + 5.3% tax' : 'Direct Seller price · no tax';
  document.getElementById('resultValue').textContent = rap ? idr(Math.round(price * 1000 / rap)) : '—';
  document.getElementById('resultRobux').textContent = number(robuxSell);
  document.getElementById('resultSellIdr').textContent = idr(sellIdr);
  const profitElement = document.getElementById('resultProfit');
  profitElement.textContent = idr(profit);
  profitElement.className = profit >= 0 ? 'positive' : 'negative';
  const ratioElement = document.getElementById('resultRatio');
  ratioElement.textContent = ratio == null ? '—' : `${ratio.toFixed(2)}%`;
  ratioElement.className = ratio == null ? '' : profit >= 0 ? 'positive' : 'negative';
}

document.getElementById('calculator').addEventListener('input', event => {
  if (event.target.id === 'listedPrice') formatIdrInput(event.target);
  calculate();
});
document.getElementById('calculator').addEventListener('change', calculate);
document.getElementById('calculator').addEventListener('reset', () => setTimeout(() => {
  formatIdrInput(document.getElementById('listedPrice'));
  calculate();
}));
formatIdrInput(document.getElementById('listedPrice'));
calculate();
