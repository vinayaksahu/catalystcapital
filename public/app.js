/**
 * Catalyst Capital & BNV Mobile WebApp Engine
 * Fully unified frontend client supporting 5-tab mobile-first experience:
 * 1. Home (BNV Trading UI)
 * 2. Quotes (Interactive Plan Presentation)
 * 3. Team (Network & Genealogy)
 * 4. History (Bonus -> History Ledger)
 * 5. Assets (Assets & Wallets in USDT)
 */

const API_BASE = '/api';
let currentUser = null;
let token = localStorage.getItem('catalyst_token') || null;
let allPlans = [];
let userWallets = null;
let currentHistoryFilter = 'all';

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  initThemeMode();
  lucide.createIcons();
  setupEventListeners();

  // Load official investment plans
  await loadPlans();

  // Try to authenticate current user or default to demo Rahul
  if (token) {
    await fetchUserProfile();
  } else {
    // Auto-login with demo user rahul for seamless preview
    await quickLogin('rahul');
  }

  // Start live crypto price pulse
  startCryptoTickerPulse();
});

// ==================== THEME MANAGEMENT (Dark / Light Mode) ====================

function initThemeMode() {
  const savedTheme = localStorage.getItem('catalyst_theme') || 'dark';
  applyTheme(savedTheme);
}

function toggleThemeMode() {
  const isDark = document.documentElement.classList.contains('dark');
  const nextTheme = isDark ? 'light' : 'dark';
  applyTheme(nextTheme);
  showToast(`Switched to ${nextTheme === 'dark' ? 'Dark' : 'Light'} Mode`, 'info');
}

function applyTheme(theme) {
  const iconContainer = document.getElementById('theme-toggle-btn');
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
    if (iconContainer) {
      iconContainer.innerHTML = '<i data-lucide="sun" class="w-4 h-4 text-amber-500"></i>';
    }
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    if (iconContainer) {
      iconContainer.innerHTML = '<i data-lucide="moon" class="w-4 h-4 text-slate-700"></i>';
    }
  }
  localStorage.setItem('catalyst_theme', theme);
  lucide.createIcons();
}

// Setup global event listeners
function setupEventListeners() {
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref');
  if (ref) {
    const regSponsor = document.getElementById('reg-sponsor');
    if (regSponsor) regSponsor.value = ref;
    openModal('registerModal');
  }

  // Close demo dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('demo-dropdown');
    if (dropdown && !dropdown.contains(e.target) && !e.target.closest('button[onclick="toggleDemoDropdown()"]')) {
      dropdown.classList.add('hidden');
    }
  });
}

function toggleDemoDropdown() {
  const dropdown = document.getElementById('demo-dropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
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
      await refreshCurrentViewData();
    } else {
      logout();
    }
  } catch (err) {
    console.error('Failed to fetch profile:', err);
    logout();
  }
}

