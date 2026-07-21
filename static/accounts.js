const ACCOUNTS_KEY = 'limiteds-market-accounts';
const SELL_RATE_KEY = 'limiteds-market-account-sell-rate';
const byId = id => document.getElementById(id);
const integer = value => Math.max(0, Math.round(Number(value) || 0));
const formatNumber = value => new Intl.NumberFormat('en-US').format(value);
const formatIdr = value => new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(value);
const formatDateOnly = value => value ? new Intl.DateTimeFormat('en-GB').format(new Date(value)) : '';
const isUnderage = account => String(account.username || '').toLocaleLowerCase() === 'sssssssel6' || account.underage === true;
const accountAssetValue = account => integer(account.sendLimit) >= 10000 ? 25000 : 0;

let accounts = loadAccounts();
try { byId('accountSellRate').value = localStorage.getItem(SELL_RATE_KEY) || '130'; } catch {}

function loadAccounts() {
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

async function saveAccounts() {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  const response = await fetch('/api/accounts', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ accounts }) });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Account file could not be saved');
  }
}

async function loadStoredAccounts() {
  const browserBackup = accounts;
  try {
    const response = await fetch('/api/accounts');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Account file could not be loaded');
    if (data.accounts.length) {
      accounts = data.accounts.map(account => ({ ...account, underage:isUnderage(account) }));
      await saveAccounts();
    }
    else if (browserBackup.length) await saveAccounts();
    render();
    if (accounts.length) await refreshInventories(true);
  } catch (error) {
    const status = byId('connectionStatus');
    status.hidden = false; status.textContent = `${error.message}. Using browser backup.`; status.className = 'connection-status error';
  }
}

