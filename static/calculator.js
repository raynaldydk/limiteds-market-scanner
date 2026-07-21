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
document.getElementById('calculatorScanRap').addEventListener('click', async () => {
  const name = document.getElementById('calculatorItemName').value.trim();
  const button = document.getElementById('calculatorScanRap');
  const status = document.getElementById('calculatorRapStatus');
  status.hidden = false;
  if (!name) { status.textContent = 'Enter an exact item name first.'; status.className = 'rap-scan-status error'; return; }
  button.disabled = true; button.textContent = 'Scanning...'; status.textContent = 'Looking up current Roblox RAP...'; status.className = 'rap-scan-status';
  try {
    const response = await fetch(`/api/roblox/rap?name=${encodeURIComponent(name)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'RAP could not be found');
    document.getElementById('calculatorRap').value = data.rap;
    const preview = document.getElementById('calculatorItemPreview');
    if (data.thumbnailUrl) {
      document.getElementById('calculatorItemImage').src = data.thumbnailUrl;
      document.getElementById('calculatorItemImage').alt = `${name} preview`;
      document.getElementById('calculatorItemCaption').textContent = name;
      preview.hidden = false;
    } else preview.hidden = true;
    calculate(); status.textContent = `Current RAP found: ${number(data.rap)}.`; status.className = 'rap-scan-status success';
  } catch (error) { status.textContent = error.message; status.className = 'rap-scan-status error'; }
  finally { button.disabled = false; button.textContent = 'Scan RAP'; }
});
document.getElementById('calculator').addEventListener('reset', () => setTimeout(() => {
  formatIdrInput(document.getElementById('listedPrice'));
  document.getElementById('calculatorRapStatus').hidden = true;
  document.getElementById('calculatorItemPreview').hidden = true;
  document.getElementById('calculatorItemImage').removeAttribute('src');
  calculate();
}));
formatIdrInput(document.getElementById('listedPrice'));
calculate();