function updateAuthUI() {
  const btnLogin = document.getElementById('btn-login-modal');
  const btnProfile = document.getElementById('btn-user-profile');
  const activeBadge = document.getElementById('active-user-badge');

  if (currentUser) {
    if (btnLogin) btnLogin.classList.add('hidden');
    if (btnProfile) btnProfile.classList.remove('hidden');

    const displayName = currentUser.username || currentUser.full_name;
    const initial = (currentUser.full_name || currentUser.username || 'U')[0].toUpperCase();

    const avatarLetter = document.getElementById('user-avatar-initial');
    if (avatarLetter) avatarLetter.textContent = initial;

    const profAvatar = document.getElementById('prof-avatar-letter');
    if (profAvatar) profAvatar.textContent = initial;

    if (activeBadge) activeBadge.textContent = displayName;

    // Profile Modal Info
    const profFull = document.getElementById('prof-fullname');
    if (profFull) profFull.textContent = currentUser.full_name || currentUser.username;
    const profUser = document.getElementById('prof-username');
    if (profUser) profUser.textContent = `@${currentUser.username}`;
    const profRef = document.getElementById('prof-refcode');
    if (profRef) profRef.textContent = currentUser.referral_code;
    const profRole = document.getElementById('prof-role');
    if (profRole) profRole.textContent = currentUser.role.toUpperCase();
    const profAddr = document.getElementById('prof-usdt-address');
    if (profAddr) profAddr.textContent = currentUser.usdt_address || 'Not Set';

    // Admin button in profile modal
    const profAdminBtn = document.getElementById('prof-admin-panel-btn');
    if (profAdminBtn) {
      if (currentUser.role === 'admin') profAdminBtn.classList.remove('hidden');
      else profAdminBtn.classList.add('hidden');
    }

    // Referral links
    const refLink = `${window.location.origin}/?ref=${currentUser.referral_code}`;
    const teamInput = document.getElementById('team-referral-input');
    if (teamInput) teamInput.value = refLink;
    const modalInput = document.getElementById('modal-ref-input');
    if (modalInput) modalInput.value = refLink;
    const modalCode = document.getElementById('modal-ref-code');
    if (modalCode) modalCode.textContent = currentUser.referral_code;

    // Saved USDT address in withdraw
    const withdrawAddr = document.getElementById('withdraw-address');
    if (withdrawAddr && currentUser.usdt_address) {
      withdrawAddr.value = currentUser.usdt_address;
    }
  } else {
    if (btnLogin) btnLogin.classList.remove('hidden');
    if (btnProfile) btnProfile.classList.add('hidden');
    if (activeBadge) activeBadge.textContent = 'Guest';
  }
}

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
      const dropdown = document.getElementById('demo-dropdown');
      if (dropdown) dropdown.classList.add('hidden');
      updateAuthUI();
      showToast(`Switched account to @${currentUser.username} (${currentUser.role})`, 'success');
      await refreshCurrentViewData();
    } else {
      showToast(data.error || 'Demo login failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
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
    showToast(`Welcome ${currentUser.full_name || currentUser.username}!`, 'success');
    await refreshCurrentViewData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const fullName = document.getElementById('reg-fullname').value;
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const sponsorCode = document.getElementById('reg-sponsor').value;
  const password = document.getElementById('reg-password').value;

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, username, email, sponsorCode, password })
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
    await refreshCurrentViewData();
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
  navigate('home');
}

// ==================== NAVIGATION (5 TABS) ====================

let activeViewName = 'home';

function navigate(viewName) {
  activeViewName = viewName;
  const views = ['home', 'quotes', 'invest', 'team', 'history', 'assets', 'admin'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
  });

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.remove('hidden');

  // Update Bottom Nav Tab styling
  const tabs = ['home', 'quotes', 'team', 'history', 'assets'];
  tabs.forEach(t => {
    const tabEl = document.getElementById(`tab-${t}`);
    if (tabEl) {
      if (t === viewName) {
        tabEl.classList.add('active');
      } else {
        tabEl.classList.remove('active');
      }
    }
  });

  // Refresh view data
  refreshCurrentViewData();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function refreshCurrentViewData() {
  if (activeViewName === 'home') await loadAssetsData();
  if (activeViewName === 'assets') await loadAssetsData();
  if (activeViewName === 'invest') renderPresentationPlans();
  if (activeViewName === 'quotes') renderPresentationPlans();
  if (activeViewName === 'team') await loadTeamData();
  if (activeViewName === 'history') await loadHistoryData();
  if (activeViewName === 'admin') await loadAdminData();
}

// ==================== VIEW 1: HOME PAGE LOGIC ====================

