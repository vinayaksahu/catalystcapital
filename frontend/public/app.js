/**
 * Catalyst Capital - Frontend Client Application
 * Full-stack implementation for MLM ROI & Referral Platform
 */

const API_BASE = '/api';
let currentUser = null;
let token = localStorage.getItem('catalyst_token') || null;
let allPlans = [];
let selectedPlanForCalc = null;

// Initialize on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  setupEventListeners();

  if (token) {
    await fetchUserProfile();
  } else {
    // Default to quick demo login as Rahul or show login
    updateAuthUI();
    navigate('plans');
  }

  await loadPlans();
});

// Setup event listeners
function setupEventListeners() {
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref');
  if (ref) {
    const regSponsor = document.getElementById('reg-sponsor');
    if (regSponsor) regSponsor.value = ref;
    openModal('registerModal');
  }

  // Withdraw amount change listener for live net calculation
  const withdrawInput = document.getElementById('withdraw-amount');
  if (withdrawInput) {
    withdrawInput.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) || 0;
      // 0% fee
      document.getElementById('withdraw-preview-net').textContent = `$${val.toFixed(2)} USDT`;
    });
  }
}

// ==================== AUTHENTICATION ====================

async function fetchUserProfile() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      updateAuthUI();
      loadDashboard();
    } else {
      logout();
    }
  } catch (err) {
    console.error('Failed to fetch profile:', err);
    logout();
  }
}

function updateAuthUI() {
  const loggedOutBox = document.getElementById('auth-buttons-logged-out');
  const loggedInBox = document.getElementById('auth-buttons-logged-in');
  const adminNavBtn = document.getElementById('admin-nav-btn');

  if (currentUser) {
    loggedOutBox.classList.add('hidden');
    loggedInBox.classList.remove('hidden');

    document.getElementById('user-display-name').textContent = currentUser.full_name || currentUser.username;
    document.getElementById('user-display-role').textContent = currentUser.role.toUpperCase();
    document.getElementById('user-ref-code').textContent = currentUser.referral_code;

    document.getElementById('welcome-username').textContent = currentUser.full_name || currentUser.username;

    // Referral link
    const refLink = `${window.location.origin}/?ref=${currentUser.referral_code}`;
    const refInput = document.getElementById('referral-link-input');
    if (refInput) refInput.value = refLink;

    if (currentUser.role === 'admin') {
      adminNavBtn.classList.remove('hidden');
    } else {
      adminNavBtn.classList.add('hidden');
    }
  } else {
    loggedOutBox.classList.remove('hidden');
    loggedInBox.classList.add('hidden');
    adminNavBtn.classList.add('hidden');
  }

  lucide.createIcons();
}

async function handleLogin(e) {
  e.preventDefault();
  const loginId = document.getElementById('login-id').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId, password })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Login failed');
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('catalyst_token', token);

    closeModal('loginModal');
    updateAuthUI();
    showToast('Welcome back! Logged in successfully.', 'success');
    navigate('dashboard');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const fullName = document.getElementById('reg-fullname').value;
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const phone = document.getElementById('reg-phone').value;
  const sponsorCode = document.getElementById('reg-sponsor').value;
  const password = document.getElementById('reg-password').value;

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, username, email, phone, sponsorCode, password })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Registration failed');
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('catalyst_token', token);

    closeModal('registerModal');
    updateAuthUI();
    showToast(`Account created! Welcome ${currentUser.full_name}`, 'success');
    navigate('dashboard');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Quick demo login for testing