async function refreshInventories(automatic = false) {
  const status = byId('connectionStatus');
  const button = byId('refreshInventory');
  button.disabled = true;
  status.hidden = false;
  status.className = 'connection-status';
  let refreshed = 0;
  const failed = [];
  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index];
    status.textContent = `${automatic ? 'Automatically refreshing' : 'Refreshing'} inventory ${index + 1}/${accounts.length}: ${account.username}…`;
    try {
      const response = await fetch(`/api/roblox/account?username=${encodeURIComponent(account.username)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Roblox inventory lookup failed');
      accounts[index] = {
        ...account,
        robloxUserId:data.robloxUserId,
        username:data.username,
        displayName:data.displayName,
        avatarUrl:data.avatarUrl,
        profileUrl:data.profileUrl,
        limitedItems:data.limitedItems.join(', '),
        limitedRapTotal:integer(data.limitedRapTotal)
      };
      refreshed++;
      render();
    } catch (error) { failed.push(`${account.username}: ${error.message}`); }
  }
  try {
    if (refreshed) await saveAccounts();
    status.textContent = failed.length
      ? `Refreshed ${refreshed}/${accounts.length}. Failed: ${failed.join('; ')}`
      : `Inventory refreshed for ${refreshed} account${refreshed === 1 ? '' : 's'}.`;
    status.className = `connection-status ${failed.length ? 'error' : 'success'}`;
  } catch (error) {
    status.textContent = error.message;
    status.className = 'connection-status error';
  } finally { button.disabled = false; }
}

function escapeHtml(value) {
  const node = document.createElement('div');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function formatLimitedItems(value) {
  return String(value || '').split(',').map(item => {
    const words = item.trim().split(/\s+/).filter(Boolean);
    const pairs = [];
    for (let index = 0; index < words.length; index += 2) pairs.push(words.slice(index, index + 2).map(escapeHtml).join('&nbsp;'));
    return pairs.join(' ');
  }).filter(Boolean).join(',<wbr> ');
}

function render() {
  byId('accountCount').textContent = formatNumber(accounts.length);
  byId('totalRobux').textContent = formatNumber(accounts.reduce((sum, account) => sum + integer(account.robux), 0));
  byId('totalRobuxPending').textContent = formatNumber(accounts.reduce((sum, account) => sum + integer(account.robuxPending), 0));
  const sendLimitUsed = accounts.reduce((sum, account) => sum + integer(account.sendLimitUsed), 0);
  const sendLimit = accounts.reduce((sum, account) => sum + integer(account.sendLimit), 0);
  byId('totalLimitUsed').textContent = `${formatNumber(sendLimitUsed)} / ${formatNumber(sendLimit)}`;
  byId('plusActive').textContent = formatNumber(accounts.filter(account => account.plusStatus === 'active').length);
  byId('totalLimitedRap').textContent = formatNumber(accounts.reduce((sum, account) => sum + integer(account.limitedRapTotal), 0));
  const estimatedRobux = accounts.reduce((sum, account) =>
    sum + Math.round(integer(account.limitedRapTotal) * 0.7) + integer(account.robux) + integer(account.robuxPending), 0);
  const sellRate = Number(byId('accountSellRate').value);
  const accountAssets = accounts.reduce((sum, account) => sum + accountAssetValue(account), 0);
  byId('estimatedRobux').textContent = formatNumber(estimatedRobux);
  byId('estimatedIdr').textContent = formatIdr(estimatedRobux * sellRate + accountAssets);
  byId('accountsEmpty').hidden = accounts.length > 0;
  byId('accountsGrid').innerHTML = accounts.map(account => {
    const limitedToRobux = Math.round(integer(account.limitedRapTotal) * 0.7);
    const estimatedAccountRobux = limitedToRobux + integer(account.robux) + integer(account.robuxPending);
    const remainingSendLimit = Math.max(0, integer(account.sendLimit) - integer(account.sendLimitUsed));
    return `
    <tr>
      <td><strong>${escapeHtml(account.username)}</strong></td>
      <td>${account.avatarUrl ? `<div class="account-avatar"><img src="${escapeHtml(account.avatarUrl)}" alt="${escapeHtml(account.username)} avatar"><a class="profile-icon" href="${escapeHtml(account.profileUrl || `https://www.roblox.com/users/${account.robloxUserId}/profile`)}" target="_blank" rel="noopener" title="Open Roblox profile"><img src="https://www.roblox.com/favicon.ico" alt="Roblox"></a><a class="profile-icon" href="https://www.rolimons.com/player/${escapeHtml(account.robloxUserId)}" target="_blank" rel="noopener" title="Open Rolimon's profile"><img src="https://www.rolimons.com/favicon.ico" alt="Rolimon's"></a></div>` : '—'}</td>
      <td class="limited-items">${formatLimitedItems(account.limitedItems) || '—'}</td>
      <td class="num">${formatNumber(integer(account.limitedRapTotal))}</td>
      <td class="num">${formatNumber(limitedToRobux)}</td>
      <td class="num">${formatNumber(integer(account.robux))}</td>
      <td class="num">${formatNumber(integer(account.robuxPending))}</td>
      <td class="num">${formatNumber(integer(account.sendLimit))}</td>
      <td class="num">${formatNumber(integer(account.sendLimitUsed))}</td>
      <td class="num">${formatIdr(accountAssetValue(account))}</td>
      <td class="num quota">${formatNumber(estimatedAccountRobux)} / ${formatNumber(remainingSendLimit)}</td>
      <td><span class="account-status ${account.plusStatus === 'active' ? 'active' : ''}">${account.plusStatus === 'active' ? 'Active' : 'Inactive'}</span>${account.plusExpiresAt ? `<small class="plus-expiry">Until ${formatDateOnly(account.plusExpiresAt)}</small>` : ''}</td>
      <td><span class="underage-status ${isUnderage(account) ? 'true' : 'false'}">${isUnderage(account) ? 'True' : 'False'}</span></td>
      <td><div class="row-actions"><button class="edit-account secondary" data-id="${escapeHtml(account.id)}" type="button">Edit</button><button class="delete-account secondary" data-id="${escapeHtml(account.id)}" type="button">Delete</button></div></td>
    </tr>`;
  }).join('');
}

function openDialog(account) {
  byId('accountForm').reset();
  byId('dialogTitle').textContent = 'Edit account';
  byId('accountId').value = account.id;
  byId('username').value = account?.username || '';
  byId('avatarUrl').value = account?.avatarUrl || '';
  byId('limitedItems').value = account?.limitedItems || '';
  byId('robux').value = integer(account?.robux);
  byId('robuxPending').value = integer(account?.robuxPending);
  byId('sendLimit').value = integer(account?.sendLimit);
  byId('sendLimitUsed').value = integer(account?.sendLimitUsed);
  byId('plusStatus').value = account?.plusStatus || 'inactive';
  byId('underage').value = isUnderage(account) ? 'true' : 'false';
  byId('accountDialog').showModal();
  byId('username').focus();
}

byId('accountForm').addEventListener('submit', event => {
  event.preventDefault();
  const id = byId('accountId').value;
  const existing = accounts.find(item => item.id === id) || {};
  const account = {
    ...existing, id, username:byId('username').value.trim(), avatarUrl:byId('avatarUrl').value.trim(),
    limitedItems:byId('limitedItems').value.trim(), robux:integer(byId('robux').value), robuxPending:integer(byId('robuxPending').value),
    sendLimit:integer(byId('sendLimit').value), sendLimitUsed:integer(byId('sendLimitUsed').value),
    plusStatus:byId('plusStatus').value, underage:byId('underage').value === 'true'
  };
  const index = accounts.findIndex(item => item.id === id);
  if (index >= 0) accounts[index] = account;
  saveAccounts().catch(error => alert(error.message)); render(); byId('accountDialog').close();
});

byId('accountsGrid').addEventListener('click', event => {
  const id = event.target.dataset.id;
  if (!id) return;
  if (event.target.classList.contains('edit-account')) openDialog(accounts.find(account => account.id === id));
  if (event.target.classList.contains('delete-account') && confirm('Delete this account record?')) {
    accounts = accounts.filter(account => account.id !== id); saveAccounts().catch(error => alert(error.message)); render();
  }
});

async function syncPublicAccount(username) {
  const status = byId('connectionStatus');
  status.hidden = false; status.textContent = 'Syncing Roblox account…'; status.className = 'connection-status';
  try {
    const response = await fetch(`/api/roblox/account?username=${encodeURIComponent(username)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Roblox account sync failed');
    const id = `roblox-${data.robloxUserId}`;
    const existing = accounts.find(account => account.id === id) || {};
    const account = {
      ...existing, id, robloxUserId:data.robloxUserId, username:data.username, displayName:data.displayName,
      avatarUrl:data.avatarUrl, profileUrl:data.profileUrl, limitedItems:data.limitedItems.join(', '), limitedRapTotal:integer(data.limitedRapTotal),
      robux:integer(existing.robux), robuxPending:integer(existing.robuxPending), sendLimit:integer(existing.sendLimit),
      sendLimitUsed:integer(existing.sendLimitUsed), plusStatus:existing.plusStatus || 'inactive',
      underage:data.username.toLocaleLowerCase() === 'sssssssel6' || existing.underage === true
    };
    const index = accounts.findIndex(item => item.id === id);
    if (index >= 0) accounts[index] = account; else accounts.push(account);
    await saveAccounts(); render(); status.textContent = `${data.username} found and saved.`; status.classList.add('success');
    byId('usernameDialog').close();
  } catch (error) { status.textContent = error.message; status.classList.add('error'); }
}

byId('addAccount').addEventListener('click', () => { byId('usernameForm').reset(); byId('usernameDialog').showModal(); byId('lookupUsername').focus(); });
byId('refreshInventory').addEventListener('click', () => refreshInventories(false));
byId('usernameForm').addEventListener('submit', event => { event.preventDefault(); syncPublicAccount(byId('lookupUsername').value.trim()); });
byId('closeUsernameDialog').addEventListener('click', () => byId('usernameDialog').close());
byId('cancelUsername').addEventListener('click', () => byId('usernameDialog').close());
byId('accountSellRate').addEventListener('change', () => {
  try { localStorage.setItem(SELL_RATE_KEY, byId('accountSellRate').value); } catch {}
  render();
});
byId('closeDialog').addEventListener('click', () => byId('accountDialog').close());
byId('cancelAccount').addEventListener('click', () => byId('accountDialog').close());
render();
loadStoredAccounts();