function startCryptoTickerPulse() {
  let btc = 85129.40;
  let eth = 2700.71;
  let etc = 8.8362;

  setInterval(() => {
    // Random micro fluctuation
    const btcDelta = (Math.random() - 0.48) * 8.5;
    const ethDelta = (Math.random() - 0.48) * 1.2;
    const etcDelta = (Math.random() - 0.49) * 0.01;

    btc = Math.max(84000, btc + btcDelta);
    eth = Math.max(2600, eth + ethDelta);
    etc = Math.max(8.0, etc + etcDelta);

    const btcEl = document.getElementById('home-btc-price');
    const ethEl = document.getElementById('home-eth-price');
    const etcEl = document.getElementById('home-etc-price');

    if (btcEl) btcEl.textContent = `$${btc.toFixed(1)}`;
    if (ethEl) ethEl.textContent = `$${eth.toFixed(2)}`;
    if (etcEl) etcEl.textContent = `$${etc.toFixed(4)}`;

    const listBtc = document.getElementById('list-btc-price');
    const listEth = document.getElementById('list-eth-price');
    if (listBtc) listBtc.textContent = `$${btc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (listEth) listEth.textContent = `$${eth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, 3500);
}

// Catalyst Guide Modal
function openCatalystGuideModal() {
  openModal('catalystGuideModal');
}
function openBnvGuideModal() {
  openCatalystGuideModal();
}

// Lightbox image viewer for plan and legal certificates
function openImageViewer(src, title) {
  const img = document.getElementById('lightbox-img');
  const titleEl = document.getElementById('lightbox-title');
  if (img) img.src = src;
  if (titleEl && title) titleEl.textContent = title;
  openModal('imageViewerModal');
}

// Open Dedicated Invest tab to see the Investment Packages ($25 - $350)
function openInvestPackages() {
  navigate('invest');
}

function switchTab(viewName) {
  navigate(viewName);
}

window.openInvestPackages = openInvestPackages;
window.switchTab = switchTab;

// Red Envelope Lucky Draw
function openRedEnvelopeModal() {
  const resultBox = document.getElementById('envelope-result');
  const tapBtn = document.getElementById('envelope-tap-btn');
  if (resultBox) resultBox.classList.add('hidden');
  if (tapBtn) {
    tapBtn.disabled = false;
    tapBtn.textContent = '開';
    tapBtn.classList.remove('opacity-50');
  }
  openModal('redEnvelopeModal');
}

async function openLuckyRedEnvelope() {
  const tapBtn = document.getElementById('envelope-tap-btn');
  const resultBox = document.getElementById('envelope-result');
  const prizeText = document.getElementById('envelope-prize-text');

  if (tapBtn) tapBtn.disabled = true;

  // Generate lucky prize between 0.50 and 5.00 USDT
  const prize = (Math.random() * 4.5 + 0.50).toFixed(2);

  if (tapBtn) {
    tapBtn.textContent = '💰';
    tapBtn.classList.add('animate-bounce');
  }

  setTimeout(async () => {
    if (prizeText) prizeText.textContent = `🎉 You won $${prize} USDT!`;
    if (resultBox) resultBox.classList.remove('hidden');

    // Credit bonus in database if logged in
    if (currentUser && token) {
      try {
        await fetch(`${API_BASE}/wallet/deposit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            amount: parseFloat(prize),
            network: 'Red Envelope Bonus',
            txHash: 'LUCKY-' + Math.random().toString(36).substring(2, 8).toUpperCase()
          })
        });
        showToast(`🎉 Claimed +$${prize} USDT Lucky Bonus!`, 'success');
        await fetchUserProfile();
      } catch (err) {
        console.warn('Could not credit lucky bonus:', err);
      }
    }
  }, 1000);
}

// Quick Circular Actions Handlers
function openRechargeModal() {
  if (!currentUser) {
    openModal('loginModal');
    return;
  }
  openModal('rechargeModal');
}

function openWithdrawModal() {
  if (!currentUser) {
    openModal('loginModal');
    return;
  }
  openModal('withdrawModal');
  loadWithdrawalModalData();
}

function openSignalModal() {
  openModal('signalModal');
}

function openServiceModal() {
  openModal('serviceModal');
}

function openInviteModal() {
  if (!currentUser) {
    openModal('loginModal');
    return;
  }
  openModal('inviteModal');
}

function openNoticeModal() {
  showToast('Catalyst Capital: High Frequency AI Trading & 0% Fee Instant Payouts Active.', 'info');
}

function openDedicatedSupportModal(type) {
  const title = document.getElementById('service-modal-title');
  if (title) title.textContent = `${type} Dedicated Line`;
  openModal('serviceModal');
}

// Daily check-in
async function claimDailyCheckin() {
  const btn = document.getElementById('btn-daily-checkin');
  if (!currentUser) {
    openModal('loginModal');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Claimed!';
    btn.className = 'px-3 py-1.5 rounded-lg bg-slate-800 text-slate-500 font-bold text-[11px]';
  }

  try {
    await fetch(`${API_BASE}/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        amount: 0.10,
        network: 'Daily Check-in Reward',
        txHash: 'TASK-' + Date.now()
      })
    });
    showToast('✅ Claimed +$0.10 USDT Daily Check-in Reward!', 'success');
    await fetchUserProfile();
  } catch (e) {
    showToast('Reward claimed for today!', 'info');
  }
}

// ==================== VIEW 2: QUOTES PAGE (Plan Presentation) ====================

async function loadPlans() {
  try {
    const res = await fetch(`${API_BASE}/investments/plans`);
    const data = await res.json();
    if (data.success && data.plans) {
      allPlans = data.plans;
      renderPresentationPlans();
    }
  } catch (err) {
    console.error('Failed to load plans:', err);
  }
}

function renderPresentationPlans() {
  const container = document.getElementById('presentation-plans-grid');
  if (!container || !allPlans || allPlans.length === 0) return;

  container.innerHTML = allPlans.map(p => {
    const totalProfit = p.daily_roi * p.duration_days;
    const profitPercentage = ((totalProfit / p.price) * 100).toFixed(0);

    return `
      <div class="bg-[#11141c] border border-[#1e2434] rounded-2xl p-4 hover:border-[#ff4e91]/60 transition shadow-lg relative overflow-hidden flex flex-col justify-between">
        <!-- Top Tag & Name -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-[#ff4e91]"></span>
            <span class="font-bold text-white text-sm tracking-wide uppercase">${p.name}</span>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            +${profitPercentage}% Return
          </span>
        </div>

        <!-- Price & Duration -->
        <div class="flex items-baseline justify-between my-2 pb-2 border-b border-slate-800">
          <div>
            <span class="text-2xl font-black text-white font-mono">$${p.price}</span>
            <span class="text-xs text-slate-400 font-semibold ml-1">USDT</span>
          </div>
          <div class="text-right">
            <span class="text-xs text-cyan-300 font-bold">${p.duration_days} Days Lock</span>
            <span class="block text-[10px] text-slate-400">Duration</span>
          </div>
        </div>

        <!-- Payout breakdown -->
        <div class="grid grid-cols-2 gap-2 text-xs py-2">
          <div class="bg-black/50 p-2 rounded-lg border border-slate-800/80">
            <span class="text-slate-400 block text-[10px]">Daily ROI:</span>
            <span class="font-bold text-emerald-400 font-mono text-xs">+$${p.daily_roi.toFixed(2)} USDT</span>
          </div>
          <div class="bg-black/50 p-2 rounded-lg border border-slate-800/80">
            <span class="text-slate-400 block text-[10px]">Total Return:</span>
            <span class="font-bold text-white font-mono text-xs">$${totalProfit.toFixed(2)} USDT</span>
          </div>
        </div>

        <!-- Downline Commission Perks -->
        <div class="flex justify-between items-center text-[10px] text-slate-400 py-1.5 px-1">
          <span>Direct ROI (L1): <strong class="text-cyan-300">10%/day</strong></span>
          <span>Team Comm: <strong class="text-amber-300">6% instant</strong></span>
        </div>

        <!-- Action Button -->
        <button onclick="promptPurchasePlan(${p.id})" class="w-full mt-2 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-[#ff4e91] to-[#ff7675] hover:brightness-110 shadow-lg shadow-pink-500/20 transition text-xs flex items-center justify-center gap-1.5 cursor-pointer">
          <i data-lucide="zap" class="w-3.5 h-3.5 fill-white"></i> Activate $${p.price} Package
        </button>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function promptPurchasePlan(planId) {
  if (!currentUser) {
    showToast('Please log in or switch to a demo account to activate', 'info');
    openModal('loginModal');
    return;
  }

  const plan = allPlans.find(p => p.id === planId);
  if (!plan) return;

  document.getElementById('modal-plan-name').textContent = `Activate ${plan.name}`;
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
    showToast(`🎉 Activated ${data.planName}! Daily ROI started.`, 'success');
    await fetchUserProfile();
    navigate('assets');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== VIEW 3: TEAM & MLM SUBORDINATE LOGIC (Matches uploaded images) ====================

let teamStatsCache = null;

async function loadTeamData() {
  if (!token) return;

  try {
    // 1. Promo code & link display
    const promoCode = currentUser ? (currentUser.referral_code || '395879') : '395879';
    const promoLink = `${window.location.origin}/?ref=${promoCode}`;

    const promoCodeEl = document.getElementById('team-promo-code');
    if (promoCodeEl) promoCodeEl.textContent = promoCode;

    const promoLinkEl = document.getElementById('team-promo-link');
    if (promoLinkEl) promoLinkEl.textContent = promoLink;

    const posterCodeEl = document.getElementById('poster-promo-code');
    if (posterCodeEl) posterCodeEl.textContent = promoCode;

    const posterQrEl = document.getElementById('poster-qr-img');
    if (posterQrEl) {
      posterQrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(promoLink)}`;
    }

    // 2. Downline stats
    const statsRes = await fetch(`${API_BASE}/network/downline-stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const statsData = await statsRes.json();
    if (statsData.success) {
      teamStatsCache = statsData;
      const s = statsData;

      // 1. Team size
      const sizeEl = document.getElementById('team-size-display');
      if (sizeEl) sizeEl.textContent = s.totalTeam || 0;

      // 2. Info rows inside card
      const validUsersEl = document.getElementById('team-valid-users');
      if (validUsersEl) validUsersEl.textContent = s.validUsers || 0;

      const totalRechargeEl = document.getElementById('team-total-recharge');
      if (totalRechargeEl) totalRechargeEl.textContent = (s.totalRecharge || 0).toFixed(2);

      const minTxnEl = document.getElementById('team-min-txn');
      if (minTxnEl) minTxnEl.textContent = (s.minTransactionAmount || 11.00).toFixed(2);

      // 3. 3-Stats grid
      const peopleTodayEl = document.getElementById('team-people-today');
      if (peopleTodayEl) peopleTodayEl.textContent = s.peopleToday || 0;

      const validTodayEl = document.getElementById('team-valid-today');
      if (validTodayEl) validTodayEl.textContent = s.validToday || 0;

      const totalWithdrawalsEl = document.getElementById('team-total-withdrawals');
      if (totalWithdrawalsEl) totalWithdrawalsEl.textContent = (s.totalWithdrawals || 0).toFixed(2);

      // 4. T1, T2, T3 stats
      const l1 = s.levels ? s.levels.level1 : { count: 0, effective: 0, commission: 0, users: [] };
      const l2 = s.levels ? s.levels.level2 : { count: 0, effective: 0, commission: 0, users: [] };
      const l3 = s.levels ? s.levels.level3 : { count: 0, effective: 0, commission: 0, users: [] };

      const t1CountEl = document.getElementById('t1-count');
      if (t1CountEl) t1CountEl.textContent = `${l1.count || 0}/${l1.effective || 0}`;
      const t1CommEl = document.getElementById('t1-commission');
      if (t1CommEl) t1CommEl.textContent = (l1.commission || 0).toFixed(2);

      const t2CountEl = document.getElementById('t2-count');
      if (t2CountEl) t2CountEl.textContent = `${l2.count || 0}/${l2.effective || 0}`;
      const t2CommEl = document.getElementById('t2-commission');
      if (t2CommEl) t2CommEl.textContent = (l2.commission || 0).toFixed(2);

      const t3CountEl = document.getElementById('t3-count');
      if (t3CountEl) t3CountEl.textContent = `${l3.count || 0}/${l3.effective || 0}`;
      const t3CommEl = document.getElementById('t3-commission');
      if (t3CommEl) t3CommEl.textContent = (l3.commission || 0).toFixed(2);

      // Render details accordions
      renderTierMembers(1, l1.users || []);
      renderTierMembers(2, l2.users || []);
      renderTierMembers(3, l3.users || []);
    }
  } catch (err) {
    console.error('Error loading team data:', err);
  }
}

function renderTierMembers(level, users) {
  const container = document.getElementById(`t${level}-details-container`);
  if (!container) return;

  if (!users || users.length === 0) {
    container.innerHTML = `<div class="text-center py-2.5 text-slate-500 text-[11px]">No T${level} subordinates yet.</div>`;
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
      <div>
        <div class="font-bold text-white text-xs">${u.full_name || u.username}</div>
        <div class="text-[10px] text-slate-400 font-mono">@${u.username} &bull; Joined ${new Date(u.created_at).toLocaleDateString()}</div>
      </div>
      <div class="text-right">
        <div class="font-mono text-xs font-bold text-emerald-400">$${(u.active_investment || 0).toFixed(2)}</div>
        <div class="text-[9px] text-amber-400 font-semibold font-mono">+$${(u.commission_earned || 0).toFixed(2)} Comm</div>
      </div>
    </div>
  `).join('');
}

function toggleTierAccordion(level) {
  const container = document.getElementById(`t${level}-details-container`);
  const chevron = document.getElementById(`t${level}-chevron`);
  if (!container) return;

  const isHidden = container.classList.contains('hidden');
  if (isHidden) {
    container.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
  } else {
    container.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
  }
}

function copyPromoCode() {
  const code = currentUser ? (currentUser.referral_code || '395879') : '395879';
  copyToClipboard(code);
  showToast(`Promotion Code ${code} copied!`, 'success');
}

function copyPromoLink() {
  const code = currentUser ? (currentUser.referral_code || '395879') : '395879';
  const link = `${window.location.origin}/?ref=${code}`;
  copyToClipboard(link);
  showToast('Invitation link copied to clipboard!', 'success');
}

function openTeamCalendarModal() {
  openModal('teamCalendarModal');
}

function resetTeamDateFilter() {
  const startEl = document.getElementById('team-date-start');
  const endEl = document.getElementById('team-date-end');
  if (startEl) startEl.textContent = '2026-10-01 22:59:41';
  if (endEl) endEl.textContent = '2026-10-29 22:59:41';
  showToast('Date range reset to default (October 2026)', 'info');
}

function confirmDateFilter() {
  closeModal('teamCalendarModal');
  showToast('Date filter confirmed: 2026-10-01 to 2026-10-29', 'success');
}

function changeCalendarMonth(delta) {
  const title = document.getElementById('cal-month-title');
  if (title) {
    title.textContent = delta > 0 ? '2026-11' : '2026-10';
  }
}

function openExclusivePosterModal() {
  openModal('exclusivePosterModal');
}

function sharePoster() {
  copyPromoLink();
  showToast('Poster link ready to share!', 'info');
}

function openUpgradeProgressModal(tier) {
  openModal('upgradeProgressModal');
}

window.copyPromoCode = copyPromoCode;
window.copyPromoLink = copyPromoLink;
window.openTeamCalendarModal = openTeamCalendarModal;
window.resetTeamDateFilter = resetTeamDateFilter;
window.confirmDateFilter = confirmDateFilter;
window.changeCalendarMonth = changeCalendarMonth;
window.openExclusivePosterModal = openExclusivePosterModal;
window.sharePoster = sharePoster;
window.openUpgradeProgressModal = openUpgradeProgressModal;
window.toggleTierAccordion = toggleTierAccordion;

function copyTeamReferral() {
  copyPromoLink();
}

function copyModalReferral() {
  const input = document.getElementById('modal-ref-input');
  if (input) {
    input.select();
    navigator.clipboard.writeText(input.value);
    showToast('Referral link copied to clipboard!', 'success');
  }
}

// ==================== VIEW 4: HISTORY PAGE (Requirement 1) ====================

let allHistoryTransactions = [];

async function loadHistoryData() {
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE}/wallet/transactions?limit=100`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.transactions) {
      allHistoryTransactions = data.transactions;
      filterHistory(currentHistoryFilter);
    }
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

function filterHistory(type) {
  currentHistoryFilter = type;

  // Update filter buttons
  const buttons = document.querySelectorAll('.history-filter-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${type}'`)) {
      btn.className = 'history-filter-btn active px-3 py-1 rounded-full bg-[#ff4e91] text-white font-bold whitespace-nowrap';
    } else {
      btn.className = 'history-filter-btn px-3 py-1 rounded-full bg-slate-800 text-slate-400 hover:text-white font-medium whitespace-nowrap';
    }
  });

  const container = document.getElementById('history-items-container');
  if (!container) return;

  let filtered = allHistoryTransactions;
  if (type !== 'all') {
    filtered = allHistoryTransactions.filter(t => t.type === type);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 bg-[#11141c] rounded-2xl border border-slate-800/80">
        <i data-lucide="receipt" class="w-10 h-10 text-slate-600 mx-auto mb-2"></i>
        <p class="text-slate-300 font-semibold text-xs">No records found</p>
        <p class="text-[10px] text-slate-500 mt-0.5">Transactions in this category will appear here in real-time.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = filtered.map(tx => {
    const isDebit = tx.type === 'withdrawal' || tx.type === 'investment';
    let icon = 'trending-up';
    let color = 'text-emerald-400';
    let bg = 'bg-emerald-500/10';
    let label = 'Earnings';

    if (tx.type === 'daily_roi') {
      icon = 'trending-up';
      color = 'text-emerald-400';
      bg = 'bg-emerald-500/10';
      label = 'Daily ROI Income';
    } else if (tx.type === 'referral_roi') {
      icon = 'repeat';
      color = 'text-cyan-400';
      bg = 'bg-cyan-500/10';
      label = 'Referral Income (ROI of ROI)';
    } else if (tx.type === 'team_commission') {
      icon = 'sparkles';
      color = 'text-amber-400';
      bg = 'bg-amber-500/10';
      label = 'Team Direct Commission';
    } else if (tx.type === 'deposit') {
      icon = 'arrow-down-left';
      color = 'text-pink-400';
      bg = 'bg-pink-500/10';
      label = 'Recharge Deposit';
    } else if (tx.type === 'withdrawal') {
      icon = 'arrow-up-right';
      color = 'text-rose-400';
      bg = 'bg-rose-500/10';
      label = 'Withdrawal';
    }

    return `
      <div class="bg-[#11141c] border border-[#1e2433] rounded-xl p-3 flex items-center justify-between text-xs hover:border-slate-700 transition">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg ${bg} ${color} flex items-center justify-center shrink-0">
            <i data-lucide="${icon}" class="w-4 h-4"></i>
          </div>
          <div>
            <div class="font-bold text-white text-xs">${tx.description || label}</div>
            <div class="text-[10px] text-slate-500">${new Date(tx.created_at).toLocaleString()}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-bold font-mono ${isDebit ? 'text-rose-400' : 'text-emerald-400'}">
            ${isDebit ? '-' : '+'}${tx.amount.toFixed(2)} USDT
          </div>
          <span class="text-[9px] uppercase px-1.5 py-0.5 rounded bg-black/60 text-slate-400">${tx.wallet_type.split('_')[0]}</span>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// ==================== VIEW 5: ASSETS PAGE (Requirement 4: RS replaces with USDT) ====================

async function loadAssetsData() {
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE}/wallet/overview`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.wallets) {
      userWallets = data.wallets;
      const w = userWallets;

      // Requirement 4: RS replaced with USDT
      const totalAmountEl = document.getElementById('asset-total-amount');
      if (totalAmountEl) {
        totalAmountEl.textContent = `${(w.totalAssets || 0).toFixed(2)} USDT`;
      }

      const homeTotalEl = document.getElementById('home-total-balance');
      if (homeTotalEl) {
        homeTotalEl.textContent = (w.totalAssets || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      const totalRechargeEl = document.getElementById('asset-total-recharge');
      if (totalRechargeEl) {
        totalRechargeEl.textContent = `${(w.totalRecharge || 0).toFixed(2)} USDT`;
      }

      const totalWithdrawnEl = document.getElementById('asset-total-withdrawal');
      if (totalWithdrawnEl) {
        totalWithdrawnEl.textContent = `${(w.totalWithdrawn || 0).toFixed(2)} USDT`;
      }

      // Assets Income Stats (Total ROI, Team ROI, Team Commission)
      const totalRoiEl = document.getElementById('stat-total-roi-income');
      if (totalRoiEl) {
        totalRoiEl.textContent = `${(w.totalRoiIncome || 0).toFixed(2)} USDT`;
      }

      const teamRoiEl = document.getElementById('stat-team-roi-income');
      if (teamRoiEl) {
        teamRoiEl.textContent = `${(w.totalTeamRoiIncome || 0).toFixed(2)} USDT`;
      }

      const teamCommEl = document.getElementById('stat-team-commission');
      if (teamCommEl) {
        teamCommEl.textContent = `${(w.totalTeamCommission || 0).toFixed(2)} USDT`;
      }

      // Legacy fallbacks if present
      const tradingAssetsEl = document.getElementById('stat-trading-assets');
      if (tradingAssetsEl) tradingAssetsEl.textContent = (w.tradingAssets || 0).toFixed(2);
      const bonusAssetsEl = document.getElementById('stat-bonus-assets');
      if (bonusAssetsEl) bonusAssetsEl.textContent = (w.bonusAssets || 0).toFixed(2);
      const accumulatedBonusEl = document.getElementById('stat-accumulated-bonus');
      if (accumulatedBonusEl) accumulatedBonusEl.textContent = (w.accumulatedBonus || 0).toFixed(2);
      const yesterdayIncomeEl = document.getElementById('stat-yesterday-income');
      if (yesterdayIncomeEl) yesterdayIncomeEl.textContent = `${(w.yesterdayIncome || 0).toFixed(2)} USDT`;
      const todayIncomeEl = document.getElementById('stat-today-income');
      if (todayIncomeEl) todayIncomeEl.textContent = `${(w.todayIncome || 0).toFixed(2)} USDT`;
      const profitMarginEl = document.getElementById('stat-profit-margin');
      if (profitMarginEl) profitMarginEl.textContent = w.profitMargin || '4.00%';
    }
  } catch (err) {
    console.error('Error loading assets data:', err);
  }
}

function loadWithdrawalModalData() {
  if (!userWallets) return;
  const availEl = document.getElementById('withdraw-available-bal');
  if (availEl) {
    availEl.textContent = `${(userWallets.totalWithdrawable || 0).toFixed(2)} USDT`;
  }
}

function setMaxWithdrawAmount() {
  if (!userWallets) return;
  const input = document.getElementById('withdraw-amount');
  const source = document.getElementById('withdraw-source').value;
  let max = 0;

  if (source === 'roi_balance') max = userWallets.roiWallet || 0;
  else if (source === 'commission_balance') max = userWallets.commissionWallet || 0;
  else max = userWallets.totalWithdrawable || 0;

  if (input) input.value = max;
}

function setRechargeAmount(amt) {
  const input = document.getElementById('deposit-amount');
  if (input) {
    input.value = amt;
    input.dispatchEvent(new Event('input'));
  }
}
window.setRechargeAmount = setRechargeAmount;

// ==================== DEPOSIT & WITHDRAWAL SUBMISSIONS ====================

async function handleDepositSubmit(e) {
  e.preventDefault();
  const amount = document.getElementById('deposit-amount').value;
  const txHash = document.getElementById('deposit-txhash').value;

  try {
    const res = await fetch(`${API_BASE}/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ amount, network: 'USDT-TRC20', txHash })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Deposit failed');
    }

    closeModal('rechargeModal');
    showToast(`✅ Recharge of $${data.amount} USDT confirmed!`, 'success');
    await fetchUserProfile();
    if (activeViewName === 'assets') await loadAssetsData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleWithdrawSubmit(e) {
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

    closeModal('withdrawModal');
    showToast(`Withdrawal of $${data.amount} USDT submitted! 0% Fee applied.`, 'success');
    await fetchUserProfile();
    if (activeViewName === 'assets') await loadAssetsData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== VIEW 6: ADMIN CONTROL ====================

async function loadAdminData() {
  if (!token || !currentUser || currentUser.role !== 'admin') return;

  try {
    // Withdrawals
    const withRes = await fetch(`${API_BASE}/admin/withdrawals`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const withData = await withRes.json();
    const withContainer = document.getElementById('admin-withdrawals-list');
    if (withContainer) {
      if (withData.success && withData.withdrawals && withData.withdrawals.length > 0) {
        withContainer.innerHTML = withData.withdrawals.map(w => `
          <div class="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div>
              <div class="font-bold text-white">#${w.id} &bull; ${w.username}</div>
              <div class="text-[10px] text-slate-400 font-mono truncate max-w-[150px]">${w.usdt_address}</div>
            </div>
            <div class="text-right flex items-center gap-2">
              <span class="font-bold text-white font-mono">$${w.amount}</span>
              ${w.status === 'pending' ? `
                <button onclick="approveWithdrawal(${w.id})" class="px-2 py-0.5 rounded bg-emerald-500 text-black font-bold text-[10px]">Approve</button>
              ` : `
                <span class="text-[9px] px-1 rounded bg-slate-800 text-slate-400 uppercase">${w.status}</span>
              `}
            </div>
          </div>
        `).join('');
      } else {
        withContainer.innerHTML = `<div class="text-center py-4 text-slate-500 text-xs">No pending withdrawals</div>`;
      }
    }

    // Users
    const usersRes = await fetch(`${API_BASE}/admin/users`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const usersData = await usersRes.json();
    const usersContainer = document.getElementById('admin-users-list');
    if (usersContainer && usersData.success && usersData.users) {
      usersContainer.innerHTML = usersData.users.map(u => `
        <div class="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <div class="font-bold text-white">${u.full_name || u.username} (@${u.username})</div>
            <div class="text-[10px] text-slate-400 font-mono">Ref: ${u.referral_code}</div>
          </div>
          <div class="text-right">
            <div class="font-bold text-cyan-300 font-mono">$${(u.wallet_balance || 0).toFixed(2)}</div>
            <span class="text-[9px] uppercase px-1 rounded bg-slate-800 text-amber-400">${u.role}</span>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Error loading admin data:', err);
  }
}

async function approveWithdrawal(id) {
  try {
    const res = await fetch(`${API_BASE}/admin/withdrawals/${id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Withdrawal #${id} approved!`, 'success');
      loadAdminData();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function triggerAdminDailyRoi() {
  if (!confirm('Run the daily ROI and 3-level Referral Income cycle now?')) return;

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
      showToast(`🚀 Processed ${data.processedInvestments} plans. Paid ROI: $${data.totalRoiDistributed}`, 'success');
      await fetchUserProfile();
      loadAdminData();
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
    lucide.createIcons();
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('flex');
    modal.classList.add('hidden');
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
    success: 'bg-[#10141f] border-emerald-500 text-emerald-300',
    error: 'bg-[#10141f] border-rose-500 text-rose-300',
    info: 'bg-[#10141f] border-[#ff4e91] text-pink-200'
  };

  toast.className = `toast border rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs font-semibold flex items-center justify-between gap-3 pointer-events-auto ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-white">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 4000);
}
