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

  // Load public announcements (ticker and pop image) immediately
  await loadPublicAnnouncements();

  // Authenticate current user or direct to login page
  if (token) {
    await fetchUserProfile();
  } else {
    updateAuthUI();
    const urlParams = new URLSearchParams(window.location.search);
    const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
    const ref = urlParams.get('ref');
    const action = urlParams.get('action');

    if (path === '/adminlogin') {
      navigate('adminlogin');
    } else if (ref || action === 'register' || path === '/register') {
      navigate('register');
    } else {
      navigate('login');
    }
  }

  // Start live crypto price pulse
  startCryptoTickerPulse();

  // Initialize interactive calendar and team stats immediately
  renderInteractiveCalendar();
  if (teamStatsCache) updateTeamUIWithStats(teamStatsCache);
});

// Cache for public announcements
let publicAnnouncementsCache = null;

async function loadPublicAnnouncements() {
  try {
    const res = await fetch(`${API_BASE}/auth/announcements?t=${Date.now()}`);
    const data = await res.json();
    if (data.success) {
      publicAnnouncementsCache = data;
      // Update scrolling ticker text immediately in header
      if (data.announcementTicker) {
        const tickerEl = document.getElementById('home-ticker-text');
        if (tickerEl) tickerEl.textContent = data.announcementTicker;
      }
      // If popup is active and has an image, trigger popup (works for both members and admin previewing member portal)
      if (data.popupImageActive && data.popupImageUrl) {
        checkAndShowMemberLoginPopup(data.popupImageUrl, data.popupImageTitle);
      }
    }
  } catch (e) {
    console.warn('Failed to load announcements:', e);
  }
}
window.loadPublicAnnouncements = loadPublicAnnouncements;

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
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const hash = window.location.hash.toLowerCase();
  const action = urlParams.get('action');
  const view = urlParams.get('view');
  const ref = urlParams.get('ref');

  if (ref) {
    const regSponsor = document.getElementById('reg-sponsor');
    if (regSponsor) regSponsor.value = ref;
  }

  if (path === '/adminlogin') {
    navigate('adminlogin');
  } else if (ref || action === 'register' || hash === '#register' || path === '/register') {
    navigate('register');
  } else if (action === 'login' || hash === '#login' || path === '/login') {
    navigate('login');
  } else if (action === 'admin' || view === 'admin' || hash === '#admin' || path === '/admin') {
    navigate('admin');
  }

  // Handle browser back and forward navigation
  window.addEventListener('popstate', (e) => {
    const state = e.state;
    if (state && state.view) {
      navigate(state.view, false);
    } else {
      const currentParams = new URLSearchParams(window.location.search);
      const currPath = window.location.pathname.toLowerCase().replace(/\/+$/, '');
      const currRef = currentParams.get('ref');
      const currAction = currentParams.get('action');
      const currView = currentParams.get('view');

      if (currPath === '/adminlogin') {
        navigate('adminlogin', false);
      } else if (currPath === '/register' || currRef || currAction === 'register') {
        navigate('register', false);
      } else if (currPath === '/login' || currAction === 'login') {
        navigate('login', false);
      } else if (currPath === '/admin' || currView === 'admin' || currAction === 'admin') {
        navigate('admin', false);
      } else {
        navigate('home', false);
      }
    }
  });

  // Close profile dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const profileDropdown = document.getElementById('crypto-profile-dropdown');
    const profileBtn = document.getElementById('profile-pill-btn');
    if (profileDropdown && !profileDropdown.classList.contains('hidden')) {
      if (!profileDropdown.contains(e.target) && !profileBtn?.contains(e.target)) {
        closeProfileDropdown();
      }
    }
  });
}

// ==================== CRYPTOFINANCE PROFILE DROPDOWN (Uploaded Image) ====================

function toggleProfileDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('crypto-profile-dropdown');
  const chevron = document.getElementById('profile-chevron-icon');
  if (!dropdown) return;

  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    dropdown.classList.remove('hidden');
    if (chevron) {
      chevron.setAttribute('data-lucide', 'chevron-up');
      lucide.createIcons();
    }
  } else {
    closeProfileDropdown();
  }
}

function closeProfileDropdown() {
  const dropdown = document.getElementById('crypto-profile-dropdown');
  const chevron = document.getElementById('profile-chevron-icon');
  if (dropdown) dropdown.classList.add('hidden');
  if (chevron) {
    chevron.setAttribute('data-lucide', 'chevron-down');
    lucide.createIcons();
  }
}