async function quickLogin(username) {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId: username, password: 'Password@123' })
    });
    const data = await res.json();
    if (data.success) {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('catalyst_token', token);
      updateAuthUI();
      showToast(`Logged in as ${currentUser.username} (${currentUser.role})`, 'success');
      navigate('dashboard');
    } else {
      showToast(data.error || 'Demo login failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('catalyst_token');
  updateAuthUI();
  showToast('Logged out successfully', 'info');
  navigate('plans');
}

// ==================== NAVIGATION ====================

function navigate(viewName) {
  const views = ['dashboard', 'plans', 'network', 'wallet', 'calculator', 'admin'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
  });

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.remove('hidden');

  // Update nav item active classes
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => item.classList.remove('active'));

  // Active current button
  navItems.forEach(item => {
    if (item.getAttribute('onclick') && item.getAttribute('onclick').includes(viewName)) {
      item.classList.add('active');
    }
  });

  // Lazy load view specific data
  if (viewName === 'dashboard') loadDashboard();
  if (viewName === 'plans') loadPlans();
  if (viewName === 'network') loadNetwork();
  if (viewName === 'wallet') loadWallet();
  if (viewName === 'calculator') initCalculator();
  if (viewName === 'admin') loadAdminData();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== DASHBOARD VIEW ====================