function openEditProfileModal() {
  closeProfileDropdown();
  if (!currentUser) return;
  const uidEl = document.getElementById('edit-prof-uid');
  if (uidEl) uidEl.textContent = currentUser.referral_code || 'CF163205';
  const userEl = document.getElementById('edit-prof-username');
  if (userEl) userEl.textContent = `@${currentUser.username}`;
  const fullEl = document.getElementById('edit-prof-fullname');
  if (fullEl) fullEl.value = currentUser.full_name || '';
  const phoneEl = document.getElementById('edit-prof-phone');
  if (phoneEl) phoneEl.value = currentUser.phone || '';
  const emailEl = document.getElementById('edit-prof-email');
  if (emailEl) emailEl.value = currentUser.email || '';
  
  // Reset OTP container and status
  const otpContainer = document.getElementById('edit-prof-otp-container');
  if (otpContainer) otpContainer.classList.add('hidden');
  const otpInput = document.getElementById('edit-prof-otp');
  if (otpInput) {
    otpInput.value = '';
    otpInput.required = false;
  }
  const sendBtn = document.getElementById('btn-edit-prof-send-otp');
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send OTP';
  }
  const oldEmailDisp = document.getElementById('edit-prof-old-email-display');
  if (oldEmailDisp) oldEmailDisp.textContent = currentUser.email || '';

  const emailBadge = document.getElementById('edit-prof-email-badge');
  if (emailBadge) {
    emailBadge.innerHTML = '<i data-lucide="shield-check" class="w-3 h-3 text-emerald-400"></i> Verified';
    emailBadge.className = 'text-[10px] text-emerald-400 font-mono flex items-center gap-1';
  }

  openModal('editProfileModal');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function handleEditProfileEmailChange() {
  if (!currentUser) return;
  const emailEl = document.getElementById('edit-prof-email');
  const currentVal = (emailEl?.value || '').trim().toLowerCase();
  const originalVal = (currentUser.email || '').trim().toLowerCase();
  const otpContainer = document.getElementById('edit-prof-otp-container');
  const otpInput = document.getElementById('edit-prof-otp');
  const emailBadge = document.getElementById('edit-prof-email-badge');

  if (currentVal !== originalVal) {
    // Email has changed -> show OTP box
    if (otpContainer) otpContainer.classList.remove('hidden');
    if (otpInput) otpInput.required = true;
    if (emailBadge) {
      emailBadge.innerHTML = '<i data-lucide="alert-triangle" class="w-3 h-3 text-amber-400"></i> Change Pending';
      emailBadge.className = 'text-[10px] text-amber-400 font-mono flex items-center gap-1';
    }
  } else {
    // Reverted back to original -> hide OTP box
    if (otpContainer) otpContainer.classList.add('hidden');
    if (otpInput) {
      otpInput.value = '';
      otpInput.required = false;
    }
    if (emailBadge) {
      emailBadge.innerHTML = '<i data-lucide="shield-check" class="w-3 h-3 text-emerald-400"></i> Verified';
      emailBadge.className = 'text-[10px] text-emerald-400 font-mono flex items-center gap-1';
    }
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.handleEditProfileEmailChange = handleEditProfileEmailChange;

async function handleSendEmailChangeOtp() {
  if (!currentUser) return;
  const btn = document.getElementById('btn-edit-prof-send-otp');
  const oldEmail = currentUser.email;
  const statusEl = document.getElementById('edit-prof-otp-status');

  if (!oldEmail) {
    showToast('No registered email found to send OTP', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Sending...</span>';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await fetch(`${API_BASE}/auth/email/send-change-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Security OTP sent to your registered email (${oldEmail})! Check inbox/spam.`, 'success');
      if (statusEl) statusEl.classList.remove('hidden');
      if (btn) {
        btn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i><span>OTP Sent</span>';
        if (window.lucide) lucide.createIcons();
      }
      // 60-second cooldown timer
      let countdown = 60;
      const interval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          if (btn) btn.innerHTML = `<span>Resend (${countdown}s)</span>`;
        } else {
          clearInterval(interval);
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i><span>Send OTP</span>';
            if (window.lucide) lucide.createIcons();
          }
        }
      }, 1000);
    } else {
      showToast(data.error || 'Failed to send OTP to old email', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i><span>Send OTP</span>';
        if (window.lucide) lucide.createIcons();
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i><span>Send OTP</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}
window.handleSendEmailChangeOtp = handleSendEmailChangeOtp;

async function handleUpdateProfile(e) {
  e.preventDefault();
  const fullName = (document.getElementById('edit-prof-fullname')?.value || '').trim();
  const phone = (document.getElementById('edit-prof-phone')?.value || '').trim();
  const email = (document.getElementById('edit-prof-email')?.value || '').trim();
  const otp = (document.getElementById('edit-prof-otp')?.value || '').trim();

  // If email was changed, check that OTP was entered
  if (currentUser && email.toLowerCase() !== (currentUser.email || '').toLowerCase()) {
    if (!otp) {
      showToast('Please enter the 6-digit OTP code sent to your old registered email', 'error');
      const otpInput = document.getElementById('edit-prof-otp');
      if (otpInput) otpInput.focus();
      return;
    }
  }

  const saveBtn = document.getElementById('btn-save-profile');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const res = await fetch(`${API_BASE}/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ fullName, phone, email, otp })
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      updateAuthUI();
      closeModal('editProfileModal');
      showToast('Profile updated successfully!', 'success');
    } else {
      showToast(data.error || 'Failed to update profile', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
}

function openChangePasswordModal() {
  closeProfileDropdown();
  const cpCurr = document.getElementById('cp-current');
  if (cpCurr) cpCurr.value = '';
  const cpNew = document.getElementById('cp-new');
  if (cpNew) cpNew.value = '';
  const cpConf = document.getElementById('cp-confirm');
  if (cpConf) cpConf.value = '';
  openModal('changePasswordModal');
}

async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('cp-current').value;
  const newPassword = document.getElementById('cp-new').value;
  const confirmPassword = document.getElementById('cp-confirm').value;

  if (newPassword !== confirmPassword) {
    showToast('New passwords do not match!', 'error');
    return;
  }
  if (newPassword.length < 6) {
    showToast('Password must be at least 6 characters long', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('changePasswordModal');
      showToast('Password updated successfully!', 'success');
    } else {
      showToast(data.error || 'Failed to update password', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openWalletAddressModal() {
  closeProfileDropdown();
  const dispEl = document.getElementById('bep20-current-display');
  if (dispEl) dispEl.textContent = currentUser?.usdt_address || 'Not Set';
  const inpEl = document.getElementById('bep20-address-input');
  if (inpEl) inpEl.value = currentUser?.usdt_address || '';
  openModal('bep20WalletModal');
}

async function handleSendWalletOtp() {
  const btn = document.getElementById('btn-bep20-send-otp');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/auth/wallet-address/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast('Security OTP sent to your registered email!', 'success');
      if (btn) btn.textContent = 'OTP Sent';
    } else {
      showToast(data.error || 'Failed to send OTP', 'error');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) btn.disabled = false;
  }
}
window.handleSendWalletOtp = handleSendWalletOtp;

async function handleUpdateWalletAddress(e) {
  e.preventDefault();
  const walletAddress = document.getElementById('bep20-address-input').value.trim();
  const otp = document.getElementById('bep20-otp-input')?.value.trim();

  if (!walletAddress) {
    showToast('Please enter a valid BEP-20 wallet address', 'error');
    return;
  }
  if (!otp) {
    showToast('Please enter the 6-digit OTP code sent to your email', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/wallet-address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ walletAddress, otp })
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      updateAuthUI();
      closeModal('bep20WalletModal');
      const otpInput = document.getElementById('bep20-otp-input');
      if (otpInput) otpInput.value = '';
      showToast('BEP-20 Wallet Address verified and updated successfully!', 'success');
    } else {
      showToast(data.error || 'Failed to update wallet address', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
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
      await refreshCurrentViewData();
    } else {
      logout();
    }
  } catch (err) {
    console.error('Failed to fetch profile:', err);
    logout();
  }
}

function getAppBaseUrl() {
  if (window.location.origin && window.location.origin.includes('catalystcapital.fit')) {
    return window.location.origin;
  }
  return 'https://www.catalystcapital.fit';
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

    // CryptoFinance Dropdown Information (Uploaded Screenshot)
    const cfUid = document.getElementById('cf-prof-uid');
    if (cfUid) cfUid.textContent = currentUser.referral_code || 'CF163205';

    const cfStatus = document.getElementById('cf-prof-status');
    if (cfStatus) {
      if (currentUser.role === 'admin') {
        cfStatus.textContent = 'Active (Admin)';
      } else if (currentUser.status === 'active') {
        cfStatus.textContent = 'Active';
      } else {
        cfStatus.textContent = 'Pending Activation';
      }
    }

    const cfAdminLink = document.getElementById('cf-prof-admin-link');
    if (cfAdminLink) {
      if (currentUser.role === 'admin') cfAdminLink.classList.remove('hidden');
      else cfAdminLink.classList.add('hidden');
    }

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
    const refLink = `${getAppBaseUrl()}/register?ref=${currentUser.referral_code}`;
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

    // Permanently ensure Profile Avatar Pill in Header is visible across all member and admin views
    const profilePill = document.getElementById('profile-pill-wrapper');
    if (profilePill) {
      if (activeViewName !== 'login' && activeViewName !== 'adminlogin' && activeViewName !== 'register') {
        profilePill.classList.remove('hidden');
        profilePill.style.removeProperty('display');
      } else {
        profilePill.classList.add('hidden');
      }
    }
  } else {
    if (btnLogin) btnLogin.classList.remove('hidden');
    if (btnProfile) btnProfile.classList.add('hidden');
    const profilePill = document.getElementById('profile-pill-wrapper');
    if (profilePill) profilePill.classList.add('hidden');
    if (activeBadge) activeBadge.textContent = 'Guest';
  }

  // Ensure Admin Portal button in header is strictly hidden for non-admins or logged out users
  const portalBtn = document.getElementById('portal-switch-btn');
  if (portalBtn) {
    if (currentUser && currentUser.role === 'admin' && activeViewName !== 'login' && activeViewName !== 'adminlogin' && activeViewName !== 'register') {
      portalBtn.classList.remove('hidden');
      portalBtn.style.removeProperty('display');
    } else {
      portalBtn.classList.add('hidden');
      portalBtn.style.setProperty('display', 'none', 'important');
    }
  }
}

// Logo click handler: Stays in Admin Portal if admin is in admin portal, else navigates to home
function handleAppLogoClick() {
  if (currentUser && currentUser.role === 'admin') {
    if (activeViewName === 'admin') {
      // Already in Admin portal -> reload or scroll to top of admin portal
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
  }
  // For regular members or when in user portal
  if (currentUser) {
    navigate('home');
  } else {
    navigate('login');
  }
}
window.handleAppLogoClick = handleAppLogoClick;

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
  const loginIdInput = document.getElementById('login-id');
  const passwordInput = document.getElementById('login-password');
  const loginId = loginIdInput ? loginIdInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  const currentPath = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const isAdminPortal = (activeViewName === 'adminlogin' || currentPath === '/adminlogin');
  const portalType = isAdminPortal ? 'admin' : 'member';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId, password, portalType })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Login failed');
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('catalyst_token', token);

    // Reset login popup session flag on fresh login so member sees latest active popup
    hasShownLoginPopupThisSession = false;

    updateAuthUI();
    showToast(`Welcome ${currentUser.full_name || currentUser.username}!`, 'success');
    await refreshCurrentViewData();

    if (currentUser.role === 'admin') {
      navigate('admin');
    } else {
      navigate('home');
      // Trigger pop image check immediately
      if (publicAnnouncementsCache && publicAnnouncementsCache.popupImageActive && publicAnnouncementsCache.popupImageUrl) {
        checkAndShowMemberLoginPopup(publicAnnouncementsCache.popupImageUrl, publicAnnouncementsCache.popupImageTitle);
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSendRegistrationOtp() {
  const emailInput = document.getElementById('reg-email');
  const email = emailInput ? emailInput.value.trim() : '';
  const btn = document.getElementById('btn-reg-send-otp');

  if (!email || !email.includes('@')) {
    showToast('Please enter a valid email address first', 'error');
    return;
  }

  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, purpose: 'registration' })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Registration OTP sent to your email! Please check inbox/spam.', 'success');
      if (btn) btn.textContent = 'OTP Sent';
    } else {
      showToast(data.error || 'Failed to send OTP', 'error');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) btn.disabled = false;
  }
}
window.handleSendRegistrationOtp = handleSendRegistrationOtp;

async function handleRegister(e) {
  e.preventDefault();
  const fullName = (document.getElementById('reg-fullname')?.value || '').trim();
  const email = (document.getElementById('reg-email')?.value || '').trim();
  const sponsorCode = (document.getElementById('reg-sponsor')?.value || '').trim();
  const phone = (document.getElementById('reg-phone')?.value || '').trim();
  const password = document.getElementById('reg-password')?.value || '';
  const otp = (document.getElementById('reg-otp')?.value || '').trim();

  if (!otp) {
    showToast('Please enter the 6-digit Email Verification OTP', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, sponsorCode, phone, password, otp })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Registration failed');
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('catalyst_token', token);

    updateAuthUI();
    showToast(`Account created! Welcome ${currentUser.full_name}. Your User ID: ${data.memberUserId || currentUser.referral_code}`, 'success');
    await refreshCurrentViewData();
    navigate('home');
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
  navigate('login');
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  if (btn) {
    btn.innerHTML = isPass ? '<i data-lucide="eye-off" class="w-4 h-4"></i>' : '<i data-lucide="eye" class="w-4 h-4"></i>';
    if (window.lucide) lucide.createIcons();
  }
}
window.togglePasswordVisibility = togglePasswordVisibility;

// ==================== NAVIGATION (5 TABS) ====================

let activeViewName = 'home';

function toggleAdminPortal() {
  if (activeViewName === 'admin') {
    hasShownLoginPopupThisSession = false; // Allow admin to preview pop image as regular user sees it
    navigate('home');
  } else {
    navigate('admin');
  }
}

function navigate(viewName, updateHistory = true) {
  // If user is not logged in, force navigation to login, adminlogin, or register
  if (!token && !currentUser && viewName !== 'login' && viewName !== 'register' && viewName !== 'adminlogin') {
    viewName = 'login';
  }

  // Handle adminlogin as a specialized mode of the login view
  const isAdminLoginMode = (viewName === 'adminlogin');
  const targetViewKey = isAdminLoginMode ? 'login' : viewName;
  activeViewName = viewName;

  // Update browser URL in address bar if requested
  if (updateHistory) {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (viewName === 'adminlogin') {
        window.history.pushState({ view: 'adminlogin' }, '', '/adminlogin');
      } else if (viewName === 'login') {
        window.history.pushState({ view: 'login' }, '', '/login');
      } else if (viewName === 'register') {
        const ref = urlParams.get('ref') || (document.getElementById('reg-sponsor')?.value || '').trim();
        if (ref) {
          window.history.pushState({ view: 'register' }, '', `/register?ref=${encodeURIComponent(ref)}`);
        } else {
          window.history.pushState({ view: 'register' }, '', '/register');
        }
      } else if (viewName === 'admin') {
        window.history.pushState({ view: 'admin' }, '', '/admin');
      } else if (viewName === 'home') {
        window.history.pushState({ view: 'home' }, '', '/');
      } else {
        window.history.pushState({ view: viewName }, '', `/${encodeURIComponent(viewName)}`);
      }
    } catch (e) {
      console.warn('History pushState error:', e);
    }
  }

  const views = ['home', 'quotes', 'invest', 'team', 'history', 'assets', 'admin', 'login', 'register'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
  });

  const targetView = document.getElementById(`view-${targetViewKey}`);
  if (targetView) targetView.classList.remove('hidden');

  // Toggle admin active class on body for responsive container adaptation
  document.body.classList.toggle('admin-view-active', viewName === 'admin');

  // Configure Login Page presentation based on adminlogin vs regular login
  const adminBadge = document.getElementById('login-admin-badge');
  const loginTitle = document.getElementById('login-page-title');
  const loginSubtitle = document.getElementById('login-page-subtitle');
  const regSwitch = document.getElementById('login-register-switch-container');
  if (isAdminLoginMode) {
    if (adminBadge) adminBadge.classList.remove('hidden');
    if (loginTitle) loginTitle.textContent = 'Admin Portal Login';
    if (loginSubtitle) loginSubtitle.textContent = 'Authorized administrators and staff credentials only';
    if (regSwitch) regSwitch.classList.add('hidden');
  } else {
    if (adminBadge) adminBadge.classList.add('hidden');
    if (loginTitle) loginTitle.textContent = 'Account Login';
    if (loginSubtitle) loginSubtitle.textContent = 'Sign in to access your investment dashboard';
    if (regSwitch) regSwitch.classList.remove('hidden');
  }

  // Control Header elements and Bottom Nav Bar visibility
  const bottomNav = document.getElementById('global-bottom-nav');
  const profilePill = document.getElementById('profile-pill-wrapper');
  const portalBtn = document.getElementById('portal-switch-btn');

  // Hide bottom menu on auth pages AND when Admin Portal is active
  if (viewName === 'login' || viewName === 'adminlogin' || viewName === 'register' || viewName === 'admin') {
    if (bottomNav) {
      bottomNav.classList.add('hidden');
      bottomNav.style.setProperty('display', 'none', 'important');
    }
  } else if (currentUser) {
    if (bottomNav) {
      bottomNav.classList.remove('hidden');
      bottomNav.style.removeProperty('display');
    }
  } else {
    if (bottomNav) {
      bottomNav.classList.add('hidden');
      bottomNav.style.setProperty('display', 'none', 'important');
    }
  }

  // Header pill & portal button visibility
  if (viewName === 'login' || viewName === 'adminlogin' || viewName === 'register') {
    if (profilePill) profilePill.classList.add('hidden');
    if (portalBtn) {
      portalBtn.classList.add('hidden');
      portalBtn.style.setProperty('display', 'none', 'important');
    }
  } else {
    if (currentUser) {
      if (profilePill) profilePill.classList.remove('hidden');
      if (portalBtn) {
        if (currentUser.role === 'admin') {
          portalBtn.classList.remove('hidden');
          portalBtn.style.removeProperty('display');
        } else {
          portalBtn.classList.add('hidden');
          portalBtn.style.setProperty('display', 'none', 'important');
        }
      }
    } else {
      if (profilePill) profilePill.classList.add('hidden');
      if (portalBtn) {
        portalBtn.classList.add('hidden');
        portalBtn.style.setProperty('display', 'none', 'important');
      }
    }
  }

  // Update Portal Switcher Button appearance if admin
  const switchBtn = document.getElementById('portal-switch-btn');
  const switchText = document.getElementById('portal-switch-text');
  const switchIcon = document.getElementById('portal-switch-icon');
  if (switchBtn && switchText) {
    const isActuallyAdmin = currentUser && currentUser.role === 'admin' && viewName !== 'login' && viewName !== 'register';
    if (viewName === 'admin') {
      switchText.textContent = 'User Portal';
      switchBtn.className = `px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 shadow-sm transition bg-cyan-500/15 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/25 active:scale-95 ${!isActuallyAdmin ? 'hidden' : ''}`.trim();
      if (switchIcon) switchIcon.setAttribute('data-lucide', 'user');
    } else {
      switchText.textContent = 'Admin Portal';
      switchBtn.className = `px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 shadow-sm transition bg-amber-500/15 border border-amber-500/40 text-amber-400 hover:bg-amber-500/25 active:scale-95 ${!isActuallyAdmin ? 'hidden' : ''}`.trim();
      if (switchIcon) switchIcon.setAttribute('data-lucide', 'shield-check');
    }
    if (!isActuallyAdmin) {
      switchBtn.style.setProperty('display', 'none', 'important');
    } else {
      switchBtn.style.removeProperty('display');
    }
    if (window.lucide) lucide.createIcons();
  }

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

  // If entering home/member portal, check if announcement pop image should be displayed
  if (viewName === 'home') {
    if (publicAnnouncementsCache && publicAnnouncementsCache.popupImageActive && publicAnnouncementsCache.popupImageUrl) {
      checkAndShowMemberLoginPopup(publicAnnouncementsCache.popupImageUrl, publicAnnouncementsCache.popupImageTitle);
    } else {
      loadPublicAnnouncements();
    }
  }

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
    navigate('login');
    return;
  }
  openModal('rechargeModal');
}

function openWithdrawModal() {
  if (!currentUser) {
    navigate('login');
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
    navigate('login');
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
    navigate('login');
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
    showToast('Please log in to activate an investment package', 'info');
    navigate('login');
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

// Initial/fallback team stats - defaults to 0 members until loaded from live network API
const defaultTeamStats = {
  totalTeam: 0,
  validUsers: 0,
  totalRecharge: 0.00,
  minTransactionAmount: 11.00,
  peopleToday: 0,
  validToday: 0,
  totalWithdrawals: 0.00,
  levels: {
    level1: { count: 0, effective: 0, volume: 0.00, commission: 0.00, users: [] },
    level2: { count: 0, effective: 0, volume: 0.00, commission: 0.00, users: [] },
    level3: { count: 0, effective: 0, volume: 0.00, commission: 0.00, users: [] }
  }
};

let teamStatsCache = defaultTeamStats;

async function loadTeamData() {
  const promoCode = currentUser ? (currentUser.referral_code || 'CATADMIN') : 'CATADMIN';
  const promoLink = `${getAppBaseUrl()}/?ref=${promoCode}`;

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

  // If user has token, fetch live from backend
  if (token) {
    try {
      const statsRes = await fetch(`${API_BASE}/network/downline-stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const statsData = await statsRes.json();
      if (statsData.success && statsData.levels) {
        teamStatsCache = statsData;
      }
    } catch (err) {
      console.warn('Live team stats unavailable, using cached/demo data:', err);
    }
  }

  updateTeamUIWithStats(teamStatsCache);
}

function updateTeamUIWithStats(s) {
  if (!s) return;

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
  const l1 = (s.levels && s.levels.level1) ? s.levels.level1 : { count: 0, effective: 0, commission: 0, users: [] };
  const l2 = (s.levels && s.levels.level2) ? s.levels.level2 : { count: 0, effective: 0, commission: 0, users: [] };
  const l3 = (s.levels && s.levels.level3) ? s.levels.level3 : { count: 0, effective: 0, commission: 0, users: [] };

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

function safeFormatDate(dateStr) {
  if (!dateStr) return '2026-10-01';
  const m = String(dateStr).match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : String(dateStr).slice(0, 10);
}

function renderTierMembers(level, users) {
  const container = document.getElementById(`t${level}-details-container`);
  if (!container) return;

  if (!users || users.length === 0) {
    container.innerHTML = `<div class="text-center py-2.5 text-slate-500 text-[11px]">No T${level} subordinates in selected date range.</div>`;
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
      <div>
        <div class="font-bold text-white text-xs">${u.full_name || u.username}</div>
        <div class="text-[10px] text-slate-400 font-mono">@${u.username} &bull; Joined ${safeFormatDate(u.created_at)}</div>
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
  const code = currentUser ? (currentUser.referral_code || 'CATADMIN') : 'CATADMIN';
  copyToClipboard(code);
  showToast(`Promotion Code ${code} copied!`, 'success');
}

function copyPromoLink() {
  const code = currentUser ? (currentUser.referral_code || 'CATADMIN') : 'CATADMIN';
  const link = `${getAppBaseUrl()}/?ref=${code}`;
  copyToClipboard(link);
  showToast('Invitation link copied to clipboard!', 'success');
}

// ==================== INTERACTIVE DATE RANGE CALENDAR ====================

let calYear = 2026;
let calMonth = 9; // 0-based: 9 = October
let calStartDate = '2026-10-01';
let calEndDate = '2026-10-29';

function openTeamCalendarModal() {
  openModal('teamCalendarModal');
  renderInteractiveCalendar();
  if (window.lucide) lucide.createIcons();
}

function changeCalendarMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) {
    calMonth = 11;
    calYear--;
  } else if (calMonth > 11) {
    calMonth = 0;
    calYear++;
  }
  renderInteractiveCalendar();
  if (window.lucide) lucide.createIcons();
}