async function loadDashboard() {
  if (!token) return;

  try {
    // 1. Fetch Wallets Overview
    const walletRes = await fetch(`${API_BASE}/wallet/overview`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const walletData = await walletRes.json();

    if (walletData.success) {
      const w = walletData.wallets;
      document.getElementById('stat-deposit-bal').textContent = `$${w.depositWallet.toFixed(2)}`;
      document.getElementById('stat-roi-bal').textContent = `$${w.roiWallet.toFixed(2)}`;
      document.getElementById('stat-commission-bal').textContent = `$${w.commissionWallet.toFixed(2)}`;
      document.getElementById('stat-total-withdrawable').textContent = `$${w.totalWithdrawable.toFixed(2)}`;
    }

    // 2. Fetch User Investments
    const invRes = await fetch(`${API_BASE}/investments/my`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const invData = await invRes.json();

    if (invData.success) {
      document.getElementById('stat-daily-expected').textContent = `+$${invData.stats.expectedDailyRoi.toFixed(2)} / day`;
      renderDashboardInvestments(invData.investments);
    }

    // 3. Fetch Recent Transactions
    const txRes = await fetch(`${API_BASE}/wallet/transactions?limit=6`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const txData = await txRes.json();

    if (txData.success) {
      renderDashboardTransactions(txData.transactions);
    }

  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

function renderDashboardInvestments(investments) {
  const container = document.getElementById('dashboard-investments-list');
  if (!container) return;

  if (!investments || investments.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 bg-slate-900/60 rounded-xl border border-slate-800">
        <i data-lucide="package-open" class="w-10 h-10 text-slate-500 mx-auto mb-2"></i>
        <p class="text-slate-300 font-semibold text-sm">No active investments found</p>
        <p class="text-xs text-slate-500 mt-1 mb-3">Choose one of the 6 Catalyst Capital packages to start receiving daily returns.</p>
        <button onclick="navigate('plans')" class="px-4 py-1.5 rounded-lg text-xs font-bold bg-brand-cyan text-slate-950 hover:bg-cyan-300">
          Activate Package
        </button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = investments.map(inv => {
    const percent = Math.min(100, Math.round((inv.days_credited / inv.total_days) * 100));
    const isCompleted = inv.status === 'completed';

    return `
      <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full ${isCompleted ? 'bg-slate-500' : 'bg-emerald-400 animate-pulse'}"></span>
            <span class="font-heading font-bold text-white text-sm">${inv.plan_name} ($${inv.amount} USDT)</span>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isCompleted ? 'bg-slate-700 text-slate-300' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}">
            ${isCompleted ? 'COMPLETED' : 'ACTIVE'}
          </span>
        </div>

        <div class="grid grid-cols-3 gap-2 text-xs text-slate-400 my-2">
          <div>Daily: <strong class="text-emerald-400">+$${inv.daily_roi.toFixed(2)}</strong></div>
          <div>Progress: <strong class="text-white">${inv.days_credited} / ${inv.total_days} Days</strong></div>
          <div>Earned: <strong class="text-brand-gold">$${inv.total_earned.toFixed(2)}</strong></div>
        </div>

        <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-2">
          <div class="bg-gradient-to-r from-cyan-400 to-emerald-400 h-full rounded-full" style="width: ${percent}%;"></div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function renderDashboardTransactions(transactions) {
  const container = document.getElementById('dashboard-transactions-list');
  if (!container) return;

  if (!transactions || transactions.length === 0) {
    container.innerHTML = `<div class="text-center py-6 text-xs text-slate-500">No recent transactions</div>`;
    return;
  }

  container.innerHTML = transactions.map(tx => {
    let icon = 'arrow-right';
    let color = 'text-cyan-400';
    let bg = 'bg-cyan-500/10';

    if (tx.type === 'daily_roi') {
      icon = 'trending-up';
      color = 'text-emerald-400';
      bg = 'bg-emerald-500/10';
    } else if (tx.type === 'referral_roi') {
      icon = 'repeat';
      color = 'text-cyan-400';
      bg = 'bg-cyan-500/10';
    } else if (tx.type === 'team_commission') {
      icon = 'sparkles';
      color = 'text-amber-400';
      bg = 'bg-amber-500/10';
    } else if (tx.type === 'withdrawal') {
      icon = 'arrow-up-right';
      color = 'text-rose-400';
      bg = 'bg-rose-500/10';
    }

    return `
      <div class="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/60 text-xs">
        <div class="flex items-center gap-2.5">
          <div class="w-7 h-7 rounded-lg ${bg} ${color} flex items-center justify-center shrink-0">
            <i data-lucide="${icon}" class="w-3.5 h-3.5"></i>
          </div>
          <div>
            <div class="font-semibold text-slate-200 truncate max-w-[170px]">${tx.description || tx.type}</div>
            <div class="text-[10px] text-slate-500">${new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-bold ${tx.type === 'withdrawal' ? 'text-rose-400' : 'text-emerald-400'}">
            ${tx.type === 'withdrawal' ? '-' : '+'}$${tx.amount.toFixed(2)}
          </div>
          <span class="text-[9px] uppercase px-1 rounded bg-slate-800 text-slate-400">${tx.wallet_type.split('_')[0]}</span>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// ==================== INVESTMENT PLANS ====================

async function loadPlans() {
  try {
    const res = await fetch(`${API_BASE}/investments/plans`);
    const data = await res.json();
    if (data.success && data.plans) {
      allPlans = data.plans;
      renderPlansGrid(allPlans);
      if (!selectedPlanForCalc && allPlans.length > 0) {
        selectedPlanForCalc = allPlans[0];
      }
    }
  } catch (err) {
    console.error('Failed to load plans:', err);
  }
}

function renderPlansGrid(plans) {
  const container = document.getElementById('plans-grid');
  if (!container) return;

  container.innerHTML = plans.map(p => {
    const totalProfit = p.daily_roi * p.duration_days;
    const profitPercentage = ((totalProfit / p.price) * 100).toFixed(0);

    return `
      <div class="relative bg-brand-card border border-brand-border rounded-2xl p-6 shadow-xl hover:border-brand-cyan/60 transition group flex flex-col justify-between">
        <!-- Top Tag -->
        <div class="flex items-center justify-between mb-4">
          <span class="px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-slate-800 text-brand-cyan border border-brand-cyan/30">
            ${p.name}
          </span>
          <span class="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
            ${profitPercentage}% Return
          </span>
        </div>

        <!-- Price -->
        <div class="my-2">
          <div class="flex items-baseline gap-1">
            <span class="text-4xl font-heading font-black text-white">$${p.price}</span>
            <span class="text-sm font-semibold text-slate-400">USDT</span>
          </div>
          <p class="text-xs text-slate-400 mt-1">Duration: <strong class="text-cyan-300 font-bold">${p.duration_days} Days</strong></p>
        </div>

        <!-- Features list -->
        <div class="bg-slate-900/90 rounded-xl p-4 border border-slate-800 space-y-2.5 my-4 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-slate-400">Daily ROI Payout:</span>
            <span class="font-extrabold text-emerald-400 text-sm">$${p.daily_roi.toFixed(2)} USDT</span>
          </div>
          <div class="flex items-center justify-between border-t border-slate-800/80 pt-2">
            <span class="text-slate-400">Total Profit Generated:</span>
            <span class="font-extrabold text-white text-sm">$${totalProfit.toFixed(2)} USDT</span>
          </div>
          <div class="flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px]">
            <span class="text-slate-400">Referral Level 1 (10%):</span>
            <span class="text-cyan-300 font-bold">+$${(p.daily_roi * 0.10).toFixed(2)} / day</span>
          </div>
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-slate-400">Team Commission (6%):</span>
            <span class="text-amber-300 font-bold">+$${(p.price * 0.06).toFixed(2)} Instant</span>
          </div>
        </div>

        <!-- Action Button -->
        <button onclick="promptPurchasePlan(${p.id})" class="w-full py-2.5 rounded-xl font-extrabold text-slate-950 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 hover:from-amber-300 hover:to-amber-500 shadow-lg shadow-amber-500/20 transition flex items-center justify-center gap-2">
          <i data-lucide="zap" class="w-4 h-4 fill-slate-950"></i> Activate $${p.price} Plan
        </button>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function promptPurchasePlan(planId) {
  if (!currentUser) {
    showToast('Please log in or register first to activate a plan', 'info');
    openModal('loginModal');
    return;
  }

  const plan = allPlans.find(p => p.id === planId);
  if (!plan) return;

  document.getElementById('modal-plan-name').textContent = plan.name;
  document.getElementById('modal-plan-price').textContent = `$${plan.price} USDT`;
  document.getElementById('modal-plan-duration').textContent = `${plan.duration_days} Days`;
  document.getElementById('modal-plan-daily').textContent = `$${plan.daily_roi.toFixed(2)} USDT / day`;
  document.getElementById('modal-user-bal').textContent = `$${(currentUser.wallet_balance || 0).toFixed(2)} USDT`;
  document.getElementById('modal-plan-id').value = plan.id;

  openModal('purchaseModal');
}

async function confirmPlanPurchase() {
  const planId = document.getElementById('modal-plan-id').value;
  try {
    const res = await fetch(`${API_BASE}/investments/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ planId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to purchase plan');
    }

    closeModal('purchaseModal');
    showToast(`🎉 Successfully activated ${data.planName}! Daily ROI started.`, 'success');
    await fetchUserProfile();
    navigate('dashboard');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== NETWORK & TREE ====================

async function loadNetwork() {
  if (!token) return;

  try {
    // 1. Fetch Downline Stats
    const statsRes = await fetch(`${API_BASE}/network/downline-stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const statsData = await statsRes.json();

    if (statsData.success) {
      document.getElementById('net-stat-total').textContent = statsData.totalTeam;
      document.getElementById('net-stat-directs').textContent = statsData.levels.level1.count;
      const totalVol = statsData.levels.level1.volume + statsData.levels.level2.volume + statsData.levels.level3.volume;
      document.getElementById('net-stat-volume').textContent = `$${totalVol.toFixed(2)}`;

      // Level cards
      document.getElementById('l1-count').textContent = statsData.levels.level1.count;
      document.getElementById('l1-vol').textContent = `$${statsData.levels.level1.volume.toFixed(2)}`;

      document.getElementById('l2-count').textContent = statsData.levels.level2.count;
      document.getElementById('l2-vol').textContent = `$${statsData.levels.level2.volume.toFixed(2)}`;

      document.getElementById('l3-count').textContent = statsData.levels.level3.count;
      document.getElementById('l3-vol').textContent = `$${statsData.levels.level3.volume.toFixed(2)}`;
    }

    // 2. Fetch Tree
    const treeRes = await fetch(`${API_BASE}/network/tree`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const treeData = await treeRes.json();
    if (treeData.success && treeData.tree) {
      renderGenealogyTree(treeData.tree);
    }

    // 3. Fetch Direct Referrals
    const dirRes = await fetch(`${API_BASE}/network/direct-referrals`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const dirData = await dirRes.json();
    if (dirData.success) {
      renderDirectReferralsTable(dirData.referrals);
    }

  } catch (err) {
    console.error('Error loading network:', err);
  }
}

function setNetworkTab(tab) {
  const treeContainer = document.getElementById('tree-container');
  const listContainer = document.getElementById('list-container');
  const treeBtn = document.getElementById('tab-btn-tree');
  const listBtn = document.getElementById('tab-btn-list');

  if (tab === 'tree') {
    treeContainer.classList.remove('hidden');
    listContainer.classList.add('hidden');
    treeBtn.className = 'px-4 py-2 rounded-lg text-sm font-bold bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/40';
    listBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-white';
  } else {
    treeContainer.classList.add('hidden');
    listContainer.classList.remove('hidden');
    listBtn.className = 'px-4 py-2 rounded-lg text-sm font-bold bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/40';
    treeBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-white';
  }
}

function renderGenealogyTree(node) {
  const container = document.getElementById('genealogy-tree');
  if (!container) return;

  function buildNodeHtml(currNode, isRoot = false) {
    if (!currNode) return '';
    const hasChildren = currNode.children && currNode.children.length > 0;

    return `
      <div class="tree-node">
        <div class="tree-card ${isRoot ? 'border-amber-400/80 bg-amber-950/30' : 'border-cyan-500/40'}">
          <div class="text-[11px] font-bold ${isRoot ? 'text-amber-400' : 'text-cyan-400'}">${currNode.username}</div>
          <div class="text-[10px] text-slate-400 font-mono">${currNode.referral_code}</div>
          <div class="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 font-semibold mt-1">
            Active: $${currNode.active_investment || 0}
          </div>
        </div>

        ${hasChildren ? `
          <div class="tree-children">
            ${currNode.children.map(child => `
              <div class="tree-node-branch">
                ${buildNodeHtml(child, false)}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  container.innerHTML = buildNodeHtml(node, true);
}

function renderDirectReferralsTable(referrals) {
  const tbody = document.getElementById('direct-referrals-tbody');
  if (!tbody) return;

  if (!referrals || referrals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-500">No direct referrals yet. Share your referral link!</td></tr>`;
    return;
  }

  tbody.innerHTML = referrals.map(r => `
    <tr class="hover:bg-slate-900/50">
      <td class="p-3 font-semibold text-white">
        <div>${r.full_name}</div>
        <span class="text-[10px] text-slate-400">@${r.username}</span>
      </td>
      <td class="p-3 text-slate-400">${r.email || '-'}</td>
      <td class="p-3 font-bold text-cyan-400">$${r.active_investment.toFixed(2)}</td>
      <td class="p-3 font-bold text-amber-400">+$${r.total_commission_from_user.toFixed(2)}</td>
      <td class="p-3 text-slate-400">${new Date(r.created_at).toLocaleDateString()}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">ACTIVE</span>
      </td>
    </tr>
  `).join('');
}

// ==================== WALLET & TRANSACTIONS ====================

async function loadWallet() {
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE}/wallet/overview`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      const w = data.wallets;
      document.getElementById('withdraw-roi-avail').textContent = `$${w.roiWallet.toFixed(2)}`;
      document.getElementById('withdraw-comm-avail').textContent = `$${w.commissionWallet.toFixed(2)}`;
      document.getElementById('withdraw-total-avail').textContent = `$${w.totalWithdrawable.toFixed(2)}`;

      const addrInput = document.getElementById('withdraw-address');
      if (addrInput && w.savedUsdtAddress) {
        addrInput.value = w.savedUsdtAddress;
      }
    }

    loadTransactions();
    loadUserWithdrawals();
  } catch (err) {
    console.error('Error loading wallet:', err);
  }
}

async function handleDeposit(e) {
  e.preventDefault();
  const amount = document.getElementById('deposit-amount').value;
  const network = document.getElementById('deposit-network').value;
  const txHash = document.getElementById('deposit-txhash').value;

  try {
    const res = await fetch(`${API_BASE}/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ amount, network, txHash })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Deposit failed');
    }

    showToast(`✅ Successfully deposited $${data.amount} USDT!`, 'success');
    document.getElementById('deposit-form').reset();
    await fetchUserProfile();
    loadWallet();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleWithdraw(e) {
  e.preventDefault();
  const amount = document.getElementById('withdraw-amount').value;
  const usdtAddress = document.getElementById('withdraw-address').value;
  const walletSource = document.getElementById('withdraw-source').value;

  try {
    const res = await fetch(`${API_BASE}/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ amount, usdtAddress, walletSource })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Withdrawal failed');
    }

    showToast(`Withdrawal of $${data.amount} USDT requested! Fee: 0%. Processing: 0-24hr.`, 'success');
    document.getElementById('withdraw-form').reset();
    await fetchUserProfile();
    loadWallet();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function setMaxWithdraw() {
  if (!currentUser) return;
  const source = document.getElementById('withdraw-source').value;
  let max = 0;
  if (source === 'roi_balance') max = currentUser.roi_balance;
  else if (source === 'commission_balance') max = currentUser.commission_balance;
  else max = (currentUser.roi_balance || 0) + (currentUser.commission_balance || 0);

  document.getElementById('withdraw-amount').value = max;
  document.getElementById('withdraw-preview-net').textContent = `$${max.toFixed(2)} USDT`;
}

async function handleReinvest(e) {
  e.preventDefault();
  const fromWallet = document.getElementById('reinvest-from').value;
  const amount = document.getElementById('reinvest-amount').value;

  try {
    const res = await fetch(`${API_BASE}/wallet/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ fromWallet, amount })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Transfer failed');
    }

    showToast(`Transferred $${data.amount} to Deposit Wallet! Ready for reinvestment.`, 'success');
    document.getElementById('reinvest-form').reset();
    await fetchUserProfile();
    loadWallet();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadTransactions() {
  const filterType = document.getElementById('tx-filter-type').value;
  try {
    const res = await fetch(`${API_BASE}/wallet/transactions?type=${filterType}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      const tbody = document.getElementById('transactions-full-tbody');
      if (!tbody) return;

      if (!data.transactions || data.transactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-500">No transactions recorded yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.transactions.map(tx => {
        const isDebit = tx.type === 'withdrawal' || tx.type === 'investment';
        return `
          <tr class="hover:bg-slate-900/60">
            <td class="p-3 text-slate-400">${new Date(tx.created_at).toLocaleString()}</td>
            <td class="p-3 font-semibold uppercase text-[10px] text-brand-cyan">${tx.type.replace('_', ' ')}</td>
            <td class="p-3 text-slate-300">${tx.description}</td>
            <td class="p-3 text-slate-400 capitalize">${tx.wallet_type.replace('_', ' ')}</td>
            <td class="p-3 text-right font-bold ${isDebit ? 'text-rose-400' : 'text-emerald-400'}">
              ${isDebit ? '-' : '+'}$${tx.amount.toFixed(2)}
            </td>
            <td class="p-3 text-center">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${tx.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}">
                ${tx.status.toUpperCase()}
              </span>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Error loading transactions:', err);
  }
}

async function loadUserWithdrawals() {
  try {
    const res = await fetch(`${API_BASE}/wallet/withdrawals`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      const container = document.getElementById('user-withdrawals-list');
      if (!container) return;

      if (!data.withdrawals || data.withdrawals.length === 0) {
        container.innerHTML = `<span class="text-slate-500 text-xs">No withdrawal requests yet.</span>`;
        return;
      }

      container.innerHTML = data.withdrawals.map(w => `
        <div class="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
          <div>
            <div class="font-bold text-white">$${w.amount} USDT</div>
            <div class="text-[10px] text-slate-400">${new Date(w.created_at).toLocaleDateString()}</div>
          </div>
          <span class="px-2 py-0.5 rounded text-[9px] font-bold ${w.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : (w.status === 'rejected' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400')}">
            ${w.status.toUpperCase()}
          </span>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Error loading user withdrawals:', err);
  }
}

// ==================== ROI CALCULATOR ====================

function initCalculator() {
  const container = document.getElementById('calc-plan-buttons');
  if (!container || allPlans.length === 0) return;

  container.innerHTML = allPlans.map(p => `
    <button onclick="selectCalcPlan(${p.id})" id="calc-btn-${p.id}" class="calc-plan-btn p-2 rounded-lg text-xs font-bold border ${selectedPlanForCalc && selectedPlanForCalc.id === p.id ? 'bg-brand-cyan/20 border-brand-cyan text-brand-cyan' : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'}">
      $${p.price} (${p.duration_days}d)
    </button>
  `).join('');

  if (selectedPlanForCalc) {
    updateCalcDisplay(selectedPlanForCalc);
  }
}

function selectCalcPlan(planId) {
  selectedPlanForCalc = allPlans.find(p => p.id === planId);
  initCalculator();
}

function updateCalcDisplay(plan) {
  const total = plan.daily_roi * plan.duration_days;
  document.getElementById('calc-display-amount').textContent = `$${plan.price} USDT`;
  document.getElementById('calc-display-days').textContent = `${plan.duration_days} Days`;
  document.getElementById('calc-display-daily').textContent = `$${plan.daily_roi.toFixed(2)} USDT / day`;
  document.getElementById('calc-display-total').textContent = `$${total.toFixed(2)} USDT`;
  document.getElementById('calc-big-profit').textContent = `$${total.toFixed(2)}`;

  // Multiplier projection for 5 directs
  const refExtra = plan.daily_roi * 0.10 * 5;
  const teamExtra = plan.price * 0.06 * 5;
  document.getElementById('calc-ref-extra').textContent = `$${refExtra.toFixed(2)}/day`;
  document.getElementById('calc-team-extra').textContent = `$${teamExtra.toFixed(2)}`;
}

// ==================== ADMIN CONTROL PANEL ====================

async function loadAdminData() {
  if (!token || !currentUser || currentUser.role !== 'admin') return;

  try {
    // 1. Stats
    const statsRes = await fetch(`${API_BASE}/admin/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const statsData = await statsRes.json();
    if (statsData.success) {
      const s = statsData.stats;
      document.getElementById('adm-stat-users').textContent = s.totalUsers;
      document.getElementById('adm-stat-volume').textContent = `$${s.activeInvestmentVolume.toFixed(2)}`;
      document.getElementById('adm-stat-roi').textContent = `$${s.totalRoiDistributed.toFixed(2)}`;
      document.getElementById('adm-stat-comm').textContent = `$${s.totalTeamCommissionDistributed.toFixed(2)}`;
    }

    // 2. Withdrawals
    const withRes = await fetch(`${API_BASE}/admin/withdrawals`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const withData = await withRes.json();
    if (withData.success) {
      renderAdminWithdrawals(withData.withdrawals);
    }

    // 3. Users
    const usersRes = await fetch(`${API_BASE}/admin/users`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const usersData = await usersRes.json();
    if (usersData.success) {
      renderAdminUsers(usersData.users);
    }

  } catch (err) {
    console.error('Error loading admin data:', err);
  }
}

function renderAdminWithdrawals(withdrawals) {
  const tbody = document.getElementById('admin-withdrawals-tbody');
  if (!tbody) return;

  if (!withdrawals || withdrawals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-500">No withdrawal requests found.</td></tr>`;
    return;
  }

  tbody.innerHTML = withdrawals.map(w => `
    <tr class="hover:bg-slate-900/60">
      <td class="p-3 text-slate-400 font-mono">#${w.id}</td>
      <td class="p-3 font-semibold text-white">${w.username}</td>
      <td class="p-3 font-bold text-white">$${w.amount}</td>
      <td class="p-3 text-emerald-400 font-semibold">${w.fee}% (0.00)</td>
      <td class="p-3 font-bold text-cyan-300">$${w.net_amount}</td>
      <td class="p-3 font-mono text-[10px] text-slate-400 break-all">${w.usdt_address}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${w.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : (w.status === 'rejected' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400 animate-pulse')}">
          ${w.status.toUpperCase()}
        </span>
      </td>
      <td class="p-3 text-right">
        ${w.status === 'pending' ? `
          <button onclick="approveWithdrawal(${w.id})" class="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded text-xs font-bold mr-1">
            Approve
          </button>
          <button onclick="rejectWithdrawal(${w.id})" class="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded text-xs font-bold">
            Reject
          </button>
        ` : `
          <span class="text-slate-500 text-xs">Processed</span>
        `}
      </td>
    </tr>
  `).join('');
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;

  tbody.innerHTML = users.map(u => `
    <tr class="hover:bg-slate-900/60">
      <td class="p-3">
        <div class="font-bold text-white">${u.full_name || u.username}</div>
        <div class="text-[10px] text-slate-400">@${u.username} (${u.role})</div>
      </td>
      <td class="p-3 font-mono text-cyan-300 font-bold">${u.referral_code}</td>
      <td class="p-3 text-slate-400">${u.sponsor_username ? '@' + u.sponsor_username : '-'}</td>
      <td class="p-3 text-white font-semibold">$${u.wallet_balance.toFixed(2)}</td>
      <td class="p-3 text-emerald-400 font-semibold">$${u.roi_balance.toFixed(2)}</td>
      <td class="p-3 text-amber-400 font-semibold">$${u.commission_balance.toFixed(2)}</td>
      <td class="p-3 text-cyan-400 font-bold">$${u.active_invested.toFixed(2)}</td>
      <td class="p-3 text-right">
        <button onclick="openAdminAdjustModal(${u.id}, '${u.username}')" class="px-2.5 py-1 rounded bg-brand-cyan/20 hover:bg-brand-cyan/30 text-brand-cyan text-xs font-bold">
          Adjust Bal
        </button>
      </td>
    </tr>
  `).join('');
}

async function approveWithdrawal(id) {
  const txHash = prompt('Enter Transaction Hash (optional, leave blank for auto):');
  try {
    const res = await fetch(`${API_BASE}/admin/withdrawals/${id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ txHash })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Withdrawal #${id} approved! TX: ${data.txHash}`, 'success');
      loadAdminData();
    } else {
      showToast(data.error || 'Failed to approve', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function rejectWithdrawal(id) {
  const reason = prompt('Enter reason for rejection (funds will be refunded):');
  if (reason === null) return;

  try {
    const res = await fetch(`${API_BASE}/admin/withdrawals/${id}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Withdrawal #${id} rejected and refunded $${data.refundedAmount}`, 'info');
      loadAdminData();
    } else {
      showToast(data.error || 'Failed to reject', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function triggerAdminDailyRoi() {
  if (!confirm('Run the daily ROI cycle now? This will distribute daily ROI and 3-level Referral Income (ROI of ROI) for all active plans.')) return;

  try {
    const res = await fetch(`${API_BASE}/admin/trigger-daily-roi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ force: true })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🚀 Done! Processed ${data.processedInvestments} plans. Paid ROI: $${data.totalRoiDistributed}, Referral ROI: $${data.totalReferralRoiDistributed}`, 'success');
      loadAdminData();
    } else {
      showToast(data.error || 'Failed to trigger ROI', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openAdminAdjustModal(userId, username) {
  document.getElementById('adjust-user-id').value = userId;
  document.getElementById('admin-adjust-user-label').textContent = `User: @${username} (ID: ${userId})`;
  openModal('adminAdjustModal');
}

async function handleAdminAdjustBalance(e) {
  e.preventDefault();
  const userId = document.getElementById('adjust-user-id').value;
  const walletType = document.getElementById('adjust-wallet-type').value;
  const action = document.getElementById('adjust-action').value;
  const amount = document.getElementById('adjust-amount').value;
  const reason = document.getElementById('adjust-reason').value;

  try {
    const res = await fetch(`${API_BASE}/admin/adjust-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId, walletType, action, amount, reason })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('adminAdjustModal');
      showToast(data.message, 'success');
      loadAdminData();
    } else {
      showToast(data.error || 'Failed to adjust balance', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== UTILS & HELPERS ====================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('flex');
    modal.classList.add('hidden');
  }
}

function copyReferralLink() {
  const input = document.getElementById('referral-link-input');
  if (input) {
    input.select();
    navigator.clipboard.writeText(input.value);
    showToast('Referral link copied to clipboard!', 'success');
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  showToast('Copied to clipboard!', 'info');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-950/90 border-emerald-500 text-emerald-200',
    error: 'bg-rose-950/90 border-rose-500 text-rose-200',
    info: 'bg-slate-900/90 border-cyan-500 text-cyan-200'
  };

  toast.className = `toast border rounded-xl p-3.5 shadow-2xl backdrop-blur-md text-xs font-semibold flex items-center justify-between gap-3 ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-white">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 4000);
}