function renderInteractiveCalendar() {
  const titleEl = document.getElementById('cal-month-title');
  const monthStr = String(calMonth + 1).padStart(2, '0');
  if (titleEl) titleEl.textContent = `${calYear}-${monthStr}`;

  const grid = document.getElementById('calendar-days-grid');
  if (!grid) return;

  const firstDayIndex = new Date(calYear, calMonth, 1).getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  let html = '';
  // Empty offset cells for preceding weekdays
  for (let i = 0; i < firstDayIndex; i++) {
    html += '<div class="cal-cell pointer-events-none"></div>';
  }

  const todayStr = '2026-10-05';

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${calYear}-${monthStr}-${String(d).padStart(2, '0')}`;
    const isStart = (calStartDate === dayStr);
    const isEnd = (calEndDate === dayStr);
    const inRange = Boolean(calStartDate && calEndDate && dayStr > calStartDate && dayStr < calEndDate);
    const isSingle = Boolean(isStart && (!calEndDate || calStartDate === calEndDate));
    const isToday = (dayStr === todayStr);

    let cellClass = 'cal-cell';
    let innerContent = '';

    if (isSingle) {
      cellClass += ' single-selected';
      innerContent = `
        <div class="cal-pill">
          ${d}
        </div>
      `;
    } else if (isStart) {
      cellClass += ' range-start';
      innerContent = `
        <div class="cal-pill">
          ${d}
        </div>
      `;
    } else if (isEnd) {
      cellClass += ' range-end';
      innerContent = `
        <div class="cal-pill">
          ${d}
        </div>
      `;
    } else if (inRange) {
      cellClass += ' in-range';
      innerContent = `
        <span class="cal-cell-content text-white font-bold">
          ${d} ${isToday ? '<span class="cal-today-dot"></span>' : ''}
        </span>
      `;
    } else {
      innerContent = `
        <div class="cal-hover-circle">
          <span class="cal-cell-content text-slate-200">
            ${d} ${isToday ? '<span class="cal-today-dot"></span>' : ''}
          </span>
        </div>
      `;
    }

    html += `<div onclick="window.handleCalendarDateClick('${dayStr}')" class="${cellClass}" title="${dayStr}">${innerContent}</div>`;
  }

  grid.innerHTML = html;

  // Update modal footer text
  const startEl = document.getElementById('cal-selected-start');
  const endEl = document.getElementById('cal-selected-end');
  if (startEl) startEl.textContent = calStartDate || 'Start Date';
  if (endEl) {
    if (calEndDate) {
      endEl.textContent = calEndDate;
      endEl.classList.remove('text-slate-400');
      endEl.classList.add('text-slate-200');
    } else {
      endEl.textContent = 'End Date';
      endEl.classList.remove('text-slate-200');
      endEl.classList.add('text-slate-400');
    }
  }
}

function handleCalendarDateClick(dateStr) {
  if (!calStartDate || (calStartDate && calEndDate)) {
    // 1st click: Start a fresh selection
    calStartDate = dateStr;
    calEndDate = null;
  } else if (calStartDate && !calEndDate) {
    // 2nd click: Complete the range
    if (dateStr < calStartDate) {
      calEndDate = calStartDate;
      calStartDate = dateStr;
    } else {
      calEndDate = dateStr;
    }
  }
  renderInteractiveCalendar();
}

function confirmDateFilter() {
  if (!calStartDate) {
    calStartDate = '2026-10-01';
  }
  if (!calEndDate) {
    calEndDate = calStartDate;
  }

  const startDisplay = document.getElementById('team-date-start');
  const endDisplay = document.getElementById('team-date-end');

  if (startDisplay) startDisplay.textContent = `${calStartDate} 22:59:41`;
  if (endDisplay) endDisplay.textContent = `${calEndDate} 22:59:41`;

  applyTeamDateFilter(calStartDate, calEndDate);

  closeModal('teamCalendarModal');
  showToast(`Date filter applied: ${calStartDate} to ${calEndDate}`, 'success');
}

function resetTeamDateFilter() {
  calYear = 2026;
  calMonth = 9;
  calStartDate = '2026-10-01';
  calEndDate = '2026-10-29';

  const startDisplay = document.getElementById('team-date-start');
  const endDisplay = document.getElementById('team-date-end');

  if (startDisplay) startDisplay.textContent = '2026-10-01 22:59:41';
  if (endDisplay) endDisplay.textContent = '2026-10-29 22:59:41';

  renderInteractiveCalendar();
  applyTeamDateFilter(null, null);
  showToast('Date range reset to default', 'info');
}

function applyTeamDateFilter(startDate, endDate) {
  const s = teamStatsCache || defaultTeamStats;
  if (!startDate || !endDate) {
    updateTeamUIWithStats(s);
    return;
  }

  // Filter members by created_at range safely without invalid Date crashes on mobile
  const filterUsers = (users) => {
    if (!users || !Array.isArray(users)) return [];
    return users.filter(u => {
      if (!u.created_at) return true;
      const str = String(u.created_at);
      const match = str.match(/\d{4}-\d{2}-\d{2}/);
      const d = match ? match[0] : str.slice(0, 10);
      return d >= startDate && d <= endDate;
    });
  };

  const l1Users = filterUsers((s.levels && s.levels.level1) ? s.levels.level1.users : []);
  const l2Users = filterUsers((s.levels && s.levels.level2) ? s.levels.level2.users : []);
  const l3Users = filterUsers((s.levels && s.levels.level3) ? s.levels.level3.users : []);

  const calcMetrics = (users) => {
    let eff = 0;
    let vol = 0;
    let comm = 0;
    users.forEach(u => {
      if ((u.active_investment || 0) > 0) eff++;
      vol += (u.active_investment || 0);
      comm += (u.commission_earned || 0);
    });
    return { count: users.length, effective: eff, volume: vol, commission: comm, users };
  };

  const fl1 = calcMetrics(l1Users);
  const fl2 = calcMetrics(l2Users);
  const fl3 = calcMetrics(l3Users);

  const filteredStats = {
    totalTeam: fl1.count + fl2.count + fl3.count,
    validUsers: fl1.effective + fl2.effective + fl3.effective,
    totalRecharge: fl1.volume + fl2.volume + fl3.volume,
    minTransactionAmount: s.minTransactionAmount || 11.00,
    peopleToday: s.peopleToday || 0,
    validToday: s.validToday || 0,
    totalWithdrawals: s.totalWithdrawals || 0,
    levels: {
      level1: fl1,
      level2: fl2,
      level3: fl3
    }
  };

  updateTeamUIWithStats(filteredStats);
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
window.handleCalendarDateClick = handleCalendarDateClick;
window.openExclusivePosterModal = openExclusivePosterModal;
window.sharePoster = sharePoster;
window.openUpgradeProgressModal = openUpgradeProgressModal;
window.toggleTierAccordion = toggleTierAccordion;
window.toggleAdminPortal = toggleAdminPortal;

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
            ${tx.reference_id && /^0x[a-fA-F0-9]{64}$/i.test(tx.reference_id) ? `
              <div class="mt-0.5">
                <a href="https://bscscan.com/tx/${tx.reference_id}" target="_blank" rel="noopener noreferrer" class="text-cyan-400 hover:text-cyan-300 font-mono text-[9px] underline inline-flex items-center gap-1">
                  <span>${tx.reference_id.substring(0, 10)}...${tx.reference_id.substring(58)}</span>
                  <i data-lucide="external-link" class="w-2.5 h-2.5"></i>
                </a>
              </div>
            ` : ''}
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

    // Apply Dynamic Announcement Ticker & Pop Image from Server Rules
    if (data.rules) {
      if (data.rules.announcementTicker) {
        const tickerEl = document.getElementById('home-ticker-text');
        if (tickerEl) tickerEl.textContent = data.rules.announcementTicker;
      }

      // Member Login Pop Image (Trigger once per session / on login)
      if (data.rules.popupImageActive && data.rules.popupImageUrl) {
        checkAndShowMemberLoginPopup(data.rules.popupImageUrl, data.rules.popupImageTitle);
      }
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
  let txHash = (document.getElementById('deposit-txhash').value || '').trim();

  if (!amount || Number(amount) <= 0) {
    showToast('Please enter a valid deposit amount', 'error');
    return;
  }

  if (!txHash) {
    showToast('Transaction Hash / TXID is required for deposit verification', 'error');
    const hashInput = document.getElementById('deposit-txhash');
    if (hashInput) hashInput.focus();
    return;
  }

  // Auto-prepend 0x if user pasted 64 hex characters without prefix
  if (/^[a-fA-F0-9]{64}$/.test(txHash)) {
    txHash = '0x' + txHash;
    const hashInput = document.getElementById('deposit-txhash');
    if (hashInput) hashInput.value = txHash;
  }

  // Validate BSC BEP-20 Transaction Hash (66 chars, 0x + 64 hex chars)
  const txHashRegex = /^0x[a-fA-F0-9]{64}$/i;
  if (!txHashRegex.test(txHash)) {
    showToast('Please enter a valid 66-character BEP-20 Transaction Hash (starting with 0x)', 'error');
    const hashInput = document.getElementById('deposit-txhash');
    if (hashInput) hashInput.focus();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ amount: Number(amount), network: 'USDT-BEP20', txHash })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Deposit failed');
    }

    closeModal('rechargeModal');
    const depositInput = document.getElementById('deposit-amount');
    const hashInput = document.getElementById('deposit-txhash');
    if (depositInput) depositInput.value = '';
    if (hashInput) hashInput.value = '';

    showToast(`⏳ Deposit request of $${data.amount} USDT submitted! Funds will be credited upon Admin approval.`, 'info');
    await fetchUserProfile();
    if (activeViewName === 'assets') await loadAssetsData();
    if (activeViewName === 'history') await loadHistoryData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleWithdrawSubmit(e) {
  e.preventDefault();
  const amount = document.getElementById('withdraw-amount').value;
  const usdtAddress = (document.getElementById('withdraw-address').value || '').trim();
  const walletSource = document.getElementById('withdraw-source').value;

  if (!amount || Number(amount) < 15) {
    showToast('Minimum withdrawal amount is 15 USDT', 'error');
    return;
  }

  // Validate BEP-20 address (42 chars, 0x + 40 hex chars)
  const bep20AddressRegex = /^0x[a-fA-F0-9]{40}$/i;
  if (!bep20AddressRegex.test(usdtAddress)) {
    showToast('Please enter a valid 42-character USDT (BEP-20) address starting with 0x', 'error');
    const addrInput = document.getElementById('withdraw-address');
    if (addrInput) addrInput.focus();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ amount: Number(amount), usdtAddress, network: 'USDT-BEP20', walletSource })
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

// ==================== VIEW 6: ADMIN CONTROL & PORTAL IMPERSONATION ====================

let adminCachedUsers = [];
let currentInspectedUserId = null;
let originalAdminToken = localStorage.getItem('catalyst_admin_orig_token') || null;

async function loadAdminData() {
  if (!token || !currentUser || currentUser.role !== 'admin') return;

  try {
    // 1. Load Platform Stats (Total Business, Deposits, Withdrawals, Users, ROI)
    const statsRes = await fetch(`${API_BASE}/admin/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const statsData = await statsRes.json();
    if (statsData.success && statsData.stats) {
      const s = statsData.stats;
      const bEl = document.getElementById('admin-stat-total-business');
      if (bEl) bEl.textContent = `$${(s.totalBusiness || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      const uEl = document.getElementById('admin-stat-total-users');
      if (uEl) uEl.textContent = s.totalUsers || 0;

      const dEl = document.getElementById('admin-stat-deposits');
      if (dEl) dEl.textContent = `$${(s.totalDepositsVolume || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const pDepEl = document.getElementById('admin-stat-pending-dep-sub');
      if (pDepEl) pDepEl.textContent = `${s.pendingDepositsCount || 0} Pending ($${(s.pendingDepositsVolume || 0).toFixed(2)})`;

      const wEl = document.getElementById('admin-stat-withdrawals');
      if (wEl) wEl.textContent = `$${(s.approvedWithdrawalsVolume || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const pWthEl = document.getElementById('admin-stat-pending-wth-sub');
      if (pWthEl) pWthEl.textContent = `${s.pendingWithdrawalsCount || 0} Pending ($${(s.pendingWithdrawalsVolume || 0).toFixed(2)})`;

      const bWth = document.getElementById('admin-badge-wth');
      if (bWth) {
        if (s.pendingWithdrawalsCount > 0) {
          bWth.textContent = s.pendingWithdrawalsCount;
          bWth.classList.remove('hidden');
        } else {
          bWth.classList.add('hidden');
        }
      }

      const bTkt = document.getElementById('admin-badge-tickets');
      if (bTkt) {
        if (s.openTicketsCount > 0) {
          bTkt.textContent = s.openTicketsCount;
          bTkt.classList.remove('hidden');
        } else {
          bTkt.classList.add('hidden');
        }
      }
    }

    // 2. Load Members List
    const usersRes = await fetch(`${API_BASE}/admin/users`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const usersData = await usersRes.json();
    if (usersData.success && usersData.users) {
      adminCachedUsers = usersData.users;
      renderAdminUsersList(adminCachedUsers);
      populateManualDepositUserSelect(adminCachedUsers);
    }

    // 3. Load Withdrawals
    await loadAdminWithdrawals();

    // 4. Load Deposits
    await loadAdminDeposits();

    // 5. Load Tickets
    await loadAdminTickets();

    // 6. Load Announcements & Pop Image Settings
    await loadAdminSettings();

  } catch (err) {
    console.error('Error loading admin data:', err);
  }
}

function switchAdminTab(tabName) {
  const tabs = ['users', 'withdrawals', 'deposits', 'tickets', 'announcements'];
  tabs.forEach(t => {
    const btn = document.getElementById(`admin-tab-btn-${t}`);
    const content = document.getElementById(`admin-tab-content-${t}`);
    if (btn) {
      if (t === tabName) {
        btn.classList.add('active', 'bg-amber-500/20', 'text-amber-400', 'border', 'border-amber-500/30');
        btn.classList.remove('text-slate-400');
      } else {
        btn.classList.remove('active', 'bg-amber-500/20', 'text-amber-400', 'border', 'border-amber-500/30');
        btn.classList.add('text-slate-400');
      }
    }
    if (content) {
      if (t === tabName) content.classList.remove('hidden');
      else content.classList.add('hidden');
    }
  });
  if (window.lucide) lucide.createIcons();
}
window.switchAdminTab = switchAdminTab;

function renderAdminUsersList(users) {
  const container = document.getElementById('admin-users-list');
  if (!container) return;

  if (!users || users.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">No members found matching your search.</div>`;
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition space-y-3 shadow-md overflow-hidden">
      <!-- Top Row: Avatar + User Info + Role/Status Badges -->
      <div class="flex items-start justify-between gap-2.5">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-tr from-amber-500 to-amber-700 text-black font-black text-sm flex items-center justify-center shrink-0 shadow-sm">
            ${(u.full_name || u.username || 'U')[0].toUpperCase()}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="font-bold text-white text-xs sm:text-sm truncate max-w-[140px] sm:max-w-[200px]">${u.full_name || u.username}</span>
              <span class="text-slate-400 font-mono text-[11px]">(@${u.username})</span>
            </div>
            <div class="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5 flex-wrap font-mono">
              <span>Ref: <strong class="text-amber-400">${u.referral_code}</strong></span>
              <span class="text-slate-600">&bull;</span>
              <span>Sponsor: <span class="text-slate-300">${u.sponsor_username ? '@' + u.sponsor_username : 'None'}</span></span>
            </div>
          </div>
        </div>
        <div class="flex flex-col items-end gap-1 shrink-0">
          <span class="text-[9px] uppercase px-2 py-0.5 rounded font-mono font-bold ${u.role === 'admin' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-cyan-400 border border-slate-700'}">${u.role}</span>
          <span class="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${u.status === 'active' ? 'text-emerald-400' : 'text-rose-400'} flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full ${u.status === 'active' ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
            ${u.status}
          </span>
        </div>
      </div>

      <!-- Financial Metrics Grid -->
      <div class="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px]">
        <div>
          <div class="text-[10px] text-slate-400 font-medium">Recharge Balance</div>
          <div class="font-bold font-mono text-cyan-300 text-xs sm:text-sm mt-0.5">$${(u.wallet_balance || 0).toFixed(2)}</div>
        </div>
        <div class="text-right">
          <div class="text-[10px] text-slate-400 font-medium">Active Investment</div>
          <div class="font-bold font-mono text-emerald-400 text-xs sm:text-sm mt-0.5">$${(u.active_invested || 0).toFixed(2)}</div>
        </div>
      </div>

      <!-- Actions Bar: Equal Width, Always within card container -->
      <div class="flex items-center gap-2 pt-1 border-t border-slate-800/80">
        <button onclick="inspectAdminUser(${u.id})" class="flex-1 py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition flex items-center justify-center gap-1.5 border border-slate-700 cursor-pointer active:scale-95" title="View Portfolio & Adjust">
          <i data-lucide="eye" class="w-3.5 h-3.5 text-amber-400"></i>
          <span>Inspect</span>
        </button>
        <button onclick="adminImpersonateUser(${u.id})" class="flex-1 py-2 px-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black text-xs font-black transition flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer active:scale-95" title="Open member's live portal directly">
          <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
          <span>Open Portal</span>
        </button>
      </div>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function filterAdminUsersList() {
  const query = (document.getElementById('admin-user-search-input')?.value || '').trim().toLowerCase();
  if (!query) {
    renderAdminUsersList(adminCachedUsers);
    return;
  }
  const filtered = adminCachedUsers.filter(u =>
    (u.username && u.username.toLowerCase().includes(query)) ||
    (u.full_name && u.full_name.toLowerCase().includes(query)) ||
    (u.email && u.email.toLowerCase().includes(query)) ||
    (u.referral_code && u.referral_code.toLowerCase().includes(query))
  );
  renderAdminUsersList(filtered);
}
window.filterAdminUsersList = filterAdminUsersList;

async function inspectAdminUser(userId) {
  try {
    currentInspectedUserId = userId;
    const res = await fetch(`${API_BASE}/admin/users/${userId}/details`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success || !data.user) throw new Error(data.error || 'Failed to fetch user details');

    const u = data.user;
    document.getElementById('aud-fullname').textContent = u.full_name || u.username;
    document.getElementById('aud-username').textContent = `@${u.username}`;
    document.getElementById('aud-avatar').textContent = (u.full_name || u.username || 'U')[0].toUpperCase();
    document.getElementById('aud-role-badge').textContent = u.role.toUpperCase();

    document.getElementById('aud-wallet-bal').textContent = `$${(u.wallet_balance || 0).toFixed(2)}`;
    document.getElementById('aud-roi-bal').textContent = `$${(u.roi_balance || 0).toFixed(2)}`;
    document.getElementById('aud-comm-bal').textContent = `$${(u.commission_balance || 0).toFixed(2)}`;

    document.getElementById('aud-email').textContent = u.email || '-';
    document.getElementById('aud-phone').textContent = u.phone || '-';
    document.getElementById('aud-refcode').textContent = u.referral_code;
    document.getElementById('aud-sponsor').textContent = u.sponsor_username ? `@${u.sponsor_username}` : 'Direct Master';
    document.getElementById('aud-usdt').textContent = u.usdt_address || 'Not Set';

    const stEl = document.getElementById('aud-status');
    if (stEl) {
      stEl.textContent = u.status.toUpperCase();
      stEl.className = `font-bold uppercase text-[11px] ${u.status === 'active' ? 'text-emerald-400' : 'text-rose-400'}`;
    }

    // Render investments
    const invContainer = document.getElementById('aud-investments-list');
    if (invContainer) {
      if (data.investments && data.investments.length > 0) {
        invContainer.innerHTML = data.investments.map(i => `
          <div class="p-2 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-between text-xs">
            <div>
              <div class="font-bold text-white">${i.plan_name} ($${i.amount})</div>
              <div class="text-[10px] text-slate-400">Earned: $${(i.total_earned || 0).toFixed(2)} &bull; ${i.days_credited}/${i.total_days} days</div>
            </div>
            <span class="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${i.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-300'}">${i.status}</span>
          </div>
        `).join('');
      } else {
        invContainer.innerHTML = `<div class="text-center py-2 text-slate-500">No investment plans active</div>`;
      }
    }

    openModal('adminUserDetailModal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.inspectAdminUser = inspectAdminUser;

async function adminImpersonateUser(userId) {
  try {
    const res = await fetch(`${API_BASE}/admin/impersonate/${userId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (!data.success || !data.token) throw new Error(data.error || 'Impersonation failed');

    // Save admin original token so admin can return
    if (!originalAdminToken) {
      originalAdminToken = token;
      localStorage.setItem('catalyst_admin_orig_token', originalAdminToken);
    }

    // Switch active credentials to target user
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('catalyst_token', token);

    closeModal('adminUserDetailModal');

    // Show Impersonation banner
    const banner = document.getElementById('impersonation-alert-banner');
    const uEl = document.getElementById('impersonation-active-user');
    if (banner && uEl) {
      uEl.textContent = `@${currentUser.username} (${currentUser.full_name || ''})`;
      banner.classList.remove('hidden');
    }

    updateAuthUI();
    showToast(`Switched into member portal of @${currentUser.username}!`, 'info');
    navigate('home');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.adminImpersonateUser = adminImpersonateUser;

function exitImpersonation() {
  if (!originalAdminToken) return;
  token = originalAdminToken;
  localStorage.setItem('catalyst_token', token);
  localStorage.removeItem('catalyst_admin_orig_token');
  originalAdminToken = null;

  const banner = document.getElementById('impersonation-alert-banner');
  if (banner) banner.classList.add('hidden');

  fetchUserProfile().then(() => {
    showToast('Returned to Master Admin Portal!', 'success');
    navigate('admin');
  });
}
window.exitImpersonation = exitImpersonation;

async function handleAdminAdjustBalance(e) {
  e.preventDefault();
  if (!currentInspectedUserId) return;
  const walletType = document.getElementById('adj-wallet-type').value;
  const action = document.getElementById('adj-action').value;
  const amount = document.getElementById('adj-amount').value;

  try {
    const res = await fetch(`${API_BASE}/admin/adjust-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        userId: currentInspectedUserId,
        amount,
        walletType,
        action,
        reason: 'Admin Panel Quick Adjustment'
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Adjustment failed');

    showToast(data.message || 'Balance updated!', 'success');
    document.getElementById('adj-amount').value = '';
    await inspectAdminUser(currentInspectedUserId);
    await loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleAdminAdjustBalance = handleAdminAdjustBalance;

// ==================== ADMIN DEPOSITS & WITHDRAWALS ====================

async function loadAdminWithdrawals() {
  const withRes = await fetch(`${API_BASE}/admin/withdrawals`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const withData = await withRes.json();
  const withContainer = document.getElementById('admin-withdrawals-list');
  if (!withContainer) return;

  if (withData.success && withData.withdrawals && withData.withdrawals.length > 0) {
    withContainer.innerHTML = withData.withdrawals.map(w => `
      <div class="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5 hover:border-slate-700 transition shadow-md overflow-hidden">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="font-bold text-white text-xs flex items-center gap-1.5 flex-wrap">
              <span>#${w.id}</span>
              <span class="text-slate-600">&bull;</span>
              <span>${w.full_name || w.username}</span>
              <span class="text-slate-400 font-mono text-[11px]">(@${w.username})</span>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5">
              ${new Date(w.created_at).toLocaleString()}
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-bold text-rose-400 font-mono text-sm sm:text-base">$${parseFloat(w.amount).toFixed(2)} USDT</div>
            <span class="text-[9px] uppercase px-2 py-0.5 rounded font-bold font-mono inline-block mt-0.5 ${w.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : (w.status === 'rejected' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30')}">${w.status}</span>
          </div>
        </div>

        <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] font-mono">
          <div class="text-[10px] text-slate-400 flex items-center justify-between mb-1">
            <span>Destination Address (BEP-20):</span>
            <span class="text-cyan-400 text-[10px] font-bold">${w.network || 'USDT-BEP20'}</span>
          </div>
          ${w.usdt_address && /^0x[a-fA-F0-9]{40}$/i.test(w.usdt_address) ? `
            <div class="space-y-1.5">
              <div class="text-slate-200 font-bold break-all select-all text-[11px]">${w.usdt_address}</div>
              <div class="flex items-center gap-2 flex-wrap pt-0.5">
                <a href="https://bscscan.com/address/${w.usdt_address}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 text-[10px] font-bold inline-flex items-center gap-1 transition shadow-sm">
                  <i data-lucide="external-link" class="w-3 h-3"></i> View Address on BscScan
                </a>
                <button type="button" onclick="copyToClipboard('${w.usdt_address}')" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-sans font-bold transition">Copy</button>
              </div>
            </div>
          ` : `
            <div class="text-slate-200 font-bold break-all select-all text-[11px]">${w.usdt_address || 'No address provided'}</div>
          `}
          ${w.tx_hash ? `
            <div class="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-1 text-[10px]">
              <span class="text-slate-400">Payout TXID:</span>
              <a href="https://bscscan.com/tx/${w.tx_hash}" target="_blank" rel="noopener noreferrer" class="text-emerald-400 hover:text-emerald-300 underline font-mono inline-flex items-center gap-1 break-all">
                <span>${w.tx_hash.length > 20 ? w.tx_hash.substring(0, 10) + '...' + w.tx_hash.substring(w.tx_hash.length - 8) : w.tx_hash}</span> <i data-lucide="external-link" class="w-2.5 h-2.5"></i>
              </a>
            </div>
          ` : ''}
        </div>

        ${w.status === 'pending' ? `
          <div class="flex items-center gap-2 pt-1 border-t border-slate-800/80">
            <button onclick="approveWithdrawal(${w.id})" class="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-500/20 active:scale-95">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
              <span>Approve Payout</span>
            </button>
            <button onclick="rejectWithdrawal(${w.id})" class="flex-1 py-2 px-3 rounded-xl bg-rose-500/20 border border-rose-500/40 hover:bg-rose-500/30 text-rose-400 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95">
              <i data-lucide="x-circle" class="w-3.5 h-3.5"></i>
              <span>Reject</span>
            </button>
          </div>
        ` : ''}
      </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
  } else {
    withContainer.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">No withdrawal requests found</div>`;
  }
}

async function approveWithdrawal(id) {
  const txHash = prompt('Optional: Enter BEP-20 Blockchain Transaction Hash (0x...) or leave empty to auto-generate:');
  try {
    const res = await fetch(`${API_BASE}/admin/withdrawals/${id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ txHash: txHash ? txHash.trim() : null })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Withdrawal #${id} approved successfully!`, 'success');
      loadAdminData();
    } else {
      showToast(data.error || 'Approval failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.approveWithdrawal = approveWithdrawal;

async function rejectWithdrawal(id) {
  const reason = prompt('Enter rejection reason for member:', 'Incorrect wallet address or suspicious activity');
  if (!reason) return;

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
      showToast(`Withdrawal #${id} rejected and funds refunded to user!`, 'info');
      loadAdminData();
    } else {
      showToast(data.error || 'Rejection failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.rejectWithdrawal = rejectWithdrawal;

async function loadAdminDeposits() {
  const depRes = await fetch(`${API_BASE}/admin/deposits`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const depData = await depRes.json();
  const depContainer = document.getElementById('admin-deposits-list');
  if (!depContainer) return;

  if (depData.success && depData.deposits && depData.deposits.length > 0) {
    depContainer.innerHTML = depData.deposits.map(d => `
      <div class="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5 hover:border-slate-700 transition shadow-md overflow-hidden">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="font-bold text-white text-xs flex items-center gap-1.5 flex-wrap">
              <span>#${d.id}</span>
              <span class="text-slate-600">&bull;</span>
              <span>${d.full_name || d.username}</span>
              <span class="text-slate-400 font-mono text-[11px]">(@${d.username})</span>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5">
              ${new Date(d.created_at).toLocaleString()}
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-bold text-emerald-400 font-mono text-sm sm:text-base">+$${parseFloat(d.amount).toFixed(2)} USDT</div>
            <span class="text-[9px] uppercase px-2 py-0.5 rounded font-bold font-mono inline-block mt-0.5 ${d.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : (d.status === 'rejected' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30')}">${d.status}</span>
          </div>
        </div>

        <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] font-mono">
          <div class="text-[10px] text-slate-400 flex items-center justify-between mb-1.5">
            <span>Tx Hash / Verification:</span>
            <span class="text-cyan-400 text-[10px] font-bold">${d.network || 'USDT-BEP20'}</span>
          </div>
          ${d.tx_hash && /^0x[a-fA-F0-9]{64}$/i.test(d.tx_hash) ? `
            <div class="space-y-1.5">
              <div class="text-slate-300 font-bold break-all select-all text-[11px]">${d.tx_hash}</div>
              <div class="flex items-center gap-2 flex-wrap pt-0.5">
                <a href="https://bscscan.com/tx/${d.tx_hash}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 text-[10px] font-bold inline-flex items-center gap-1 transition shadow-sm">
                  <i data-lucide="external-link" class="w-3 h-3"></i> Verify on BscScan
                </a>
                <button type="button" onclick="copyToClipboard('${d.tx_hash}')" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-sans font-bold transition">Copy TXID</button>
              </div>
            </div>
          ` : `
            <div class="text-slate-200 font-bold break-all select-all text-[11px]">${d.tx_hash || 'Internal Admin Credit'}</div>
          `}
        </div>

        ${d.status === 'pending' ? `
          <div class="flex items-center gap-2 pt-1 border-t border-slate-800/80">
            <button onclick="approveDeposit(${d.id})" class="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-500/20 active:scale-95">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
              <span>Approve & Credit</span>
            </button>
            <button onclick="rejectDeposit(${d.id})" class="flex-1 py-2 px-3 rounded-xl bg-rose-500/20 border border-rose-500/40 hover:bg-rose-500/30 text-rose-400 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95">
              <i data-lucide="x-circle" class="w-3.5 h-3.5"></i>
              <span>Reject</span>
            </button>
          </div>
        ` : ''}
      </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
  } else {
    depContainer.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">No deposit records found</div>`;
  }
}

async function approveDeposit(id) {
  try {
    const res = await fetch(`${API_BASE}/admin/deposits/${id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Deposit approved and credited!', 'success');
      loadAdminData();
    } else {
      showToast(data.error || 'Approval failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.approveDeposit = approveDeposit;

async function rejectDeposit(id) {
  const reason = prompt('Enter rejection reason:');
  if (!reason) return;
  try {
    const res = await fetch(`${API_BASE}/admin/deposits/${id}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Deposit rejected', 'info');
      loadAdminData();
    } else {
      showToast(data.error || 'Rejection failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.rejectDeposit = rejectDeposit;

function populateManualDepositUserSelect(users) {
  const select = document.getElementById('amd-user-select');
  if (!select) return;
  select.innerHTML = '<option value="">Select a user...</option>' + users.map(u => `
    <option value="${u.id}">${u.full_name || u.username} (@${u.username} - Ref: ${u.referral_code})</option>
  `).join('');
}

function openManualDepositModal() {
  populateManualDepositUserSelect(adminCachedUsers);
  openModal('adminManualDepositModal');
}
window.openManualDepositModal = openManualDepositModal;

function openManualDepositForUser(userId) {
  openManualDepositModal();
  const select = document.getElementById('amd-user-select');
  if (select) select.value = userId;
}
window.openManualDepositForUser = openManualDepositForUser;

async function handleAdminManualDepositSubmit(e) {
  e.preventDefault();
  const userId = document.getElementById('amd-user-select').value;
  const amount = document.getElementById('amd-amount').value;
  const network = document.getElementById('amd-network').value;
  const txHash = document.getElementById('amd-txhash').value.trim();

  try {
    const res = await fetch(`${API_BASE}/admin/deposits/manual-create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId, amount, network, txHash })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Manual deposit failed');

    closeModal('adminManualDepositModal');
    showToast(data.message || 'Manual deposit credited successfully!', 'success');
    await loadAdminData();
    if (currentInspectedUserId) await inspectAdminUser(currentInspectedUserId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleAdminManualDepositSubmit = handleAdminManualDepositSubmit;

// ==================== SUPPORT TICKETS LOGIC (ADMIN & USER) ====================

async function loadAdminTickets() {
  const res = await fetch(`${API_BASE}/admin/tickets`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  const container = document.getElementById('admin-tickets-list');
  if (!container) return;

  if (data.success && data.tickets && data.tickets.length > 0) {
    container.innerHTML = data.tickets.map(t => `
      <div class="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5 hover:border-slate-700 transition shadow-md overflow-hidden">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="font-bold text-white text-xs flex items-center gap-2 flex-wrap">
              <span>#${t.id} &bull; ${t.subject}</span>
              <span class="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-mono border border-cyan-500/30">${t.category}</span>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5">
              By <strong class="text-slate-200">@${t.username}</strong> &bull; ${new Date(t.created_at).toLocaleString()}
            </div>
          </div>
          <span class="text-[9px] uppercase font-bold px-2 py-0.5 rounded shrink-0 ${t.status === 'open' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}">${t.status}</span>
        </div>

        <div class="text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 whitespace-pre-line break-words">
          ${t.message}
        </div>

        ${t.admin_reply ? `
          <div class="text-xs text-emerald-300 bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-900/40 break-words">
            <strong class="text-emerald-400">Admin Reply:</strong> ${t.admin_reply}
          </div>
        ` : ''}

        <div class="flex items-center justify-end pt-1 border-t border-slate-800/80">
          <button onclick="openAdminTicketReplyModal(${t.id}, '${escapeQuote(t.username)}', '${escapeQuote(t.category)}', '${escapeQuote(t.subject)}', '${escapeQuote(t.message)}')" class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-amber-500/20 active:scale-95">
            <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
            <span>Reply to Member</span>
          </button>
        </div>
      </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
  } else {
    container.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">No support tickets found</div>`;
  }
}

function escapeQuote(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function openAdminTicketReplyModal(id, username, category, subject, message) {
  document.getElementById('at-reply-ticket-id').value = id;
  document.getElementById('at-reply-ticket-user').textContent = `@${username}`;
  document.getElementById('at-reply-ticket-category').textContent = category;
  document.getElementById('at-reply-ticket-subject').textContent = subject;
  document.getElementById('at-reply-ticket-msg').textContent = message;
  document.getElementById('at-reply-text').value = '';
  openModal('adminTicketReplyModal');
}
window.openAdminTicketReplyModal = openAdminTicketReplyModal;

async function handleAdminTicketReplySubmit(e) {
  e.preventDefault();
  const id = document.getElementById('at-reply-ticket-id').value;
  const reply = document.getElementById('at-reply-text').value.trim();
  const status = document.getElementById('at-reply-status').value;

  try {
    const res = await fetch(`${API_BASE}/admin/tickets/${id}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ reply, status })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to submit reply');

    closeModal('adminTicketReplyModal');
    showToast('Reply sent successfully!', 'success');
    loadAdminTickets();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleAdminTicketReplySubmit = handleAdminTicketReplySubmit;

function openSupportTicketModal() {
  closeProfileDropdown();
  loadMemberSupportTickets();
  openModal('memberSupportModal');
}
window.openSupportTicketModal = openSupportTicketModal;

async function loadMemberSupportTickets() {
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/auth/tickets`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const container = document.getElementById('member-tickets-list');
    if (!container) return;

    if (data.success && data.tickets && data.tickets.length > 0) {
      container.innerHTML = data.tickets.map(t => `
        <div class="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="font-bold text-white text-xs">${t.subject}</span>
            <span class="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded ${t.status === 'open' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}">${t.status}</span>
          </div>
          <p class="text-[11px] text-slate-300">${t.message}</p>
          ${t.admin_reply ? `
            <div class="p-2 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-[11px] text-cyan-300 mt-1">
              <strong>Admin Response:</strong> ${t.admin_reply}
            </div>
          ` : `<div class="text-[10px] text-slate-500 italic">Waiting for admin response...</div>`}
        </div>
      `).join('');
    } else {
      container.innerHTML = `<div class="text-center py-4 text-slate-500">No support tickets created yet</div>`;
    }
  } catch (err) {
    console.error('Failed to load tickets:', err);
  }
}

async function handleCreateSupportTicket(e) {
  e.preventDefault();
  const category = document.getElementById('st-category').value;
  const subject = document.getElementById('st-subject').value.trim();
  const message = document.getElementById('st-message').value.trim();

  try {
    const res = await fetch(`${API_BASE}/auth/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ category, subject, message })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to submit ticket');

    showToast('Support ticket submitted successfully!', 'success');
    document.getElementById('st-subject').value = '';
    document.getElementById('st-message').value = '';
    loadMemberSupportTickets();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleCreateSupportTicket = handleCreateSupportTicket;

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

// ==================== FORGOT PASSWORD (EMAIL OTP) ====================

function openForgotPasswordModal() {
  const emailInput = document.getElementById('fp-email-input');
  const otpInput = document.getElementById('fp-otp-input');
  const newPass = document.getElementById('fp-new-password');
  const confPass = document.getElementById('fp-confirm-password');
  const loginIdInput = document.getElementById('login-id');

  if (emailInput) {
    emailInput.value = (loginIdInput && loginIdInput.value.includes('@')) ? loginIdInput.value.trim() : '';
  }
  if (otpInput) otpInput.value = '';
  if (newPass) newPass.value = '';
  if (confPass) confPass.value = '';

  const btn = document.getElementById('btn-fp-send-otp');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Send OTP';
  }

  openModal('forgotPasswordModal');
}
window.openForgotPasswordModal = openForgotPasswordModal;

async function handleSendForgotPasswordOtp() {
  const emailInput = document.getElementById('fp-email-input');
  const email = emailInput ? emailInput.value.trim() : '';
  const btn = document.getElementById('btn-fp-send-otp');

  if (!email || !email.includes('@')) {
    showToast('Please enter your registered email address', 'error');
    return;
  }

  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, purpose: 'forgot_password' })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Password reset OTP sent to your email! Please check inbox/spam.', 'success');
      if (btn) btn.textContent = 'OTP Sent';
    } else {
      showToast(data.error || 'Failed to send reset OTP', 'error');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) btn.disabled = false;
  }
}
window.handleSendForgotPasswordOtp = handleSendForgotPasswordOtp;

async function handleResetPasswordSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('fp-email-input')?.value.trim();
  const otp = document.getElementById('fp-otp-input')?.value.trim();
  const newPassword = document.getElementById('fp-new-password')?.value;
  const confirmPassword = document.getElementById('fp-confirm-password')?.value;

  if (!email || !otp) {
    showToast('Email and OTP code are required', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match!', 'error');
    return;
  }
  if (newPassword.length < 6) {
    showToast('Password must be at least 6 characters', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('forgotPasswordModal');
      showToast('Password reset successfully! You can now login.', 'success');
      const loginPassInput = document.getElementById('login-password');
      if (loginPassInput) loginPassInput.value = '';
    } else {
      showToast(data.error || 'Failed to reset password', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleResetPasswordSubmit = handleResetPasswordSubmit;

// ==================== NOTICE TICKER & POPUP IMAGE MANAGER ====================

let currentPopupImageBase64 = '';

async function loadAdminSettings() {
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/admin/settings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.settings) {
      const settingsMap = data.settings.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});

      // Ticker text
      const tickerInput = document.getElementById('admin-ticker-input');
      if (tickerInput) {
        tickerInput.value = settingsMap.announcement_ticker || 'Welcome to the official Catalyst Capital trading platform • High Frequency AI Trading • Instant 0% Withdrawal Payouts • Daily ROI Active •';
      }

      // Pop image
      const chkActive = document.getElementById('admin-popup-active-checkbox');
      if (chkActive) {
        chkActive.checked = (settingsMap.popup_image_active === '1' || settingsMap.popup_image_active === 'true');
      }

      const titleInput = document.getElementById('admin-popup-title-input');
      if (titleInput) {
        titleInput.value = settingsMap.popup_image_title || 'Special Platform Announcement';
      }

      const urlInput = document.getElementById('admin-popup-url-input');
      const imgUrl = settingsMap.popup_image_url || '';
      if (urlInput) urlInput.value = imgUrl.startsWith('data:') ? '' : imgUrl;

      if (imgUrl) {
        currentPopupImageBase64 = imgUrl;
        showAdminPopupPreview(imgUrl);
      }
    }
  } catch (err) {
    console.error('Failed to load admin settings:', err);
  }
}

async function handleSaveTickerNotice(e) {
  e.preventDefault();
  const value = document.getElementById('admin-ticker-input')?.value.trim();
  if (!value) return;

  try {
    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ key: 'announcement_ticker', value })
    });
    const data = await res.json();
    if (data.success) {
      if (!publicAnnouncementsCache) publicAnnouncementsCache = {};
      publicAnnouncementsCache.announcementTicker = value;

      const tickerEl = document.getElementById('home-ticker-text');
      if (tickerEl) tickerEl.textContent = value;
      showToast('Scrolling notification message updated live!', 'success');
    } else {
      showToast(data.error || 'Failed to update ticker', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleSaveTickerNotice = handleSaveTickerNotice;

function previewAdminPopupImageFile(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
      const rawDataUrl = e.target.result;
      // Auto-compress and downscale image to fit safely under Vercel payload limits (<300KB)
      const img = new Image();
      img.onload = function() {
        const maxWidth = 900;
        const maxHeight = 1200;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Quality 0.8 JPEG provides ultra crisp graphics while reducing size down to ~80-150 KB
        currentPopupImageBase64 = canvas.toDataURL('image/jpeg', 0.82);

        const urlInput = document.getElementById('admin-popup-url-input');
        if (urlInput) urlInput.value = '';

        // Auto-check "Enable Popup on Login" checkbox so admin doesn't forget
        const chkActive = document.getElementById('admin-popup-active-checkbox');
        if (chkActive) chkActive.checked = true;

        showAdminPopupPreview(currentPopupImageBase64);
        showToast('Image uploaded & optimized successfully!', 'success');
      };
      img.onerror = function() {
        currentPopupImageBase64 = rawDataUrl;
        showAdminPopupPreview(currentPopupImageBase64);
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  }
}
window.previewAdminPopupImageFile = previewAdminPopupImageFile;

function previewAdminPopupImageUrl(url) {
  if (url && url.trim()) {
    currentPopupImageBase64 = url.trim();
    const chkActive = document.getElementById('admin-popup-active-checkbox');
    if (chkActive) chkActive.checked = true;
    showAdminPopupPreview(currentPopupImageBase64);
  }
}
window.previewAdminPopupImageUrl = previewAdminPopupImageUrl;

function showAdminPopupPreview(src) {
  const box = document.getElementById('admin-popup-preview-box');
  const img = document.getElementById('admin-popup-preview-img');
  if (box && img && src) {
    img.src = src;
    box.classList.remove('hidden');
  }
}

function clearAdminPopupImage() {
  currentPopupImageBase64 = '';
  const fileInput = document.getElementById('admin-popup-file-input');
  if (fileInput) fileInput.value = '';
  const urlInput = document.getElementById('admin-popup-url-input');
  if (urlInput) urlInput.value = '';
  const box = document.getElementById('admin-popup-preview-box');
  if (box) box.classList.add('hidden');
  const chkActive = document.getElementById('admin-popup-active-checkbox');
  if (chkActive) chkActive.checked = false;
  showToast('Popup image cleared. Click Save to apply.', 'info');
}
window.clearAdminPopupImage = clearAdminPopupImage;

async function handleSavePopupImage(e) {
  e.preventDefault();
  const urlVal = document.getElementById('admin-popup-url-input')?.value.trim();
  const finalImage = urlVal || currentPopupImageBase64 || '';
  // If an image exists and admin clicked save, default to active unless explicitly unchecked
  const chkActive = document.getElementById('admin-popup-active-checkbox');
  const isActive = chkActive ? (chkActive.checked ? '1' : '0') : (finalImage ? '1' : '0');
  const title = document.getElementById('admin-popup-title-input')?.value.trim() || 'Special Platform Announcement';

  if (isActive === '1' && !finalImage) {
    showToast('Please upload an image file or provide an Image URL first', 'error');
    return;
  }

  const saveBtn = e.target.querySelector('button[type="submit"]') || document.getElementById('btn-save-popup');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    // Single batch request to update all popup settings simultaneously
    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        settings: {
          popup_image_url: finalImage,
          popup_image_active: isActive,
          popup_image_title: title
        }
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to save settings');

    // Update in-memory public announcement cache immediately
    if (!publicAnnouncementsCache) publicAnnouncementsCache = {};
    publicAnnouncementsCache.popupImageUrl = finalImage;
    publicAnnouncementsCache.popupImageActive = (isActive === '1');
    publicAnnouncementsCache.popupImageTitle = title;

    // Reset session flag so admin can immediately see the popup when viewing member portal
    hasShownLoginPopupThisSession = false;

    showToast('Member login pop image announcement saved live!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Update Pop Image';
    }
  }
}
window.handleSavePopupImage = handleSavePopupImage;

let hasShownLoginPopupThisSession = false;

function checkAndShowMemberLoginPopup(imgUrl, title, force = false) {
  if (!imgUrl) return;
  if (!force && hasShownLoginPopupThisSession) return;
  // Don't show popup on purely auth pages or inside admin dashboard
  if (activeViewName === 'login' || activeViewName === 'register' || activeViewName === 'adminlogin' || activeViewName === 'admin') return;

  const modalImg = document.getElementById('login-popup-img');
  const modalTitle = document.getElementById('login-popup-title');
  if (modalImg) modalImg.src = imgUrl;
  if (modalTitle && title) modalTitle.textContent = title;

  hasShownLoginPopupThisSession = true;
  setTimeout(() => {
    openModal('memberLoginPopupModal');
  }, 400);
}
window.checkAndShowMemberLoginPopup = checkAndShowMemberLoginPopup;

function previewMemberLoginPopupDirectly() {
  const urlVal = document.getElementById('admin-popup-url-input')?.value.trim();
  const finalImage = urlVal || currentPopupImageBase64 || (publicAnnouncementsCache && publicAnnouncementsCache.popupImageUrl);
  const title = document.getElementById('admin-popup-title-input')?.value.trim() || 'Special Platform Announcement';
  if (!finalImage) {
    showToast('No pop image uploaded or configured yet!', 'info');
    return;
  }
  const modalImg = document.getElementById('login-popup-img');
  const modalTitle = document.getElementById('login-popup-title');
  if (modalImg) modalImg.src = finalImage;
  if (modalTitle) modalTitle.textContent = title;
  openModal('memberLoginPopupModal');
}
window.previewMemberLoginPopupDirectly = previewMemberLoginPopupDirectly;
